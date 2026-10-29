// Navegación del panel de productores casi instantánea (lo carga src/layouts/DashboardLayout.astro).
//
// 1. Precarga: con Speculation Rules (Chrome/Edge) la página de un enlace del panel se renderiza en segundo plano
//    cuando el productor pasa el mouse por encima o empieza a tocarlo ("moderate"); al hacer clic ya está lista.
//    Después de guardar algo (fetch que no es GET) se descartan las precargas para no mostrar datos viejos.
//    En el servidor la precarga no cuenta como visita (recordDashboardPageView con deferred).
// 2. Skeleton: si la página no estaba precargada (Safari, Firefox o un clic directo), al hacer clic el ítem del
//    menú se marca al tiro y el contenido cambia por un skeleton con la forma de la sección de destino
//    (src/components/dashboard/DashboardSkeletons.astro) mientras llega la página.
//
// Nunca debe romper la navegación normal: si algo falla, el enlace sigue funcionando como siempre.

const RULES_ATTR = "data-ait-speculation";
// Volver a una pestaña que estuvo oculta más que esto descarta las precargas (pueden tener datos viejos)
const STALE_AFTER_HIDDEN_MS = 60_000;
// Si la navegación se cancela (Esc, botón detener) no hay evento: pasado esto se vuelve a mostrar el contenido
const SKELETON_TIMEOUT_MS = 20_000;

/** Skeleton según la ruta de destino (data-skeleton de los <template> de DashboardSkeletons.astro). */
const SKELETON_ROUTES = [
  [/^\/dashboard\/?$/, "overview"],
  [/^\/dashboard\/finance\/?$/, "overview"],
  [/^\/dashboard\/events\/(create|\d+\/edit)\/?$/, "form"],
  [/^\/dashboard\/events\/\d+(\/.*)?$/, "detail"],
  [/^\/dashboard\/(events|promote)\/?$/, "cards"],
  [/^\/dashboard\/(tickets|community|descuentos|team)\/?$/, "table"],
];
const skeletonFor = (path) => (SKELETON_ROUTES.find(([re]) => re.test(path)) || [null, "form"])[1];

const isDashboardPath = (path) => /^\/dashboard(\/|$)/.test(path);

// ------------------------------------------------------------------------------------------------- precarga

const speculationSupported = () =>
  typeof HTMLScriptElement !== "undefined" && typeof HTMLScriptElement.supports === "function" && HTMLScriptElement.supports("speculationrules");

const RULES = {
  prerender: [
    {
      source: "document",
      where: {
        and: [
          { or: [{ href_matches: "/dashboard" }, { href_matches: "/dashboard/*" }, { href_matches: "/dashboard/*\\?*" }, { href_matches: "/dashboard\\?*" }] },
          // El escáner de puerta pide la cámara: solo al abrirlo de verdad
          { not: { href_matches: "/dashboard/events/*/checkin*" } },
          { not: { selector_matches: "[target=_blank], [download], [data-no-prerender]" } },
        ],
      },
      eagerness: "moderate",
    },
  ],
};

/** (Re)instala las reglas. Quitar el <script> anterior descarta las páginas que ya estaban precargadas. */
function installRules() {
  if (!speculationSupported()) return;
  document.querySelectorAll(`script[${RULES_ATTR}]`).forEach((el) => el.remove());
  const script = document.createElement("script");
  script.type = "speculationrules";
  script.setAttribute(RULES_ATTR, "");
  script.textContent = JSON.stringify(RULES);
  document.head.appendChild(script);
}

/** Después de guardar algo, las páginas precargadas pueden mostrar datos viejos: se descartan. */
function watchMutations() {
  const original = window.fetch;
  if (typeof original !== "function") return;
  window.fetch = function (input, init) {
    const result = original.apply(this, arguments);
    try {
      const method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
      const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
      if (method !== "GET" && method !== "HEAD" && !/\/api\/dashboard\/journal/.test(url)) {
        result.then(installRules, installRules);
      }
    } catch {
      /* nunca romper fetch */
    }
    return result;
  };
}

function watchVisibility() {
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_HIDDEN_MS) installRules();
  });
}

// ------------------------------------------------------------------------------------------------- skeleton

let skeletonTimer = 0;

function showSkeleton(path) {
  const host = document.getElementById("dashboard-nav-skeleton");
  const template = document.querySelector(`template[data-skeleton="${skeletonFor(path)}"]`);
  if (!host || !template) return;
  host.replaceChildren(template.content.cloneNode(true));
  document.documentElement.classList.add("ait-navigating");
  const main = document.getElementById("dashboard-main");
  if (main) main.scrollTop = 0;
  window.dispatchEvent(new CustomEvent("ait:navigate", { detail: { path } }));
  clearTimeout(skeletonTimer);
  skeletonTimer = window.setTimeout(hideSkeleton, SKELETON_TIMEOUT_MS);
}

function hideSkeleton() {
  clearTimeout(skeletonTimer);
  document.documentElement.classList.remove("ait-navigating");
  const host = document.getElementById("dashboard-nav-skeleton");
  if (host) host.replaceChildren();
}

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!link) return;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download") || link.hasAttribute("data-no-skeleton")) return;
  let url;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return;
  }
  if (url.origin !== location.origin || !isDashboardPath(url.pathname)) return;
  // Misma página (o solo cambia el #): no hay navegación
  if (url.pathname === location.pathname && url.search === location.search) return;
  // Formularios con cambios sin guardar (EditEventForm): el navegador va a preguntar si salir
  if (typeof window.aitHasUnsavedChanges === "function" && window.aitHasUnsavedChanges()) return;
  showSkeleton(url.pathname);
}

export function startDashboardNav() {
  if (typeof window === "undefined" || window.__aitDashboardNav) return;
  window.__aitDashboardNav = true;
  try {
    installRules();
    watchMutations();
    watchVisibility();
    document.addEventListener("click", onClick);
    // Volver atrás desde la caché del navegador (bfcache): la página quedó con el skeleton puesto
    window.addEventListener("pageshow", (e) => {
      if (e.persisted) hideSkeleton();
    });
  } catch (err) {
    console.warn("dashboardNav:", err);
  }
}

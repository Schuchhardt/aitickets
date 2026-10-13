// Cloudflare Turnstile (antiabuso de /api/purchase-ticket) para el registro gratis y el checkout.
// Se carga recién cuando la persona empieza a llenar el formulario (no en la carga de la página) y en modo
// "interaction-only": el widget solo se ve si Cloudflare necesita que la persona haga algo.
// Sin site key configurada (desarrollo) no se exige.
import { ref, onBeforeUnmount } from "vue";

let siteKeyPromise = null;

/** Site key pública (build o GET /api/purchase-ticket), una sola vez por página. */
function loadSiteKey() {
  if (!siteKeyPromise) {
    siteKeyPromise = (async () => {
      const fromBuild = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "";
      if (fromBuild) return fromBuild;
      try {
        const res = await fetch("/api/purchase-ticket", { method: "GET" });
        if (res.ok) return (await res.json())?.turnstileSiteKey || "";
      } catch {
        /* sin captcha */
      }
      return "";
    })();
  }
  return siteKeyPromise;
}

function loadScript() {
  if (window.turnstile || document.getElementById("cf-turnstile-script")) return;
  const script = document.createElement("script");
  script.id = "cf-turnstile-script";
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {import('vue').Ref<HTMLElement|null>} container elemento donde va el widget
 * @param {{ disabled?: () => boolean }} [opts] disabled: no usar captcha (p. ej. evento demo)
 */
export function useTurnstile(container, { disabled = () => false } = {}) {
  const siteKey = ref("");
  const token = ref("");
  const started = ref(false);
  let widgetId = null;

  async function start() {
    if (started.value || disabled() || typeof window === "undefined") return;
    started.value = true;
    siteKey.value = await loadSiteKey();
    if (!siteKey.value) return;
    loadScript();
    for (let i = 0; i < 150 && !window.turnstile; i++) await sleep(100);
    if (!window.turnstile || !container.value || widgetId !== null) return;
    widgetId = window.turnstile.render(container.value, {
      sitekey: siteKey.value,
      language: "es",
      appearance: "interaction-only",
      callback: (t) => (token.value = t),
      "expired-callback": () => (token.value = ""),
      "error-callback": () => (token.value = ""),
    });
  }

  /** Token listo para enviar (espera hasta `timeoutMs` a que Turnstile lo entregue). "" si no hay captcha. */
  async function getToken(timeoutMs = 10000) {
    if (disabled()) return "";
    await start();
    if (!siteKey.value) return "";
    const until = Date.now() + timeoutMs;
    while (!token.value && Date.now() < until) await sleep(100);
    return token.value;
  }

  /** Cada token sirve una sola vez: pedir otro para reintentar. */
  function reset() {
    token.value = "";
    if (window.turnstile && widgetId !== null) {
      try {
        window.turnstile.reset(widgetId);
      } catch {
        /* widget no disponible */
      }
    }
  }

  onBeforeUnmount(() => {
    if (window.turnstile && widgetId !== null) {
      try {
        window.turnstile.remove(widgetId);
      } catch {
        /* ya eliminado */
      }
    }
  });

  return { siteKey, token, start, getToken, reset };
}

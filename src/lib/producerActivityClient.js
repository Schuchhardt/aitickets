// Rastreador del panel de productores (navegador). Lo carga src/layouts/DashboardLayout.astro en todas las páginas
// de /dashboard y solo corre si el layout registró la visita (atributo data-ait-pv del <body>: bitácora encendida y
// sesión iniciada). Diseño y qué se guarda: docs/specs/bitacora-panel.md.
//
// Qué registra (por carga de página, en lotes a ACTIVITY_ENDPOINT):
//   page_time    tiempo activo (con interacción en el último minuto y la pestaña visible), visible, scroll máximo
//   click        dónde hizo clic: texto del botón/enlace y la sección de la página. Nunca el valor de un campo
//   rage_click   3+ clics en 1 s en el mismo lugar (frustración); dead_click: clic que no produjo ningún cambio
//   form_start / form_submit  empezó a completar / envió un formulario (cuántos campos, nunca qué escribió)
//   api_call / api_error      llamadas del panel a /api (escrituras, lentas o fallidas) con el mensaje de error
//   js_error     errores de JavaScript y scripts que no cargaron; ui_message: alert/confirm/toasts que vio
//   navigation   cambios de #sección; custom: window.aitTrack(nombre, props) para instrumentar algo puntual
// Todo texto pasa por redactText (sin correos, RUT, teléfonos ni tokens). Dentro de tablas y [data-track-mask] no
// se toma el texto (puede ser el nombre de un comprador), salvo el de los botones. Nada de esto debe romper el panel: cada
// manejador atrapa sus errores.
import { ACTIVITY_ENDPOINT, MAX_BATCH_EVENTS, redactText } from "./activityShared.js";

const IDLE_MS = 60_000;
const TICK_MS = 2000;
const FLUSH_MS = 15_000;
const SNAPSHOT_MS = 60_000;
const FLUSH_AT = 25;
const RAGE_CLICKS = 3;
const RAGE_WINDOW_MS = 1000;
const RAGE_RADIUS_PX = 40;
const DEAD_CLICK_MS = 1000;
const SLOW_GET_MS = 3000;
const MAX_EVENTS_PER_PAGE = 600;
const MAX_SAME_ERROR = 3;

const INTERACTIVE =
  'a[href],button,[role="button"],[role="tab"],[role="link"],[role="menuitem"],[role="option"],[role="switch"],[role="checkbox"],' +
  'input[type="checkbox"],input[type="radio"],input[type="submit"],input[type="button"],input[type="file"],select,summary,label,[data-track]';
const TEXT_FIELD =
  'input:not([type]),input[type="text"],input[type="email"],input[type="number"],input[type="tel"],input[type="url"],input[type="search"],' +
  'input[type="password"],input[type="date"],input[type="time"],input[type="datetime-local"],textarea,[contenteditable=""],[contenteditable="true"]';
const FIELD = `${TEXT_FIELD},select,input[type="checkbox"],input[type="radio"],input[type="file"]`;
const CONTEXT = '[data-track-section],dialog,[role="dialog"],form,section,nav,aside,header,table,main';
const MASKED = "table,[data-track-mask]";

let started = false;

const clean = (v, max = 80) => redactText(v, max);

/** Ruta de una URL del mismo origen, o el host si es externa ("mailto"/"tel" para esos esquemas). */
function hrefOf(el) {
  const raw = el.getAttribute && el.getAttribute("href");
  if (!raw) return "";
  if (/^mailto:/i.test(raw)) return "mailto";
  if (/^tel:/i.test(raw)) return "tel";
  if (raw.startsWith("#")) return raw.slice(0, 40);
  try {
    const url = new URL(raw, location.href);
    return url.origin === location.origin ? url.pathname.slice(0, 120) : url.host;
  } catch {
    return "";
  }
}

function fieldLabel(el) {
  const own = el.labels && el.labels[0] ? el.labels[0].innerText : "";
  return own || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.id || el.type || "";
}

/** Texto que identifica al elemento: data-track, aria-label, title o su texto visible (nunca el valor de un campo). */
function labelOf(el) {
  const explicit = el.getAttribute("data-track") || el.getAttribute("aria-label") || el.getAttribute("title");
  if (explicit) return clean(explicit);
  const tag = el.tagName;
  if (tag === "INPUT") return clean(el.type === "submit" || el.type === "button" ? el.value : fieldLabel(el));
  if (tag === "SELECT" || tag === "TEXTAREA") return clean(fieldLabel(el));
  // En tablas (asistentes, órdenes) y [data-track-mask] solo el texto de botones: un enlace o una celda puede ser el
  // nombre de un comprador
  if (el.closest(MASKED) && tag !== "BUTTON") return tag === "A" ? "enlace (texto oculto)" : "texto oculto";
  const text = clean(el.innerText || el.textContent || "");
  if (text) return text;
  const img = el.querySelector && el.querySelector("img[alt],svg[aria-label]");
  return img ? clean(img.getAttribute("alt") || img.getAttribute("aria-label")) : "";
}

function headingOf(box) {
  const heading = box.querySelector("h1,h2,h3,h4,legend,caption");
  return heading ? clean(heading.innerText || heading.textContent, 60) : "";
}

/**
 * Sección de la página donde está el elemento: data-track-section, aria-label o el primer título del bloque. Si el
 * bloque más cercano no tiene título (un <form> suelto) se sube al siguiente.
 */
function contextOf(el) {
  let box = el.closest(CONTEXT);
  let fallback = "";
  for (let depth = 0; box && depth < 4; depth++) {
    const explicit = box.getAttribute("data-track-section") || box.getAttribute("aria-label");
    if (explicit) return clean(explicit, 60);
    if (box.tagName === "NAV" || box.id === "dashboard-sidebar") return "Menú lateral";
    const text = headingOf(box);
    if (text) return text;
    if (!fallback) fallback = box.tagName.toLowerCase() + (box.id ? `#${clean(box.id, 40)}` : "");
    box = box.parentElement ? box.parentElement.closest(CONTEXT) : null;
  }
  return fallback;
}

function kindOf(el) {
  const role = el.getAttribute("role");
  if (role) return role;
  if (el.tagName === "A") return "link";
  if (el.tagName === "INPUT") return el.type;
  return el.tagName.toLowerCase();
}

function formOf(field) {
  return field.closest("form") || field.closest('[data-track-section],dialog,[role="dialog"],section,main') || field.ownerDocument.body;
}

function formLabel(form) {
  const explicit = form.getAttribute("data-track") || form.getAttribute("aria-label");
  return clean(explicit || headingOf(form) || contextOf(form) || form.getAttribute("name") || form.id || "formulario", 60);
}

/** Mensaje de error de una respuesta de /api (JSON {message} / {error} / {error: {message}}), sin HTML. */
async function errorMessage(res) {
  try {
    const type = res.headers.get("content-type") || "";
    if (/html/i.test(type)) return "";
    const text = await res.text();
    if (!/json/i.test(type)) return clean(text, 200);
    const body = JSON.parse(text);
    const err = body && (body.message || (body.error && (body.error.message || body.error)) || body.msg);
    return typeof err === "string" ? clean(err, 200) : "";
  } catch {
    return "";
  }
}

function levelOf(message) {
  const m = String(message || "").toLowerCase();
  if (/error|no se pudo|no pudimos|fall[oó]|inv[aá]lid|obligatori|debes|no tienes|no puedes|no existe|no encontr|intenta de nuevo|conexi[oó]n/.test(m)) return "error";
  if (/copiad|guardad|listo|[eé]xito|actualizad|enviad|publicad|creado|creada/.test(m)) return "success";
  return "info";
}

/**
 * Arranca el rastreador (una vez por página). Sin data-ait-pv en el <body> no hace nada.
 */
export function startProducerActivity() {
  if (started || typeof window === "undefined" || !document.body) return;
  const pv = document.body.dataset.aitPv;
  const route = document.body.dataset.aitRoute || "";
  if (!pv) return;
  started = true;

  const origFetch = window.fetch.bind(window);
  const queue = [];
  let sent = 0;
  let disabled = false;

  const push = (type, fields = {}) => {
    if (disabled || (sent >= MAX_EVENTS_PER_PAGE && type !== "page_time")) return;
    sent++;
    queue.push({ type, at: Date.now(), ...fields });
    if (queue.length >= FLUSH_AT) flush(false);
  };

  const flush = (unloading) => {
    while (queue.length && !disabled) {
      const events = queue.splice(0, MAX_BATCH_EVENTS);
      const body = JSON.stringify({ v: 1, pv, route, path: location.pathname, search: location.search, sent_at: Date.now(), events });
      if (unloading && navigator.sendBeacon) {
        try {
          if (navigator.sendBeacon(ACTIVITY_ENDPOINT, new Blob([body], { type: "application/json" }))) continue;
        } catch {
          /* sigue con fetch */
        }
      }
      origFetch(ACTIVITY_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "same-origin" })
        .then((res) => {
          // Sesión vencida o bitácora apagada: no se insiste en esta página
          if ([401, 403, 404, 410].includes(res.status)) disabled = true;
        })
        .catch(() => {});
    }
  };

  // ---------------------------------------------------------------- tiempo activo y scroll
  const loadedAt = Date.now();
  let lastTick = loadedAt;
  let lastInput = loadedAt;
  let activeMs = 0;
  let visibleMs = 0;
  let maxScroll = 0;
  let clicks = 0;
  let lastSnapshotActive = -1;
  let firstSnapshot = true;
  const fieldsTouched = new WeakMap();
  let touchedTotal = 0;

  const markInput = () => {
    lastInput = Date.now();
  };
  const tick = () => {
    const now = Date.now();
    // Las pestañas en segundo plano congelan los timers: un salto grande no cuenta
    const delta = Math.min(now - lastTick, TICK_MS * 2);
    lastTick = now;
    if (document.visibilityState !== "visible") return;
    visibleMs += delta;
    if (now - lastInput < IDLE_MS) activeMs += delta;
  };
  const scrollPct = (el) => {
    const h = el.scrollHeight - el.clientHeight;
    return h > 0 ? Math.min(100, Math.round(((el.scrollTop + el.clientHeight) / el.scrollHeight) * 100)) : 100;
  };
  const snapshot = (final) => {
    tick();
    if (!final && activeMs === lastSnapshotActive) return;
    lastSnapshotActive = activeMs;
    const data = { active_ms: activeMs, visible_ms: visibleMs, max_scroll_pct: maxScroll, clicks, fields_touched: touchedTotal, final: Boolean(final) };
    if (firstSnapshot) {
      firstSnapshot = false;
      const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
      if (nav && nav.loadEventEnd > 0) data.load_ms = Math.round(nav.loadEventEnd);
      data.viewport = `${window.innerWidth}x${window.innerHeight}`;
    }
    push("page_time", { duration_ms: activeMs, data });
  };

  const main = document.querySelector("main");
  if (main) maxScroll = scrollPct(main);
  document.addEventListener(
    "scroll",
    (e) => {
      markInput();
      try {
        const el = e.target === document ? document.scrollingElement : e.target;
        if (el && (el === main || el === document.scrollingElement)) maxScroll = Math.max(maxScroll, scrollPct(el));
      } catch {
        /* nada */
      }
    },
    { capture: true, passive: true },
  );
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"]) {
    document.addEventListener(type, markInput, { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      snapshot(false);
      flush(true);
    } else {
      lastTick = Date.now();
      markInput();
    }
  });
  window.addEventListener("pagehide", () => {
    snapshot(true);
    flush(true);
  });
  setInterval(tick, TICK_MS);
  setInterval(() => snapshot(false), SNAPSHOT_MS);
  setInterval(() => flush(false), FLUSH_MS);

  // ---------------------------------------------------------------- clics, frustración y clics sin respuesta
  let lastMutation = 0;
  let lastFetch = 0;
  let unloading = false;
  window.addEventListener("beforeunload", () => {
    unloading = true;
  });
  try {
    new MutationObserver(() => {
      lastMutation = Date.now();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch {
    /* sin MutationObserver: no hay dead_click */
  }
  let burst = [];
  let rageReported = false;
  let lastDead = { el: null, at: 0 };

  document.addEventListener(
    "click",
    (e) => {
      try {
        const raw = e.target instanceof Element ? e.target : null;
        if (!raw || raw.closest("[data-track-ignore]")) return;
        if (raw.closest(TEXT_FIELD)) return; // escribir en un campo lo cubre form_start
        clicks++;
        const now = Date.now();
        const el = raw.closest(INTERACTIVE);
        const target = el || raw;
        const label = labelOf(target);
        const where = contextOf(target);

        // Rage click: 3+ clics en 1 s dentro de un radio chico (se informa una vez por ráfaga)
        burst = burst.filter((c) => now - c.at < RAGE_WINDOW_MS && Math.hypot(c.x - e.clientX, c.y - e.clientY) < RAGE_RADIUS_PX);
        burst.push({ at: now, x: e.clientX, y: e.clientY });
        if (burst.length >= RAGE_CLICKS && !rageReported) {
          rageReported = true;
          push("rage_click", { label, target: where, data: { count: burst.length, kind: kindOf(target) } });
        } else if (burst.length < RAGE_CLICKS) rageReported = false;

        if (el) {
          const href = hrefOf(el);
          push("click", { label, target: where, data: { kind: kindOf(el), ...(href ? { href } : {}) } });
          return;
        }
        // No es interactivo según el HTML, pero con cursor de mano: una tarjeta con @click de Vue, por ejemplo
        const looksClickable = (() => {
          try {
            return getComputedStyle(raw).cursor === "pointer";
          } catch {
            return false;
          }
        })();
        if (looksClickable) push("click", { label, target: where, data: { kind: "clickable" } });
        // Clic sin respuesta: si parecía clickeable (o es el segundo seguido en el mismo elemento) y en 1 s no cambió
        // nada (ni el DOM, ni una llamada, ni navegación)
        const repeated = lastDead.el === raw && now - lastDead.at < 3000;
        lastDead = { el: raw, at: now };
        if (!looksClickable && !repeated) return;
        setTimeout(() => {
          if (unloading || lastMutation >= now || lastFetch >= now) return;
          push("dead_click", { label: label || clean(raw.tagName.toLowerCase()), target: where, data: { count: repeated ? 2 : 1, looks_clickable: looksClickable } });
        }, DEAD_CLICK_MS);
      } catch {
        /* nunca romper el clic */
      }
    },
    { capture: true },
  );

  // ---------------------------------------------------------------- formularios (cuántos campos, nunca los valores)
  const formsStarted = new WeakSet();
  const onField = (e) => {
    try {
      const field = e.target instanceof Element ? e.target.closest(FIELD) : null;
      if (!field || field.closest("[data-track-ignore]")) return;
      const form = formOf(field);
      let touched = fieldsTouched.get(form);
      if (!touched) fieldsTouched.set(form, (touched = new Set()));
      const key = field.getAttribute("name") || field.id || field;
      if (!touched.has(key)) {
        touched.add(key);
        touchedTotal++;
      }
      if (!formsStarted.has(form)) {
        formsStarted.add(form);
        push("form_start", { label: formLabel(form), target: contextOf(form), data: { fields: form.querySelectorAll(FIELD).length } });
      }
    } catch {
      /* nada */
    }
  };
  document.addEventListener("input", onField, { capture: true, passive: true });
  document.addEventListener("change", onField, { capture: true, passive: true });
  document.addEventListener(
    "submit",
    (e) => {
      try {
        const form = e.target instanceof Element ? e.target : null;
        if (!form) return;
        push("form_submit", {
          label: formLabel(form),
          target: contextOf(form),
          data: { fields: form.querySelectorAll(FIELD).length, fields_touched: (fieldsTouched.get(form) || new Set()).size },
        });
      } catch {
        /* nada */
      }
    },
    { capture: true },
  );

  // ---------------------------------------------------------------- llamadas a /api del panel
  window.fetch = async function trackedFetch(input, init) {
    let url;
    let method = "GET";
    try {
      const req = typeof Request !== "undefined" && input instanceof Request ? input : null;
      url = new URL(req ? req.url : String(input), location.href);
      method = String((init && init.method) || (req && req.method) || "GET").toUpperCase();
    } catch {
      return origFetch(input, init);
    }
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/") || url.pathname === ACTIVITY_ENDPOINT) return origFetch(input, init);
    const t0 = Date.now();
    lastFetch = t0;
    const endpoint = `${method} ${url.pathname}`.slice(0, 200);
    try {
      const res = await origFetch(input, init);
      const ms = Date.now() - t0;
      if (!res.ok) {
        errorMessage(res.clone()).then((msg) => push("api_error", { label: msg, target: endpoint, status: res.status, duration_ms: ms, data: { method } }));
      } else if (method !== "GET" || ms >= SLOW_GET_MS) {
        push("api_call", { target: endpoint, status: res.status, duration_ms: ms, data: { method } });
      }
      return res;
    } catch (err) {
      if (!(err && err.name === "AbortError")) {
        push("api_error", { label: "Sin conexión o la petición se cortó", target: endpoint, status: 0, duration_ms: Date.now() - t0, data: { method, network: true } });
      }
      throw err;
    }
  };

  // ---------------------------------------------------------------- errores de JavaScript y recursos
  const seen = new Map();
  const reportError = (kind, message, extra = {}) => {
    const msg = clean(message, 200);
    if (!msg || /^Script error\.?$/i.test(msg) || /ResizeObserver loop/i.test(msg)) return;
    const n = (seen.get(msg) || 0) + 1;
    seen.set(msg, n);
    if (n > MAX_SAME_ERROR) return;
    push("js_error", { label: msg, data: { kind, ...extra } });
  };
  const sourcePath = (src) => {
    if (!src) return "";
    if (/^(chrome|moz|safari|safari-web)-extension:/i.test(src)) return null; // extensiones del navegador: no es nuestro
    try {
      const url = new URL(src, location.href);
      return url.origin === location.origin ? url.pathname.slice(0, 160) : url.host;
    } catch {
      return "";
    }
  };
  const shortStack = (stack) => {
    if (!stack) return undefined;
    return String(stack)
      .split("\n")
      .slice(0, 6)
      .map((line) => line.replace(/\bhttps?:\/\/[^/\s]+/g, "").trim())
      .join("\n")
      .slice(0, 800);
  };
  window.addEventListener(
    "error",
    (e) => {
      try {
        const el = e.target;
        if (el && el !== window && el.tagName) {
          // Recurso que no cargó: solo scripts y hojas de estilo (las imágenes rotas no traban el panel)
          if (el.tagName === "SCRIPT" || (el.tagName === "LINK" && /stylesheet|modulepreload/i.test(el.rel || ""))) {
            const src = sourcePath(el.src || el.href);
            if (src !== null) reportError("resource", `No cargó ${el.tagName === "SCRIPT" ? "un script" : "un estilo"}: ${src}`, { source: src });
          }
          return;
        }
        const source = sourcePath(e.filename);
        if (source === null) return;
        reportError("error", e.message || (e.error && e.error.message), { source, line: e.lineno || undefined, col: e.colno || undefined, stack: shortStack(e.error && e.error.stack) });
      } catch {
        /* nada */
      }
    },
    { capture: true },
  );
  window.addEventListener("unhandledrejection", (e) => {
    try {
      const reason = e.reason;
      reportError("rejection", (reason && (reason.message || String(reason))) || "Promesa rechazada", { stack: shortStack(reason && reason.stack) });
    } catch {
      /* nada */
    }
  });

  // ---------------------------------------------------------------- mensajes que vio (alert, confirm, toasts)
  const origAlert = window.alert;
  window.alert = function trackedAlert(message) {
    try {
      push("ui_message", { label: clean(message, 200), data: { source: "alert", level: levelOf(message) } });
    } catch {
      /* nada */
    }
    return origAlert.apply(window, arguments);
  };
  const origConfirm = window.confirm;
  window.confirm = function trackedConfirm(message) {
    const result = origConfirm.apply(window, arguments);
    try {
      push("ui_message", { label: clean(message, 200), data: { source: "confirm", level: "info", result: result ? "accepted" : "cancelled" } });
    } catch {
      /* nada */
    }
    return result;
  };
  window.addEventListener("aitickets:toast", (e) => {
    try {
      const detail = e.detail || {};
      push("ui_message", { label: clean(detail.message, 200), data: { source: "toast", level: ["error", "success", "warning"].includes(detail.type) ? detail.type : "info" } });
    } catch {
      /* nada */
    }
  });

  // ---------------------------------------------------------------- #secciones y eventos propios
  window.addEventListener("hashchange", (e) => {
    try {
      const hash = (u) => {
        const h = new URL(u).hash;
        return /^#[\w-]{1,40}$/.test(h) ? h : "";
      };
      push("navigation", { data: { from: hash(e.oldURL), to: hash(e.newURL) } });
    } catch {
      /* nada */
    }
  });
  if (location.hash && /^#[\w-]{1,40}$/.test(location.hash)) push("navigation", { data: { from: "", to: location.hash } });

  /** window.aitTrack("serie_aprobada", { slots: 10 }): para instrumentar algo puntual sin tocar este archivo. */
  window.aitTrack = (name, props) => {
    try {
      push("custom", { label: clean(name, 80), data: { props: props && typeof props === "object" ? props : {} } });
    } catch {
      /* nada */
    }
  };
}

// Atribución de compras (contrato C10): de dónde llegó el comprador (?ref= y utm_*) a la página del evento.
//
// Modelo: ÚLTIMO TOQUE POR EVENTO, VENTANA DE 7 DÍAS, en el navegador.
//   - Cada visita a la página de un evento con ?ref= o utm_* guarda ese toque para ESE evento (pisa el anterior).
//   - Una visita sin parámetros (directa, volver más tarde, recargar) no lo borra.
//   - Al comprar se manda el toque guardado si tiene menos de 7 días; luego queda en event_orders.ref / utm_*.
//   - Un toque de otro evento no se usa (un DM del evento A no se lleva la venta del evento B).
// Se guarda en localStorage (sobrevive a cerrar la pestaña o volver otro día en el mismo navegador) y en
// sessionStorage (respaldo si localStorage está bloqueado). Si la persona cambia de navegador (p. ej. sale del
// navegador de Instagram a Safari) el toque se pierde: no hay forma de unirlo sin login.
//
// Sin dependencias: lo usan la página del evento (script del navegador), el checkout y los tests en Node.

export const ATTRIBUTION_KEY = "aitickets_attribution";
export const ATTRIBUTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = `${ATTRIBUTION_KEY}:`;

const clip = (v) => (v ? String(v).slice(0, 128) : null);
const eventKey = (eventId) => `${PREFIX}${eventId}`;

/** Toque de la URL (?ref= y utm_*) o null si no trae ninguno. */
export function attributionFromSearch(search, now = Date.now()) {
  const p = new URLSearchParams(search || "");
  const ref = p.get("ref");
  const source = p.get("utm_source");
  const medium = p.get("utm_medium");
  const campaign = p.get("utm_campaign");
  if (!ref && !source && !medium && !campaign) return null;
  return {
    ref: clip(ref),
    utm: { source: clip(source), medium: clip(medium), campaign: clip(campaign) },
    landing_at: new Date(now).toISOString(),
  };
}

const safeGet = (storage, key) => {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
};
const safeSet = (storage, key, value) => {
  try {
    if (storage) storage.setItem(key, value);
  } catch {
    /* almacenamiento bloqueado o lleno */
  }
};

const browserStorages = () => {
  const get = (name) => {
    try {
      return globalThis[name] ?? null;
    } catch {
      return null;
    }
  };
  return { local: get("localStorage"), session: get("sessionStorage") };
};

/** Borra de localStorage los toques vencidos (no crece sin límite si la persona ve muchos eventos). */
function pruneExpired(local, now) {
  try {
    if (!local) return;
    const stale = [];
    for (let i = 0; i < local.length; i++) {
      const key = local.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const rec = parse(local.getItem(key));
      if (!rec || !fresh(rec, now)) stale.push(key);
    }
    for (const key of stale) local.removeItem(key);
  } catch {
    /* nada */
  }
}

function parse(raw) {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    return null;
  }
}

const fresh = (rec, now) => {
  const at = Date.parse(rec.landing_at || "");
  return Number.isFinite(at) && now - at <= ATTRIBUTION_TTL_MS && at - now <= 60_000;
};

/**
 * Guarda el toque de la URL actual para el evento (si la URL trae ref o utm). Devuelve el toque guardado o null.
 * storages: { local, session } (por defecto los del navegador).
 */
export function captureAttribution(eventId, search, { now = Date.now(), storages = browserStorages() } = {}) {
  const rec = attributionFromSearch(search, now);
  if (!rec) return null;
  const withEvent = { ...rec, event_id: eventId != null ? Number(eventId) : null };
  const raw = JSON.stringify(withEvent);
  if (eventId != null) {
    pruneExpired(storages.local, now);
    safeSet(storages.local, eventKey(eventId), raw);
  }
  safeSet(storages.session, ATTRIBUTION_KEY, raw);
  return withEvent;
}

const present = (rec) => {
  const utm = rec.utm && typeof rec.utm === "object"
    ? { source: rec.utm.source || undefined, medium: rec.utm.medium || undefined, campaign: rec.utm.campaign || undefined }
    : undefined;
  return { ref: rec.ref || undefined, utm };
};

/**
 * Toque vigente para el evento: el de localStorage (7 días) o, si no hay, el de esta pestaña (sessionStorage) cuando
 * es del mismo evento o no dice de cuál es (lo guardado antes de este cambio). Sin toque: {}.
 */
export function readAttribution(eventId, { now = Date.now(), storages = browserStorages() } = {}) {
  if (eventId != null) {
    const rec = parse(safeGet(storages.local, eventKey(eventId)));
    if (rec && fresh(rec, now)) return present(rec);
  }
  const tab = parse(safeGet(storages.session, ATTRIBUTION_KEY));
  if (!tab) return {};
  const sameEvent = tab.event_id == null || eventId == null || Number(tab.event_id) === Number(eventId);
  if (!sameEvent || (tab.landing_at && !fresh(tab, now))) return {};
  return present(tab);
}

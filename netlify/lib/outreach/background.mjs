// Disparo de background functions del outreach desde otra función (tick o webhook).
// El destino (que recibe x-internal-secret) NUNCA se deriva de req.url/Host: un dominio propio de un
// productor es alias del mismo sitio y podría apuntar a un servidor ajeno. Se usa DEPLOY_URL (permalink
// del mismo deploy que está corriendo) y, si falta, SITE_URL; nunca process.env.URL. Siempre se hace `await` del fetch: la background function responde 202 al
// instante, y un fetch sin await puede perderse cuando la función que lo lanza termina.

export const BACKGROUND_FUNCTIONS = ['leads-discover-background', 'leads-enrich-background', 'outreach-send-background', 'outreach-classify-background', 'passline-watch-background']

/** Origen confiable para llamar a otras funciones del mismo deploy ("" si no hay ninguno configurado). */
export function functionsOrigin(req) {
  const trusted = (process.env.DEPLOY_URL || process.env.SITE_URL || '').trim().replace(/\/+$/, '')
  if (/^https?:\/\//i.test(trusted)) return trusted
  // Solo en desarrollo local (sin DEPLOY_URL/SITE_URL) se acepta el origen de la request, y solo si es localhost.
  try {
    const u = new URL(req.url)
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.origin
  } catch { /* req sin URL absoluta */ }
  return ''
}

/** Invoca una background function y espera su 202. Devuelve {name, status} o {name, error}. */
export async function triggerBackground(origin, name, body = {}) {
  if (!BACKGROUND_FUNCTIONS.includes(name)) return { name, error: 'unknown_function' }
  const secret = process.env.INTERNAL_API_SECRET
  if (!origin || !secret) return { name, error: !origin ? 'no_origin' : 'no_internal_secret' }
  try {
    const res = await fetch(`${origin}/.netlify/functions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    return { name, status: res.status }
  } catch (err) {
    return { name, error: String(err?.message || err).slice(0, 200) }
  }
}

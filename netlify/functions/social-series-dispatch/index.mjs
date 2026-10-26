// Función programada (cada 15 min, config.schedule abajo): pasada del job de la difusión automática en Instagram.
// La lógica (render de las piezas con Satori, cortes y llamadas a Zernio) vive en el servidor de Astro
// (src/lib/socialSeries.ts, POST /api/social-series/run): esta función solo la dispara con x-internal-secret.
import { SITE_URL } from '../../lib/mailer.mjs'

export default async function handler() {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) {
    console.error('social-series-dispatch: falta INTERNAL_API_SECRET')
    return new Response(JSON.stringify({ error: 'INTERNAL_API_SECRET no configurado' }), { status: 500 })
  }
  try {
    const res = await fetch(`${SITE_URL}/api/social-series/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: '{}',
      signal: AbortSignal.timeout(28_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) console.error('social-series-dispatch:', res.status, JSON.stringify(body).slice(0, 300))
    else if (body.dispatched || body.failed || Object.keys(body.reconciled || {}).some((k) => k !== 'ok' && k !== 'paused')) {
      console.log('📸 Difusión automática:', JSON.stringify(body))
    }
    return new Response(JSON.stringify(body), { status: res.ok ? 200 : 502 })
  } catch (error) {
    console.error('Error en social-series-dispatch:', error?.message)
    return new Response(JSON.stringify({ error: 'Error interno' }), { status: 500 })
  }
}

export const config = {
  schedule: '*/15 * * * *',
}

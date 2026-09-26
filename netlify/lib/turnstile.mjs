// Verificación de Cloudflare Turnstile para Netlify Functions (misma lógica que src/lib/turnstile.ts).
// Si no hay TURNSTILE_SECRET_KEY + site key configurados (desarrollo), la verificación se omite.

/** Site key pública (no es secreta). Se entrega al navegador vía GET /api/purchase-ticket si no hay PUBLIC_TURNSTILE_SITE_KEY en el build. */
export function turnstileSiteKey() {
  return process.env.PUBLIC_TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || ''
}

export function isTurnstileEnabled() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && turnstileSiteKey())
}

/** @returns {Promise<{success: boolean, skipped?: boolean, message?: string}>} */
export async function verifyTurnstile(token, remoteip) {
  if (!isTurnstileEnabled()) return { success: true, skipped: true }
  if (!token || typeof token !== 'string' || token.length > 4096) {
    return { success: false, message: 'Completa la verificación de seguridad (CAPTCHA).' }
  }
  const body = { secret: process.env.TURNSTILE_SECRET_KEY, response: token }
  if (remoteip) body.remoteip = remoteip
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data?.success) {
      console.warn('Turnstile falló:', JSON.stringify(data?.['error-codes'] || []))
      return { success: false, message: 'La verificación de seguridad falló. Intenta nuevamente.' }
    }
    return { success: true }
  } catch (err) {
    console.error('Error verificando Turnstile:', err?.message)
    return { success: false, message: 'No pudimos verificar la seguridad. Intenta nuevamente.' }
  }
}

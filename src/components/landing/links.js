// Enlaces y textos compartidos de las landings de productores (una sola fuente: antes estaban repetidos).
// Las tarifas y plazos vienen de fees.mjs / legal.mjs: no escribir números a mano en los componentes.

export const WHATSAPP_NUMBER = '56982347140'
export const whatsappUrl = (text = 'Hola, quiero vender entradas con AI Tickets') =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`

export const DEMO_CALL_URL = 'https://calendar.app.google/CMt97vedNjzBaoEX7'

/**
 * Enlace interno con parámetros en el fragmento (#), nunca en la query (?).
 *
 * Por qué: cada combinación de query es otra URL para Google. Con ?utm_*=… en los botones internos, Search Console
 * acumulaba decenas de "Página alternativa con etiqueta canónica adecuada" (una por botón y por evento), y los
 * utm_* internos además pisan en GA4 la fuente real de la sesión (orgánico, Instagram…). Google ignora el
 * fragmento: la URL rastreada es la canónica. La página de destino lo lee en el navegador (ProducerRegisterForm) y
 * el clic ya se mide en GA4 con data-cta / data-section (CtaTracking.astro y los *Tracking.astro de cada landing).
 */
export const withFragmentParams = (path, params = {}) => {
  const p = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) p.set(key, String(value))
  const qs = p.toString()
  return qs ? `${path}#${qs}` : path
}

/**
 * Registro de productor. next = destino tras el onboarding (src/lib/onboarding.ts); source/medium/campaign = origen
 * que queda guardado en la cuenta (organizations.signup_utm_*), igual que antes con la query.
 */
export const signupUrl = ({ next = '', source = 'aitickets', medium = 'landing', campaign = '' } = {}) =>
  withFragmentParams('/organizadores/registro', { next, utm_source: source, utm_medium: medium, utm_campaign: campaign })

/** Registro que termina en "Crear evento". campaign identifica la página/sección y queda guardada en la cuenta. */
export const publishUrl = (campaign = 'landing') => signupUrl({ next: '/dashboard/events/create', campaign })

/** Registro que termina en "Conecta tu IA" (/dashboard/ia). */
export const connectAiUrl = (campaign = 'ia') => signupUrl({ next: '/dashboard/ia', campaign })

export const DEMO_EVENT_URL = '/eventos/evento-demo-aitickets'

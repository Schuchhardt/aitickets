// Setup de los tests unitarios: entorno limpio y sin red.
// - Borra las variables que cambian el comportamiento del código (claves, interruptores, datos legales),
//   para que el entorno del desarrollador (o un `source .env`) no altere los resultados.
// - Bloquea fetch: ningún test unitario debe salir a la red. Excepción: las evals opt-in del
//   clasificador (RUN_LLM_EVALS=1 + ANTHROPIC_API_KEY), que llaman a Claude a propósito.
import { afterEach, beforeEach, vi } from 'vitest'

const RUN_LLM_EVALS = process.env.RUN_LLM_EVALS === '1' && Boolean(process.env.ANTHROPIC_API_KEY)

const SCRUB_PREFIXES = [
  'STRIPE_', 'FLOW_', 'OUTREACH_', 'CHANIUM_', 'LEGAL_', 'SITES_', 'INSTANTLY_', 'NETLIFY_', 'CLOUDFLARE_',
  'MAILGUN_', 'TURNSTILE_', 'SUPABASE_', 'GOOGLE_', 'LEADS_', 'SLACK_', 'DOMAIN_',
]
const SCRUB_NAMES = [
  'PAYMENT_PROVIDERS', 'LEAD_TOKEN_SECRET', 'EMAIL_VERIFY_SECRET', 'INTERNAL_API_SECRET', 'TENANT_PROXY_SECRET',
  'MAIN_HOSTS', 'SITE_URL', 'URL', 'DEPLOY_URL', 'DATABASE_URL', 'SERVICE_FEE_TAX_MODE', 'MAIL_FROM', 'TICKETS_BCC',
  'ANTHROPIC_MODEL', 'ANTHROPIC_MODEL_FAST',
]

for (const name of Object.keys(process.env)) {
  if (SCRUB_NAMES.includes(name) || SCRUB_PREFIXES.some((p) => name.startsWith(p))) delete process.env[name]
}
if (!RUN_LLM_EVALS) delete process.env.ANTHROPIC_API_KEY

const blockedFetch = async (input) => {
  throw new Error(`Test unitario intentó usar la red: ${typeof input === 'string' ? input : input?.url || input}`)
}

beforeEach(() => {
  if (!RUN_LLM_EVALS) vi.stubGlobal('fetch', blockedFetch)
  // Silenciar logs esperados del código bajo prueba (errores de guardrails, avisos de Slack sin webhook)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

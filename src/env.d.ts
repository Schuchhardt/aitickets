/// <reference types="astro/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/**
 * Sitio de productor resuelto por el middleware (tabla aitickets_sites). El tipo completo vive en
 * src/lib/sites.ts (SiteRecord); aquí solo lo mínimo para no acoplar este archivo a ese módulo.
 */
interface AiticketsSiteLocal {
  id: number
  organization_id: number
  slug: string
  template?: string
  custom_domain?: string | null
  published?: boolean
  [key: string]: any
}

declare namespace App {
  interface Locals {
    /** Sitio del productor cuando la petición llega por /o/<slug>, <slug>.aitickets.cl o dominio propio. */
    site?: AiticketsSiteLocal | null
    /** Host efectivo del visitante (X-Tenant-Host del proxy o Host). */
    effectiveHost?: string
  }
}

/** Variables de entorno (ver .env.example). Todas son strings; los interruptores son 'true'/'false'. */
interface AiticketsEnv {
  // Variables previas a feat/autonomy: tipadas como string (el código existente asume que están
  // configuradas). Las nuevas (más abajo) son opcionales: todo interruptor debe tolerar su ausencia.
  // Supabase / sitio
  readonly SUPABASE_URL: string
  readonly SUPABASE_SERVICE_ROLE_KEY: string
  readonly SITE_URL: string
  readonly INTERNAL_API_SECRET: string

  // Captcha, mapas
  readonly TURNSTILE_SITE_KEY: string
  readonly TURNSTILE_SECRET_KEY: string
  readonly PUBLIC_TURNSTILE_SITE_KEY: string
  readonly PUBLIC_GOOGLE_MAPS_API_KEY: string

  // Flow
  readonly FLOW_API_KEY: string
  readonly FLOW_SECRET_KEY: string
  readonly FLOW_BASE_URL: string
  readonly FLOW_PAYMENT_METHOD: string
  readonly FLOW_MERCHANT_LEGAL_NAME?: string

  // Correo / notificaciones
  readonly RESEND_API_KEY: string
  readonly RESEND_DOMAIN?: string
  readonly MAIL_FROM?: string
  readonly TICKETS_BCC?: string
  readonly MAILERLITE_API_TOKEN: string
  readonly MAILERLITE_GROUP_ID: string
  readonly SLACK_WEBHOOK_URL: string

  // IA
  readonly ANTHROPIC_API_KEY: string
  readonly ANTHROPIC_MODEL: string
  readonly ANTHROPIC_MODEL_FAST?: string
  readonly OPENAI_API_KEY: string
  readonly OPENAI_IMAGE_MODEL: string

  // Redes / ads
  readonly ZERNIO_API_KEY: string
  readonly META_APP_ID: string
  readonly META_APP_SECRET: string
  readonly META_ADS_ENABLED: string
  readonly TOKEN_ENCRYPTION_KEY: string

  // BD / migraciones
  readonly SUPABASE_DB_URL?: string
  readonly DATABASE_URL?: string
  readonly SUPABASE_DB_CA?: string
  readonly SUPABASE_POOLER_HOST?: string
  readonly MIGRATE_ON_BUILD?: string
  readonly ALLOW_MISSING_DB_URL?: string

  // Pagos
  readonly PAYMENT_PROVIDERS?: string
  readonly STRIPE_SECRET_KEY?: string
  readonly STRIPE_WEBHOOK_SECRET?: string
  readonly STRIPE_API_VERSION?: string
  readonly STRIPE_HOLD_MINUTES?: string
  readonly STRIPE_LIVE_APPROVED?: string
  readonly STRIPE_MIN_AMOUNT_CLP?: string
  readonly SERVICE_FEE_TAX_MODE?: string

  // Sitios / dominios
  readonly SITES_ROOT_DOMAIN?: string
  readonly SITES_WILDCARD_ENABLED?: string
  readonly TENANT_PROXY_SECRET?: string
  readonly MAIN_HOSTS?: string
  readonly DOMAIN_PROVIDER?: string
  readonly NETLIFY_AUTH_TOKEN?: string
  readonly NETLIFY_SITE_ID?: string
  readonly SITES_MAX_NETLIFY_ALIASES?: string
  readonly SITES_CNAME_TARGET?: string
  readonly DOMAIN_CHECKS_DISABLED?: string
  readonly TENANT_ROUTER_DISABLED?: string
  readonly CLOUDFLARE_API_TOKEN?: string
  readonly CLOUDFLARE_ZONE_ID?: string
  readonly CLOUDFLARE_ACCOUNT_ID?: string

  // Outreach
  readonly OUTREACH_ENABLED?: string
  readonly OUTREACH_DRY_RUN?: string
  readonly OUTREACH_AUTO_REPLY?: string
  readonly OUTREACH_PROVIDER?: string
  readonly OUTREACH_LIA_APPROVED?: string
  readonly OUTREACH_DAILY_CAP?: string
  readonly OUTREACH_PER_MAILBOX_CAP?: string
  readonly OUTREACH_MAX_FOLLOWUPS?: string
  readonly OUTREACH_RECONTACT_DAYS?: string
  readonly OUTREACH_AUTO_REPLY_MIN_CONFIDENCE?: string
  readonly OUTREACH_COUNTRIES?: string
  readonly OUTREACH_DOMAIN?: string
  readonly OUTREACH_FROM_NAME?: string
  readonly OUTREACH_UNSUB_MAILTO?: string
  readonly OUTREACH_UNSUB_SECRET?: string
  readonly OUTREACH_LLM_TOKENS_PER_RUN?: string
  readonly OUTREACH_LLM_TOKENS_PER_DAY?: string
  readonly OUTREACH_DISCOVER_MAX_PER_RUN?: string
  readonly OUTREACH_ENRICH_BATCH?: string
  readonly OUTREACH_WEBHOOK_SECRET?: string
  readonly LEAD_TOKEN_SECRET?: string
  readonly INSTANTLY_API_KEY?: string
  readonly INSTANTLY_CAMPAIGN_ID?: string
  readonly GOOGLE_PLACES_API_KEY?: string
  readonly LEADS_PLACES_MAX_QUERIES?: string
  readonly LEADS_WEBSEARCH_MAX?: string
  readonly SLACK_OUTREACH_WEBHOOK_URL?: string

  // Legal (Chanium LLC)
  readonly CHANIUM_LEGAL_STATE?: string
  readonly CHANIUM_LEGAL_ADDRESS?: string
  readonly CHANIUM_LEGAL_EMAIL?: string
  readonly CHANIUM_PRIVACY_EMAIL?: string
  readonly LEGAL_EFFECTIVE_DATE?: string
  readonly LEGAL_SUPPORT_EMAIL?: string
  readonly LEGAL_PRIVACY_EMAIL?: string
  readonly LEGAL_CONTACT_EMAIL?: string

  // Verificación de email
  readonly EMAIL_VERIFY_SECRET?: string

  // Netlify (las define la plataforma)
  readonly CONTEXT?: string
  readonly NETLIFY_DEV?: string
  readonly URL?: string
  readonly DEPLOY_URL?: string
  readonly DEPLOY_PRIME_URL?: string
  readonly COMMIT_REF?: string

  // Tests
  readonly E2E_BASE_URL?: string
  readonly E2E_REAL_EVENT_SLUG?: string
  readonly RUN_LLM_EVALS?: string
}

interface ImportMetaEnv extends AiticketsEnv {}

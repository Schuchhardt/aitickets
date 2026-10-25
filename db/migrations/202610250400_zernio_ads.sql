-- Anuncios pagados en Meta (Facebook e Instagram) a través de Zernio. Idempotente.
--
-- Antes la integración hablaba directo con la Graph API de Meta (app propia, tokens cifrados) y quedó apagada
-- ("Próximamente"). Ahora todo pasa por Zernio, que es Meta Marketing Partner: la productora autoriza su cuenta
-- publicitaria una vez y AI Tickets crea, pausa y mide los anuncios con ZERNIO_API_KEY (netlify/lib/zernio-ads.mjs).
-- Meta le cobra el gasto directamente a la cuenta publicitaria de la productora; AI Tickets no toca ese dinero.
--
-- 1) ad_account_connections: una fila por cuenta publicitaria de Meta (act_...) de la organización.
--    provider 'zernio' (las filas antiguas quedan 'meta_direct' y ya no se usan). zernio_account_id = la conexión de
--    anuncios en Zernio (accountId de sus endpoints); meta_ad_account_id = act_...; currency y minimum_daily_budget
--    vienen de Meta (unidades enteras de la moneda de la cuenta). status: active | unusable (Meta no la deja anunciar,
--    unusable_reason dice por qué) | revoked (la productora la desconectó en AI Tickets).
--
-- 2) ad_campaigns: una fila por anuncio creado desde AI Tickets. provider 'zernio', zernio_ad_id = _id del anuncio en
--    Zernio. ad_type 'standalone' (anuncio nuevo con imagen y texto) o 'boost' (un post ya publicado, social_post_id).
--    El link del anuncio lleva utm_source=meta&utm_medium=paid&utm_campaign=ad-<id>: así cada venta queda atribuida a
--    su anuncio (panel y reporte semanal). status: creating | pending_review | active | paused | completed | rejected |
--    cancelled | error (sin CHECK, igual que antes). review_status: in_review | approved | rejected | with_issues.
--    zernio_request: el cuerpo exacto enviado a Zernio (sin secretos). Si la creación se cortó (timeout) la fila queda
--    'creating' y se reenvía ese mismo cuerpo con la misma Idempotency-Key: Zernio devuelve el anuncio ya creado en
--    vez de crear otro, así nunca queda un anuncio gastando sin que AI Tickets lo sepa.
--
-- 0) La integración directa con Meta nunca llegó a producción: ahí NO existen ad_account_connections ni ad_campaigns
--    (db/schema.sql sí las trae, por eso el CI no lo detectaba). Se crean con la definición de db/schema.sql si faltan,
--    con RLS activado sin políticas y sin acceso para anon/authenticated (igual que 20260926_Z_lockdown_rls.sql).

CREATE TABLE IF NOT EXISTS public.ad_account_connections (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  organization_id bigint NOT NULL,
  platform text NOT NULL DEFAULT 'meta'::text,
  meta_ad_account_id text,
  meta_user_id text,
  account_name text,
  access_token text,
  token_expires_at timestamp with time zone,
  status text NOT NULL DEFAULT 'active'::text,
  CONSTRAINT ad_account_connections_pkey PRIMARY KEY (id),
  CONSTRAINT ad_account_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ad_account_connections_org ON public.ad_account_connections(organization_id);

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  organization_id bigint NOT NULL,
  event_id bigint NOT NULL,
  ad_account_connection_id bigint NOT NULL,
  meta_campaign_id text,
  name text NOT NULL,
  objective text NOT NULL DEFAULT 'OUTCOME_TRAFFIC'::text,
  status text NOT NULL DEFAULT 'draft'::text,
  daily_budget numeric NOT NULL DEFAULT 0,
  total_budget numeric,
  currency text NOT NULL DEFAULT 'CLP'::text,
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  ad_copy text,
  headline text,
  image_urls text[] DEFAULT '{}',
  call_to_action text DEFAULT 'LEARN_MORE'::text,
  destination_url text,
  target_audience jsonb DEFAULT '{}'::jsonb,
  impressions bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  spend numeric DEFAULT 0,
  conversions bigint DEFAULT 0,
  reach bigint DEFAULT 0,
  cpc numeric DEFAULT 0,
  cpm numeric DEFAULT 0,
  last_synced_at timestamp with time zone,
  meta_adset_id text,
  meta_ad_id text,
  error_message text,
  CONSTRAINT ad_campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT ad_campaigns_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT ad_campaigns_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE,
  CONSTRAINT ad_campaigns_ad_account_connection_id_fkey FOREIGN KEY (ad_account_connection_id) REFERENCES public.ad_account_connections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_org ON public.ad_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_event ON public.ad_campaigns(event_id);

ALTER TABLE public.ad_account_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ad_account_connections FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_campaigns FROM anon, authenticated;

ALTER TABLE public.ad_account_connections
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta_direct',
  ADD COLUMN IF NOT EXISTS zernio_account_id text,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS timezone_name text,
  ADD COLUMN IF NOT EXISTS minimum_daily_budget numeric,
  ADD COLUMN IF NOT EXISTS unusable_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_account_connections_provider_check') THEN
    ALTER TABLE public.ad_account_connections
      ADD CONSTRAINT ad_account_connections_provider_check CHECK (provider IN ('meta_direct', 'zernio'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ad_account_connections_org_provider
  ON public.ad_account_connections (organization_id, provider, status);

COMMENT ON COLUMN public.ad_account_connections.provider IS
  'zernio = cuenta publicitaria de Meta conectada vía Zernio (la que se usa); meta_direct = integración antigua, sin uso.';
COMMENT ON COLUMN public.ad_account_connections.zernio_account_id IS
  'Conexión de anuncios en Zernio (accountId de /v1/ads/*). meta_ad_account_id es la cuenta act_... de Meta.';

ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta_direct',
  ADD COLUMN IF NOT EXISTS zernio_ad_id text,
  ADD COLUMN IF NOT EXISTS ad_type text NOT NULL DEFAULT 'standalone',
  ADD COLUMN IF NOT EXISTS social_post_id bigint REFERENCES public.social_posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_status text,
  ADD COLUMN IF NOT EXISTS duration_days integer,
  ADD COLUMN IF NOT EXISTS ctr numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS zernio_request jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_campaigns_provider_check') THEN
    ALTER TABLE public.ad_campaigns
      ADD CONSTRAINT ad_campaigns_provider_check CHECK (provider IN ('meta_direct', 'zernio'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_campaigns_ad_type_check') THEN
    ALTER TABLE public.ad_campaigns
      ADD CONSTRAINT ad_campaigns_ad_type_check CHECK (ad_type IN ('standalone', 'boost'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_campaigns_duration_days_check') THEN
    ALTER TABLE public.ad_campaigns
      ADD CONSTRAINT ad_campaigns_duration_days_check CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 90);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_org_provider_created
  ON public.ad_campaigns (organization_id, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_event_provider
  ON public.ad_campaigns (event_id, provider);

COMMENT ON COLUMN public.ad_campaigns.zernio_ad_id IS
  'Anuncio en Zernio (_id). Su link lleva utm_campaign=ad-<id de esta fila> para atribuir las ventas.';

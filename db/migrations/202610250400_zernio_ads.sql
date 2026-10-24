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

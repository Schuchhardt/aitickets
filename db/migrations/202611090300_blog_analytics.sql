-- Analítica propia del blog (docs/specs/blog-seo.md, "Medición"). Idempotente.
--
-- Search Console dice cuántas veces Google mostró un artículo y cuántos clics recibió (con ~3 días de atraso, solo
-- tráfico de Google). Esto mide lo que pasa en el sitio, venga de donde venga:
--
-- 1) aitickets_blog_visits: cada lectura de un artículo (kind = 'view') y cada clic hacia AI Tickets desde el artículo
--    (kind = 'cta', con la ruta de destino en cta_path). La registra el navegador (/api/blog/visit), igual que las
--    visitas de eventos, y marca los bots con netlify/lib/visit-bots.mjs (is_bot + bot_reason; no se borran).
--    source = de dónde llegó: search, ai (ChatGPT, Perplexity…), social, campaign (utm), internal, referral, direct
--    (netlify/lib/blog/traffic.mjs).
-- 2) aitickets_blog_post_stats(p_from, p_to): por artículo, lecturas, lectores únicos, clics al CTA, lectores por
--    fuente y productores registrados desde el artículo (organizations.signup_ref = 'blog_<slug>', que deja el
--    artículo en la atribución del registro). Sin bots.
-- 3) aitickets_blog_daily(p_from, p_to, p_post_id): la serie diaria (hora de Chile) de todo el blog o de un artículo.
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated; las funciones solo para service_role.

CREATE TABLE IF NOT EXISTS public.aitickets_blog_visits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  post_id bigint NOT NULL REFERENCES public.aitickets_blog_posts(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'view' CHECK (kind IN ('view', 'cta')),
  ip_hash text NOT NULL,
  source text NOT NULL DEFAULT 'direct' CHECK (source IN ('search', 'ai', 'social', 'campaign', 'internal', 'referral', 'direct')),
  referrer text CHECK (referrer IS NULL OR char_length(referrer) <= 1024),
  utm_source text CHECK (utm_source IS NULL OR char_length(utm_source) <= 256),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 256),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 256),
  cta_path text CHECK (cta_path IS NULL OR char_length(cta_path) <= 200),
  country text,
  city text,
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  is_bot boolean NOT NULL DEFAULT false,
  bot_reason text
);
CREATE INDEX IF NOT EXISTS aitickets_blog_visits_post_idx ON public.aitickets_blog_visits (post_id, created_at);
CREATE INDEX IF NOT EXISTS aitickets_blog_visits_created_idx ON public.aitickets_blog_visits (created_at);

ALTER TABLE public.aitickets_blog_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_blog_visits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.aitickets_blog_visits_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.aitickets_blog_post_stats(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  post_id bigint,
  views bigint,
  visitors bigint,
  cta_clicks bigint,
  cta_visitors bigint,
  search_visitors bigint,
  ai_visitors bigint,
  social_visitors bigint,
  campaign_visitors bigint,
  internal_visitors bigint,
  referral_visitors bigint,
  direct_visitors bigint,
  signups bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT v.post_id,
           count(*) FILTER (WHERE v.kind = 'view') AS views,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view') AS visitors,
           count(*) FILTER (WHERE v.kind = 'cta') AS cta_clicks,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'cta') AS cta_visitors,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view' AND v.source = 'search') AS search_visitors,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view' AND v.source = 'ai') AS ai_visitors,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view' AND v.source = 'social') AS social_visitors,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view' AND v.source = 'campaign') AS campaign_visitors,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view' AND v.source = 'internal') AS internal_visitors,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view' AND v.source = 'referral') AS referral_visitors,
           count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view' AND v.source = 'direct') AS direct_visitors
      FROM public.aitickets_blog_visits v
     WHERE v.created_at >= p_from
       AND v.created_at < p_to
       AND NOT v.is_bot
     GROUP BY v.post_id
  ),
  s AS (
    SELECT p.id AS post_id, count(o.id) AS signups
      FROM public.aitickets_blog_posts p
      JOIN public.organizations o ON o.signup_ref = 'blog_' || p.slug
     WHERE o.created_at >= p_from
       AND o.created_at < p_to
     GROUP BY p.id
  )
  SELECT p.id,
         coalesce(v.views, 0)::bigint,
         coalesce(v.visitors, 0)::bigint,
         coalesce(v.cta_clicks, 0)::bigint,
         coalesce(v.cta_visitors, 0)::bigint,
         coalesce(v.search_visitors, 0)::bigint,
         coalesce(v.ai_visitors, 0)::bigint,
         coalesce(v.social_visitors, 0)::bigint,
         coalesce(v.campaign_visitors, 0)::bigint,
         coalesce(v.internal_visitors, 0)::bigint,
         coalesce(v.referral_visitors, 0)::bigint,
         coalesce(v.direct_visitors, 0)::bigint,
         coalesce(s.signups, 0)::bigint
    FROM public.aitickets_blog_posts p
    LEFT JOIN v ON v.post_id = p.id
    LEFT JOIN s ON s.post_id = p.id
   WHERE p.status = 'published' OR v.post_id IS NOT NULL OR s.post_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.aitickets_blog_daily(p_from timestamptz, p_to timestamptz, p_post_id bigint DEFAULT NULL)
RETURNS TABLE (day text, views bigint, visitors bigint, cta_clicks bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_char(v.created_at AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD') AS day,
         count(*) FILTER (WHERE v.kind = 'view')::bigint AS views,
         count(DISTINCT v.ip_hash) FILTER (WHERE v.kind = 'view')::bigint AS visitors,
         count(*) FILTER (WHERE v.kind = 'cta')::bigint AS cta_clicks
    FROM public.aitickets_blog_visits v
   WHERE v.created_at >= p_from
     AND v.created_at < p_to
     AND NOT v.is_bot
     AND (p_post_id IS NULL OR v.post_id = p_post_id)
   GROUP BY 1
   ORDER BY 1;
$$;

REVOKE EXECUTE ON FUNCTION public.aitickets_blog_post_stats(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_blog_post_stats(timestamptz, timestamptz) TO service_role;
REVOKE EXECUTE ON FUNCTION public.aitickets_blog_daily(timestamptz, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_blog_daily(timestamptz, timestamptz, bigint) TO service_role;

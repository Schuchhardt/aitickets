-- WP3: sitios públicos de productores (aitickets.cl/o/<slug>, <slug>.aitickets.cl, dominio propio).
--
-- Reglas (proyecto Supabase COMPARTIDO):
--   * Solo objetos public.aitickets_*; RLS activado SIN políticas + REVOKE explícito a anon/authenticated
--     (todo el acceso es server-side con service_role, que autoriza por organization_id en el código).
--   * Expand-only e idempotente (IF NOT EXISTS). No toca tablas existentes salvo leerlas en el backfill.
--   * Sin funciones nuevas: el backfill es un bloque DO.
--
-- Publicación: un sitio es visible solo si published = true Y la organización verificó su email
-- (organizations.email_verified_at, columna de 202609270400; el código lo exige en lectura y tolera que
-- la columna aún no exista). El backfill deja published = false salvo que la organización ya tenga
-- eventos publicados. Además el sitio va con noindex mientras no tenga eventos publicados (en el código).

-- 1. Sitios (uno por organización)
CREATE TABLE IF NOT EXISTS public.aitickets_sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  template text NOT NULL DEFAULT 'clasico',
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_email text,
  contact_form_enabled boolean NOT NULL DEFAULT true,
  published boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  custom_domain text UNIQUE,
  domain_status text NOT NULL DEFAULT 'none',
  domain_provider text,
  domain_provider_id text,
  domain_verification jsonb,
  domain_error text,
  domain_requested_at timestamptz,
  domain_checked_at timestamptz,
  domain_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_sites_slug_format CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  -- Debe coincidir con RESERVED_SLUGS de src/lib/sites.ts
  CONSTRAINT aitickets_sites_slug_reserved CHECK (slug <> ALL (ARRAY[
    'www', 'api', 'app', 'admin', 'dashboard', 'mail', 'mg', 'sites', 'sites-origin', 'status', 'blog',
    'docs', 'cdn', 'static', 'assets', 'soporte', 'ayuda', 'demo', 'o', 'eventos', 'organizadores',
    'precios', 'comparar', 'web-gratis', 'bot', 'outreach', 'order', 'ticket', 'pago', 'qr'
  ]::text[])),
  CONSTRAINT aitickets_sites_template_check CHECK (template IN ('clasico', 'nocturno', 'minimal', 'festival')),
  CONSTRAINT aitickets_sites_domain_status_check CHECK (
    domain_status IN ('none', 'pending_provider', 'pending_dns', 'pending_ssl', 'active', 'failed', 'removing')
  ),
  CONSTRAINT aitickets_sites_custom_domain_lower CHECK (custom_domain IS NULL OR custom_domain = lower(custom_domain))
);

CREATE UNIQUE INDEX IF NOT EXISTS aitickets_sites_custom_domain_lower_idx
  ON public.aitickets_sites (lower(custom_domain)) WHERE custom_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS aitickets_sites_domain_status_idx
  ON public.aitickets_sites (domain_status) WHERE domain_status <> 'none';

-- 2. Banners del sitio
CREATE TABLE IF NOT EXISTS public.aitickets_site_banners (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES public.aitickets_sites(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  link_url text,
  alt text,
  placement text NOT NULL DEFAULT 'hero',
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_site_banners_placement_check CHECK (placement IN ('hero', 'top_bar', 'inline'))
);

CREATE INDEX IF NOT EXISTS aitickets_site_banners_site_idx
  ON public.aitickets_site_banners (site_id, sort_order);

-- 3. Mensajes del formulario de contacto (se guardan antes de enviar el correo al productor)
CREATE TABLE IF NOT EXISTS public.aitickets_site_contact_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES public.aitickets_sites(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  message text NOT NULL,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  mail_error text
);

CREATE INDEX IF NOT EXISTS aitickets_site_contact_messages_site_idx
  ON public.aitickets_site_contact_messages (site_id, created_at DESC);
-- Límite de envíos por IP (hash) en la última hora
CREATE INDEX IF NOT EXISTS aitickets_site_contact_messages_ip_idx
  ON public.aitickets_site_contact_messages (ip_hash, created_at DESC);

-- 4. Seguridad: solo service_role
ALTER TABLE public.aitickets_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aitickets_site_banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aitickets_site_contact_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.aitickets_sites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.aitickets_site_banners FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.aitickets_site_contact_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.aitickets_sites_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.aitickets_site_banners_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.aitickets_site_contact_messages_id_seq FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.aitickets_sites TO service_role;
GRANT ALL ON TABLE public.aitickets_site_banners TO service_role;
GRANT ALL ON TABLE public.aitickets_site_contact_messages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_sites_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_site_banners_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_site_contact_messages_id_seq TO service_role;

-- 5. Backfill: un sitio por organización existente (idempotente: omite las que ya tienen sitio).
--    slug = public_name normalizado (sin tildes, [a-z0-9-], máx. 40); si queda corto se completa con
--    el id; si es reservado o inválido se usa org-<id>; si choca se agrega -2, -3, ...
DO $$
DECLARE
  o record;
  reserved text[] := ARRAY[
    'www', 'api', 'app', 'admin', 'dashboard', 'mail', 'mg', 'sites', 'sites-origin', 'status', 'blog',
    'docs', 'cdn', 'static', 'assets', 'soporte', 'ayuda', 'demo', 'o', 'eventos', 'organizadores',
    'precios', 'comparar', 'web-gratis', 'bot', 'outreach', 'order', 'ticket', 'pago', 'qr'
  ];
  slug_re text := '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$';
  base text;
  candidate text;
  suffix text;
  n integer;
  has_published boolean;
BEGIN
  FOR o IN
    SELECT org.id, org.public_name
      FROM public.organizations org
     WHERE NOT EXISTS (SELECT 1 FROM public.aitickets_sites s WHERE s.organization_id = org.id)
     ORDER BY org.id
  LOOP
    base := lower(coalesce(o.public_name, ''));
    base := translate(base, 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc');
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '(^-+|-+$)', '', 'g');
    base := regexp_replace(left(base, 40), '-+$', '');

    IF base = '' THEN
      base := 'org-' || o.id;
    ELSIF length(base) < 3 THEN
      base := base || '-' || o.id;
    END IF;
    IF base = ANY (reserved) OR base !~ slug_re THEN
      base := 'org-' || o.id;
    END IF;

    candidate := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM public.aitickets_sites s WHERE s.slug = candidate) LOOP
      n := n + 1;
      suffix := '-' || n;
      candidate := regexp_replace(left(base, 40 - length(suffix)), '-+$', '') || suffix;
      IF n > 1000 THEN
        candidate := 'org-' || o.id;
        EXIT;
      END IF;
    END LOOP;

    SELECT EXISTS (
      SELECT 1 FROM public.events e WHERE e.organization_id = o.id AND e.status = 'published'
    ) INTO has_published;

    INSERT INTO public.aitickets_sites (organization_id, slug, published, published_at)
    VALUES (o.id, candidate, has_published, CASE WHEN has_published THEN now() ELSE NULL END)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

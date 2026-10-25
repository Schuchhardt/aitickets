-- Verificación de identidad de productores con Didit (documento + prueba de vida) y titular de la cuenta
-- bancaria = identidad verificada. Idempotente. Solo toca tablas de AI Tickets.
--
-- organizations.identity_*: resultado de la verificación (NUNCA imágenes: quedan en Didit).
--   identity_status      NULL = no iniciada | pending | approved | declined | in_review
--   identity_name/_rut   nombre y RUT del documento verificado (persona natural o representante legal)
--   identity_kind        person | company (company = la cuenta opera con razón social distinta del verificado)
--   identity_consent_at  consentimiento expreso para datos biométricos (Ley 21.719), previo a la captura
-- organizations.legal_name / legal_id (ya existen): razón social y RUT del organizador que se muestran en la
--   página del evento. Se copian desde organization_payout_accounts (legal_name/legal_rut) cuando faltan.
-- organization_payout_accounts.holder_match_status: match | mismatch | pending. mismatch bloquea retiros.
--
-- La función aitickets_public_event_page se amplía con 'trust' (razón social, RUT, verificado y estado de
-- la autorización del evento). is_massive/permit_status los crea otra migración (fondos y riesgo): se leen
-- con to_jsonb(ev) para no fallar si aún no existen.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS identity_status text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS identity_name text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS identity_rut text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS identity_session_id text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS identity_consent_at timestamptz;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS identity_checked_at timestamptz;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS identity_kind text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_identity_status_check') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_identity_status_check
      CHECK (identity_status IS NULL OR identity_status IN ('pending', 'approved', 'declined', 'in_review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_identity_kind_check') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_identity_kind_check
      CHECK (identity_kind IS NULL OR identity_kind IN ('person', 'company'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_identity_session_idx ON public.organizations (identity_session_id) WHERE identity_session_id IS NOT NULL;

ALTER TABLE public.organization_payout_accounts ADD COLUMN IF NOT EXISTS holder_match_status text;
ALTER TABLE public.organization_payout_accounts ADD COLUMN IF NOT EXISTS holder_checked_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_payout_accounts_holder_match_check') THEN
    ALTER TABLE public.organization_payout_accounts
      ADD CONSTRAINT organization_payout_accounts_holder_match_check
      CHECK (holder_match_status IS NULL OR holder_match_status IN ('match', 'mismatch', 'pending'));
  END IF;
END $$;

-- Razón social y RUT del organizador: se copian los datos de pago cuando la organización no los tiene.
UPDATE public.organizations o
   SET legal_name = COALESCE(o.legal_name, p.legal_name),
       legal_id = COALESCE(o.legal_id, p.legal_rut)
  FROM public.organization_payout_accounts p
 WHERE p.organization_id = o.id
   AND ((o.legal_name IS NULL AND p.legal_name IS NOT NULL) OR (o.legal_id IS NULL AND p.legal_rut IS NOT NULL));

-- Página pública del evento: misma función que 202610240100 (con videos) + 'trust'.
CREATE OR REPLACE FUNCTION public.aitickets_public_event_page(p_slug text DEFAULT NULL, p_event_id bigint DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.*
      FROM public.events e
     WHERE (p_event_id IS NOT NULL AND e.id = p_event_id)
        OR (p_event_id IS NULL AND p_slug IS NOT NULL AND e.slug = p_slug AND e.status = 'published')
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'event', (
      SELECT to_jsonb(x) FROM (
        SELECT ev.id, ev.slug, ev.name, ev.title, ev.description, ev.image_url, ev.location, ev.capacity, ev.status,
               ev.accessibility, ev.start_date, ev.end_date, ev.organization_id,
               ev.cover_settings, ev.fee_absorbed, ev.cover_meta, ev.page_settings, ev.cover_video, ev.gallery_video
      ) x
    ),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category_tags', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name', c.name) END) ORDER BY et.id)
        FROM public.event_tags et
        LEFT JOIN public.category_tags c ON c.id = et.tag_id
       WHERE et.event_id = ev.id
    ), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.price, t.id)
        FROM (
          SELECT tk.id, tk.ticket_name, tk.price, tk.max_quantity, tk.total_quantity, tk.status, tk.is_gift,
                 tk.init_date, tk.end_date, tk.event_date_id
            FROM public.event_tickets tk
           WHERE tk.event_id = ev.id AND tk.is_gift = false AND tk.status = 'available'
        ) t
    ), '[]'::jsonb),
    'faqs', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id)
        FROM (SELECT q.id, q.question, q.answer FROM public.event_faqs q WHERE q.event_id = ev.id) f
    ), '[]'::jsonb),
    'dates', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date, d.start_time, d.id)
        FROM (
          SELECT ed.id, ed.date, ed.start_time, ed.end_time, ed.event_location_id,
                 (
                   SELECT to_jsonb(l) FROM (
                     SELECT loc.id, loc.name, loc.display_name, loc.is_virtual,
                            loc.address_line1_override, loc.address_line2_override, loc.city_override,
                            loc.state_province_override, loc.postal_code_override, loc.country_code_override,
                            loc.latitude_override, loc.longitude_override,
                            (
                              SELECT to_jsonb(v) FROM (
                                SELECT vn.id, vn.name, vn.address_line1, vn.address_line2, vn.city, vn.state_province,
                                       vn.postal_code, vn.country_code, vn.latitude, vn.longitude, vn.timezone
                                  FROM public.venues vn
                                 WHERE vn.id = loc.venue_id
                              ) v
                            ) AS venues
                       FROM public.event_locations loc
                      WHERE loc.id = ed.event_location_id
                   ) l
                 ) AS event_locations
            FROM public.event_dates ed
           WHERE ed.event_id = ev.id
        ) d
    ), '[]'::jsonb),
    'org', (
      SELECT to_jsonb(o) FROM (
        SELECT org.public_name, org.website, org.instagram FROM public.organizations org WHERE org.id = ev.organization_id
      ) o
    ),
    'trust', (
      SELECT jsonb_build_object(
        'legal_name', org.legal_name,
        'legal_rut', org.legal_id,
        'identity_status', org.identity_status,
        'is_massive', to_jsonb(ev) -> 'is_massive',
        'permit_status', to_jsonb(ev) ->> 'permit_status'
      )
        FROM public.organizations org WHERE org.id = ev.organization_id
    ),
    'has_secret_location', (ev.secret_location IS NOT NULL AND ev.secret_location <> ''),
    'gallery', COALESCE((
      SELECT jsonb_agg(to_jsonb(g) - 'created_at' ORDER BY g.position, g.created_at)
        FROM (
          SELECT gi.id, gi.url, gi.thumb_url, gi.width, gi.height, gi.caption, gi.position, gi.created_at
            FROM public.aitickets_event_gallery_images gi
           WHERE gi.event_id = ev.id
           ORDER BY gi.position, gi.created_at
           LIMIT 40
        ) g
    ), '[]'::jsonb),
    'availability', COALESCE((
      SELECT jsonb_agg(to_jsonb(a)) FROM public.aitickets_ticket_availability(ev.id) a
    ), '[]'::jsonb)
  )
  FROM ev;
$$;

REVOKE ALL ON FUNCTION public.aitickets_public_event_page(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aitickets_public_event_page(text, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_public_event_page(text, bigint) TO service_role;

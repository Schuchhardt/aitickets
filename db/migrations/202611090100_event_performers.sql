-- Artistas del evento (events.performers) y datos del JSON-LD (schema.org/Event) de la página pública. Idempotente.
--
-- Search Console (resultados enriquecidos de eventos) marcaba tres campos recomendados que faltaban:
--   performer          → events.performers: [{ "name": "Ana Tijoux", "type": "person" | "group" }] (máx. 30). Lo edita el
--                        productor (panel y API, src/lib/eventPerformers.mjs) y la página lo muestra en "Participan".
--   offers[].validFrom → desde cuándo se vende cada entrada: event_tickets.init_date o, si no tiene, su created_at.
--   organizer.url      → la web de la productora o, si no tiene, su sitio en AI Tickets (aitickets_sites).
--
-- aitickets_public_event_page: la misma función de 202610290100 con events.created_at y performers,
-- event_tickets.created_at, facebook y tiktok de la organización (sameAs) y su sitio publicado ('site', solo con el
-- correo verificado: la regla de isSitePublic en src/lib/sites.ts). Sin la migración, src/lib/eventPage.ts sigue
-- funcionando (esos datos quedan vacíos).

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS performers jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_performers_is_array') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_performers_is_array
      CHECK (performers IS NULL OR (jsonb_typeof(performers) = 'array' AND jsonb_array_length(performers) <= 30));
  END IF;
END $$;

COMMENT ON COLUMN public.events.performers IS
  'Artistas, elenco o expositores: [{name, type: person|group}] (máx. 30). JSON-LD performer. src/lib/eventPerformers.mjs.';

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
               ev.cover_settings, ev.fee_absorbed, ev.cover_meta, ev.page_settings, ev.cover_video, ev.gallery_video,
               ev.created_at, ev.performers
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
                 tk.init_date, tk.end_date, tk.event_date_id, tk.opens_after_ticket_id, tk.created_at
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
        SELECT org.public_name, org.website, org.instagram, org.facebook, org.tiktok
          FROM public.organizations org WHERE org.id = ev.organization_id
      ) o
    ),
    -- Sitio de la productora (organizer.url del JSON-LD): publicado y con el correo de la organización verificado
    'site', (
      SELECT to_jsonb(s) FROM (
        SELECT st.slug, st.custom_domain, st.domain_status
          FROM public.aitickets_sites st
          JOIN public.organizations org ON org.id = st.organization_id
         WHERE st.organization_id = ev.organization_id AND st.published = true AND org.email_verified_at IS NOT NULL
         LIMIT 1
      ) s
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

-- Página pública de un evento en UNA llamada (src/lib/eventPage.ts, loadEventPageRows). Las funciones de
-- Netlify corren en us-east-2 y Supabase en sa-east-1: cada consulta cuesta ~150–250 ms, y la página hacía
-- dos viajes (evento y luego, en paralelo, entradas, funciones, FAQs, etc.). Devuelve las mismas filas que
-- esas consultas de PostgREST (mismas columnas, filtros y orden), así el código de la página no cambia.
-- Si la función no existe (deploy preview sin migrar), el código usa las consultas por separado.
--
--   p_event_id  vista previa privada: por id, aunque NO esté publicado
--   p_slug      página pública: solo eventos publicados
-- NULL si no hay evento. NUNCA devuelve secret_location (C4): solo si existe (has_secret_location).
-- Solo service_role: con p_event_id lee borradores.

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
               ev.cover_settings, ev.fee_absorbed, ev.cover_meta, ev.page_settings
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

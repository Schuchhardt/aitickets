-- Video de portada de la galería del evento (arriba de las fotos, al final de la página pública). Idempotente.
--
-- 1) events.gallery_video (jsonb, NULL = sin video): { "url", "poster_url", "width", "height", "duration", "mime" }.
--    La escribe /api/events/gallery (acciones video_*) después de verificar que el archivo es un video del evento
--    y de la organización; la lee src/lib/eventPage.ts (normalizeGalleryVideo) y la muestra
--    src/components/event/GalleryVideo.vue (se reproduce solo y sin sonido en pantalla; botón para el sonido).
--
-- 2) Bucket público aitickets-event-videos (máx. 50 MB, solo mp4/webm/mov). Los videos no pasan por las funciones
--    de Netlify (cuerpo máx. ~6 MB): el navegador los sube directo con una URL firmada de un solo uso
--    (src/lib/videoStorage.ts). Si el bucket no se puede crear aquí (permisos, o la CI sin el esquema storage),
--    se avisa y el panel usa el bucket "Events".
--
-- 3) aitickets_public_event_page (202610160100) devuelve también events.gallery_video. Mismo cuerpo, una columna más.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS gallery_video jsonb;

COMMENT ON COLUMN public.events.gallery_video IS
  'Video de portada de la galería: {url, poster_url, width, height, duration, mime}. NULL = sin video.';

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) -- lint:allow bucket propio de AI Tickets (aitickets-*), solo si no existe
  VALUES ('aitickets-event-videos', 'aitickets-event-videos', true, 52428800, ARRAY['video/mp4', 'video/webm', 'video/quicktime'])
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_column OR insufficient_privilege THEN
    RAISE NOTICE 'No se pudo crear el bucket aitickets-event-videos (%): los videos usarán el bucket Events', SQLERRM;
END
$$;

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
               ev.cover_settings, ev.fee_absorbed, ev.cover_meta, ev.page_settings, ev.gallery_video
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

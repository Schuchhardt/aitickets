-- Cada evento demo con un fondo animado distinto (Iridescence, src/lib/eventPageSettings.ts) para mostrar los
-- presets. Solo cambia `background`: el resto de page_settings (diseño, organizador) se mantiene. Idempotente.

UPDATE public.events AS e
   SET page_settings = coalesce(e.page_settings, '{}'::jsonb) || jsonb_build_object('background', v.background)
  FROM (VALUES
         ('evento-demo-aitickets', 'lavender'),
         ('evento-demo-concierto', 'peach'),
         ('evento-demo-feria', 'lime'),
         ('evento-demo-gratis', 'mint'),
         ('evento-demo-gira', 'sky')
       ) AS v(slug, background)
 WHERE e.slug = v.slug
   AND coalesce(e.page_settings ->> 'background', '') <> v.background;

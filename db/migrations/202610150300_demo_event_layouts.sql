-- Cada evento demo con el diseño de página que mejor calza con su foto (src/lib/eventPageSettings.ts):
--   - Portada ancha: fotos horizontales panorámicas (concierto 3:2, feria 3:2).
--   - Póster: fotos verticales 4:5 (gratis, gira).
--   - Compacto: stand-up (3:2 con el micrófono al centro: se lee bien como miniatura cuadrada).
-- Solo cambia `layout`: el resto de page_settings (fondo, organizador) se mantiene. Idempotente.

UPDATE public.events AS e
   SET page_settings = coalesce(e.page_settings, '{}'::jsonb) || jsonb_build_object('layout', v.layout)
  FROM (VALUES
         ('evento-demo-aitickets', 'compact'),
         ('evento-demo-concierto', 'banner'),
         ('evento-demo-feria', 'banner'),
         ('evento-demo-gratis', 'poster'),
         ('evento-demo-gira', 'poster')
       ) AS v(slug, layout)
 WHERE e.slug = v.slug
   AND coalesce(e.page_settings ->> 'layout', '') <> v.layout;

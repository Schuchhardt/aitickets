-- Configuración de la página pública del evento (src/lib/eventPageSettings.ts) y nombres de los eventos demo
-- sin el sufijo "(evento de demostración)": la página ya muestra un banner que lo dice. Idempotente.
--   page_settings = { "layout": "poster" | "banner" | "compact", "show_organizer": boolean }
--   NULL = valores por defecto (póster, organizador visible).

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS page_settings jsonb;

UPDATE public.events
   SET name = regexp_replace(name, '\s*\(evento de demostración\)\s*$', ''),
       title = regexp_replace(coalesce(title, name), '\s*\(evento de demostración\)\s*$', '')
 WHERE slug IN ('evento-demo-aitickets', 'evento-demo-concierto', 'evento-demo-feria', 'evento-demo-gratis', 'evento-demo-gira')
   AND (name ~ '\(evento de demostración\)\s*$' OR title ~ '\(evento de demostración\)\s*$');

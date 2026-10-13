-- Rediseño de la página del evento y del checkout. Idempotente.
--
-- 1) events.cover_meta: metadatos de la imagen del evento, calculados en el servidor la primera vez que se
--    muestra la página con esa imagen (src/lib/eventCoverMeta.ts) y reutilizados mientras image_url no cambie.
--    { "src": "<image_url de la que salió>", "width": 1080, "height": 1350,
--      "color": "#c0563a" | null, "luminance": 0.42 }
--    color = color dominante (saturación > 0.15, luminancia 0.15–0.85) para teñir el fondo de la página;
--    width/height = proporción real del póster (nunca se recorta). NULL = aún no calculado.
--
-- 2) aitickets_event_waitlist: lista de espera / avisos de un evento (solo el registro; las notificaciones
--    automáticas quedan fuera de alcance). kind:
--      'full'       -> evento gratis con cupos llenos ("Avisarme si se libera un cupo")
--      'sold_out'   -> evento pagado agotado ("Avisarme si se liberan")
--      'sale_opens' -> la venta aún no abre ("Avisarme cuando abra")
--    Un email por evento + kind (re-inscribirse no duplica). La escribe POST /api/events/waitlist.
--    RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cover_meta jsonb;

COMMENT ON COLUMN public.events.cover_meta IS
  'Metadatos de la imagen del evento: {src, width, height, color, luminance}. Se recalcula si cambia image_url.';

CREATE TABLE IF NOT EXISTS public.aitickets_event_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id bigint REFERENCES public.event_dates(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  kind text NOT NULL DEFAULT 'full' CHECK (kind IN ('full', 'sold_out', 'sale_opens')),
  utm_source text CHECK (utm_source IS NULL OR char_length(utm_source) <= 128),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 128),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS aitickets_event_waitlist_event_email_kind_idx
  ON public.aitickets_event_waitlist (event_id, lower(email), kind);

ALTER TABLE public.aitickets_event_waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_waitlist FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_waitlist TO service_role;

COMMENT ON TABLE public.aitickets_event_waitlist IS
  'Lista de espera / avisos de un evento (cupos llenos, agotado, venta por abrir). Solo service role.';

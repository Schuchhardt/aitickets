-- Videos de los asistentes en la galería del evento terminado (src/pages/api/reviews/videos.ts). Idempotente.
--
-- Comparten tabla, estados (visible / pending / hidden) y moderación con las fotos:
-- aitickets_event_review_photos.media_type 'photo' (las de siempre) | 'video'. En un video, url es el archivo
-- (bucket aitickets-event-videos, carpeta event-attendee-videos/<evento>/, subido directo a Storage con URL firmada),
-- thumb_url su póster (un cuadro del video, bucket Events) y duration los segundos que dice el navegador.

ALTER TABLE public.aitickets_event_review_photos
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video'));
ALTER TABLE public.aitickets_event_review_photos
  ADD COLUMN IF NOT EXISTS duration integer CHECK (duration IS NULL OR (duration > 0 AND duration <= 3600));

COMMENT ON COLUMN public.aitickets_event_review_photos.media_type IS
  'photo | video. En un video, url es el archivo y thumb_url su póster.';
COMMENT ON COLUMN public.aitickets_event_review_photos.duration IS 'Duración del video en segundos (la informa el navegador). NULL en fotos.';

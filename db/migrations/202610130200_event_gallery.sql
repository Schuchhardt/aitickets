-- Galería de fotos de cada evento (se muestra al final de la página pública). Idempotente.
--
-- Una fila por imagen, ordenadas por position (y created_at como desempate). url y thumb_url son del
-- bucket público "Events" (carpeta event-gallery/), ya optimizadas por /api/events/upload-image
-- (thumb_url: miniatura WebP para la grilla). La gestionan el panel (/api/events/gallery) y la lee
-- src/lib/eventPage.ts. Máximo de imágenes por evento: lo valida la API (GALLERY_MAX_IMAGES).
-- RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_event_gallery_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 1000),
  thumb_url text CHECK (thumb_url IS NULL OR (thumb_url ~ '^https://' AND char_length(thumb_url) <= 1000)),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  caption text CHECK (caption IS NULL OR char_length(caption) <= 200),
  position integer NOT NULL DEFAULT 0,
  created_by_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aitickets_event_gallery_images_event_idx
  ON public.aitickets_event_gallery_images (event_id, position, created_at);

ALTER TABLE public.aitickets_event_gallery_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_gallery_images FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_gallery_images TO service_role;

COMMENT ON TABLE public.aitickets_event_gallery_images IS
  'Galería de fotos de un evento (página pública, al final del detalle). Solo service role.';

-- Difusión automática también en Facebook y TikTok, y reel con el video del evento. Idempotente.
--
-- La serie sigue siendo una por evento y con la cadencia de Instagram (src/lib/socialSeriesCadence.ts). Cada red
-- extra publica sus propias piezas (una fila por red en los slots), así que si una falla o se desconecta las demás
-- siguen. Código: src/lib/socialSeries.ts (expandNetworkSlots, networkState).
--
-- 1) aitickets_social_series.networks: estado por red extra, { facebook: {...}, tiktok: {...} } con
--      enabled      el productor la activó para este evento
--      account_id   cuenta de Zernio con la que se aprobó (o reanudó)
--      status       active | disconnected (la cuenta se desconectó: sus piezas pendientes se omiten y se retoma sola
--                   desde hoy al reconectarla)
--    reel_enabled: si el evento tiene un video vertical corto (portada o galería, 3 a 60 s), se publica como reel
--    unos días antes de la función en cada red activa.
-- 2) aitickets_social_series_slots.platform (instagram | facebook | tiktok), kind 'reel' y video_url. El índice único
--    pasa a incluir la red (la misma hora puede tener una pieza por red).

ALTER TABLE public.aitickets_social_series
  ADD COLUMN IF NOT EXISTS networks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reel_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.aitickets_social_series_slots
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'instagram',
  ADD COLUMN IF NOT EXISTS video_url text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aitickets_social_series_slots_platform_check') THEN
    ALTER TABLE public.aitickets_social_series_slots
      ADD CONSTRAINT aitickets_social_series_slots_platform_check CHECK (platform IN ('instagram', 'facebook', 'tiktok'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aitickets_social_series_slots_video_url_check') THEN
    ALTER TABLE public.aitickets_social_series_slots
      ADD CONSTRAINT aitickets_social_series_slots_video_url_check CHECK (video_url IS NULL OR char_length(video_url) <= 2000);
  END IF;
END $$;

-- kind: suma 'reel' (la restricción original no tenía nombre propio: se reemplaza por una con nombre)
ALTER TABLE public.aitickets_social_series_slots DROP CONSTRAINT IF EXISTS aitickets_social_series_slots_kind_check;
ALTER TABLE public.aitickets_social_series_slots
  ADD CONSTRAINT aitickets_social_series_slots_kind_check CHECK (kind IN ('story', 'feed_post', 'reel'));

DROP INDEX IF EXISTS public.aitickets_social_series_slots_unique_key;
CREATE UNIQUE INDEX IF NOT EXISTS aitickets_social_series_slots_unique_key
  ON public.aitickets_social_series_slots (series_id, platform, kind, variant, publish_at) WHERE status <> 'skipped';

COMMENT ON COLUMN public.aitickets_social_series.networks IS
  'Redes extra de la difusión automática: { facebook|tiktok: { enabled, account_id, status, error } }.';
COMMENT ON COLUMN public.aitickets_social_series_slots.platform IS 'Red de la pieza: instagram, facebook o tiktok.';

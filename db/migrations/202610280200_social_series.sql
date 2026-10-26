-- Historias y posts automáticos en Instagram (docs/specs/historias-automaticas.md). Idempotente.
--
-- El productor aprueba una serie una sola vez y AI Tickets publica historias (y posts de feed la última semana) en su
-- Instagram hasta el día del evento, con el link por DM automático (comment-automations de Zernio). Código:
-- src/lib/socialSeries*.ts, herramientas *_social_series de la API de productores y la función programada
-- social-series-dispatch (cada 15 min).
--
-- 1) aitickets_social_series: la unidad que el productor aprueba. Una sola serie viva (draft/active/paused) por evento.
--      cadence_config     copia de la configuración global usada al planificar (bandas, horas, publish_time elegido)
--      anchor_starts_at   inicio de la función hacia la que cuenta la serie: si cambia (fecha movida o pasó a la
--                         siguiente función) se replanifican los slots futuros
--      zernio_story_automation_id  automatización story_reply de la cuenta (compartida por las series vivas de esa
--                         cuenta: un solo DM por cuenta, con el evento más próximo)
--      pause_reason       producer | instagram_disconnected | ...; notice: aviso para la tarjeta del panel
-- 2) aitickets_social_series_slots: cada publicación. publish_at = hora del slot; image_url/caption se llenan al
--    renderizar (unas 2 h antes, con datos vigentes). zernio_automation_id: automatización de comentarios del post de
--    feed (keyword → DM), creada al despacharlo.
-- 3) aitickets_zernio_webhook_events: deduplicación de los webhooks de Zernio (X-Zernio-Event-Id).
-- 4) aitickets_platform_settings 'social_series_cadence': bandas y horas por defecto (ajustables sin deploy).
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_social_series (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  cadence_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  feed_posts_enabled boolean NOT NULL DEFAULT true,
  sold_out_story_enabled boolean NOT NULL DEFAULT false,
  keyword text NOT NULL DEFAULT 'ENTRADAS' CHECK (char_length(keyword) BETWEEN 2 AND 30),
  extra_keywords text[] NOT NULL DEFAULT ARRAY['entrada', 'link']::text[],
  dm_message text CHECK (dm_message IS NULL OR char_length(dm_message) <= 600),
  base_image_url text CHECK (base_image_url IS NULL OR char_length(base_image_url) <= 2000),
  zernio_profile_id text,
  zernio_account_id text,
  zernio_story_automation_id text,
  anchor_starts_at timestamptz,
  sold_out_at timestamptz,
  pause_reason text CHECK (pause_reason IS NULL OR char_length(pause_reason) <= 60),
  notice text CHECK (notice IS NULL OR char_length(notice) <= 500),
  dm_stats jsonb,
  dm_stats_at timestamptz,
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_via text CHECK (created_via IS NULL OR created_via IN ('mcp', 'rest', 'dashboard', 'admin')),
  approved_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  paused_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 200),
  completed_at timestamptz
);

-- Una sola serie viva por evento
CREATE UNIQUE INDEX IF NOT EXISTS aitickets_social_series_live_event_key
  ON public.aitickets_social_series (event_id) WHERE status IN ('draft', 'active', 'paused');
CREATE INDEX IF NOT EXISTS aitickets_social_series_org_idx ON public.aitickets_social_series (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_social_series_status_idx ON public.aitickets_social_series (status) WHERE status IN ('active', 'paused');
CREATE INDEX IF NOT EXISTS aitickets_social_series_account_idx ON public.aitickets_social_series (zernio_account_id) WHERE status IN ('active', 'paused');

COMMENT ON TABLE public.aitickets_social_series IS
  'Historias y posts automáticos en Instagram: serie aprobada una vez por el productor (docs/specs/historias-automaticas.md).';

CREATE TABLE IF NOT EXISTS public.aitickets_social_series_slots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  series_id bigint NOT NULL REFERENCES public.aitickets_social_series(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('story', 'feed_post')),
  variant text NOT NULL DEFAULT 'countdown' CHECK (variant IN ('countdown', 'sold_out')),
  publish_at timestamptz NOT NULL,
  days_to_event integer NOT NULL CHECK (days_to_event BETWEEN 0 AND 400),
  anchor_starts_at timestamptz,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'rendering', 'queued', 'published', 'failed', 'skipped')),
  image_url text,
  caption text CHECK (caption IS NULL OR char_length(caption) <= 2200),
  zernio_post_id text,
  zernio_automation_id text,
  platform_post_url text,
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  skip_reason text CHECK (skip_reason IS NULL OR char_length(skip_reason) <= 120),
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  rendered_at timestamptz,
  queued_at timestamptz,
  published_at timestamptz
);

-- Un mismo slot no se planifica dos veces (los omitidos no cuentan: se pueden volver a planificar a la misma hora)
CREATE UNIQUE INDEX IF NOT EXISTS aitickets_social_series_slots_unique_key
  ON public.aitickets_social_series_slots (series_id, kind, variant, publish_at) WHERE status <> 'skipped';
CREATE INDEX IF NOT EXISTS aitickets_social_series_slots_due_idx ON public.aitickets_social_series_slots (status, publish_at);
CREATE INDEX IF NOT EXISTS aitickets_social_series_slots_series_idx ON public.aitickets_social_series_slots (series_id, publish_at);
CREATE INDEX IF NOT EXISTS aitickets_social_series_slots_zernio_idx ON public.aitickets_social_series_slots (zernio_post_id) WHERE zernio_post_id IS NOT NULL;

COMMENT ON TABLE public.aitickets_social_series_slots IS
  'Cada historia o post de una serie: planned → rendering → queued (en Zernio) → published | failed | skipped.';

CREATE TABLE IF NOT EXISTS public.aitickets_zernio_webhook_events (
  event_id text PRIMARY KEY CHECK (char_length(event_id) BETWEEN 1 AND 120),
  event text NOT NULL CHECK (char_length(event) BETWEEN 1 AND 80),
  received_at timestamptz NOT NULL DEFAULT now(),
  result text CHECK (result IS NULL OR char_length(result) <= 200)
);
CREATE INDEX IF NOT EXISTS aitickets_zernio_webhook_events_received_idx ON public.aitickets_zernio_webhook_events (received_at);

ALTER TABLE public.aitickets_social_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aitickets_social_series_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aitickets_zernio_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_social_series FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.aitickets_social_series_slots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.aitickets_zernio_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_social_series TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_social_series_slots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_zernio_webhook_events TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_social_series_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.aitickets_social_series_slots_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_social_series_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_social_series_slots_id_seq TO service_role;

-- Bandas y horas por defecto (src/lib/socialSeriesCadence.ts DEFAULT_CADENCE). Se ajustan editando este valor
-- (o con update_social_series_config del MCP de admin); cada serie guarda la copia con la que se planificó.
INSERT INTO public.aitickets_platform_settings (key, value)
VALUES (
  'social_series_cadence',
  '{"daily_from_days": 7, "sparse_every_days": 3, "sparse_start_days": 10, "feed_posts_from_days": 7, "feed_posts_to_days": 1,
    "default_time": "19:30", "event_day_time": "09:00", "min_hours_before_start": 3, "peak_min_visits": 50,
    "lead_minutes": 120, "scarcity_threshold_pct": 30}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

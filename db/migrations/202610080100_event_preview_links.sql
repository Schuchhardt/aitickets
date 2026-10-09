-- Links privados de vista previa de eventos (borradores incluidos). Idempotente.
--
-- Un link es /eventos/vista-previa/<token>; aquí solo se guarda el sha256 del token (nunca el token).
--   single_use   el primer navegador que lo abre lo "consume": queda atado a ese navegador (cookie con un
--                nonce cuyo sha256 se guarda en consumed_nonce_hash) y nadie más puede abrirlo.
--   expires_at   NULL = sin vencimiento (hasta revocarlo).
--   revoked_at   revocado desde el panel o la API de productores.
-- Lo crean el panel (/api/events/preview-links) y la API de productores (create_event, create_preview_link).
-- RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_event_preview_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  single_use boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  consumed_at timestamptz,
  consumed_nonce_hash text CHECK (consumed_nonce_hash IS NULL OR consumed_nonce_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  label text CHECK (label IS NULL OR char_length(label) <= 80),
  created_by_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_via text NOT NULL DEFAULT 'dashboard' CHECK (created_via IN ('dashboard', 'mcp', 'rest')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_event_preview_links_token_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS aitickets_event_preview_links_event_idx
  ON public.aitickets_event_preview_links (event_id, created_at DESC);

ALTER TABLE public.aitickets_event_preview_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_preview_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_preview_links TO service_role;

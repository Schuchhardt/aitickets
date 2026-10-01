-- OAuth 2.1 para la API de productores (conectar claude.ai, ChatGPT y otros clientes MCP sin copiar llaves).
-- Idempotente. Flujo: authorization code + PKCE (S256), registro dinámico de clientes (RFC 7591) o
-- Client ID Metadata Documents (client_id = URL https), refresh tokens rotativos.
--
-- aitickets_oauth_clients  clientes registrados dinámicamente (secreto opcional, solo su sha256).
-- aitickets_oauth_codes    códigos de autorización (sha256), de un solo uso y 10 minutos.
-- aitickets_oauth_grants   una "app conectada" por autorización: usuario, organización, scopes y el
--                          sha256 del refresh token vigente (se rota en cada uso). Revocar = revoked_at.
-- aitickets_api_keys.oauth_grant_id: los access tokens (1 hora) son filas de aitickets_api_keys ligadas a
-- su grant, así la API los autentica igual que una llave personal. Borrar el grant borra sus tokens.
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_oauth_clients (
  client_id text PRIMARY KEY,
  client_secret_hash text CHECK (client_secret_hash IS NULL OR client_secret_hash ~ '^[0-9a-f]{64}$'),
  client_name text NOT NULL,
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  token_endpoint_auth_method text NOT NULL DEFAULT 'none'
    CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
  client_uri text,
  logo_uri text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aitickets_oauth_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_oauth_clients FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_oauth_clients TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_oauth_codes (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id text NOT NULL,
  client_name text NOT NULL,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read', 'write', 'publish', 'attendees']::text[]),
  resource text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aitickets_oauth_codes_expires_idx ON public.aitickets_oauth_codes (expires_at);

ALTER TABLE public.aitickets_oauth_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_oauth_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_oauth_codes TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_oauth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL,
  client_name text NOT NULL,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read', 'write', 'publish', 'attendees']::text[]),
  refresh_hash text NOT NULL CHECK (refresh_hash ~ '^[0-9a-f]{64}$'),
  refresh_expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_oauth_grants_refresh_key UNIQUE (refresh_hash)
);

CREATE INDEX IF NOT EXISTS aitickets_oauth_grants_org_idx ON public.aitickets_oauth_grants (organization_id);

ALTER TABLE public.aitickets_oauth_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_oauth_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_oauth_grants TO service_role;

ALTER TABLE public.aitickets_api_keys ADD COLUMN IF NOT EXISTS oauth_grant_id uuid
  REFERENCES public.aitickets_oauth_grants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS aitickets_api_keys_grant_idx
  ON public.aitickets_api_keys (oauth_grant_id) WHERE oauth_grant_id IS NOT NULL;

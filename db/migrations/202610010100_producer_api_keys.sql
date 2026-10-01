-- API pública para productores (REST /api/v1 + servidor MCP /api/mcp). Idempotente.
--
-- public.aitickets_api_keys: llaves personales. Cada llave actúa como el usuario que la creó, dentro de su
-- organización, y solo con los scopes elegidos ('read', 'write', 'publish', 'attendees'). La llave en claro
-- se muestra una sola vez: aquí solo se guarda su sha256 (hex) y un prefijo para reconocerla en el panel.
-- Una llave deja de funcionar si se revoca (revoked_at), si vence (expires_at), si el usuario se desactiva,
-- cambia de organización o pierde un rol de gestión de eventos (se revisa en cada petición).
--
-- public.aitickets_api_audit: bitácora de las acciones de ESCRITURA hechas vía API/MCP (herramienta,
-- resultado y evento afectado). Nunca guarda los argumentos (pueden traer datos personales).
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  key_prefix text NOT NULL,
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL DEFAULT ARRAY['read']::text[]
    CHECK (scopes <@ ARRAY['read', 'write', 'publish', 'attendees']::text[]),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_api_keys_hash_key UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS aitickets_api_keys_org_idx ON public.aitickets_api_keys (organization_id);

ALTER TABLE public.aitickets_api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_api_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_api_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_api_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.aitickets_api_keys(id) ON DELETE SET NULL,
  user_id bigint,
  tool text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('mcp', 'rest')),
  ok boolean NOT NULL,
  error_code text,
  event_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aitickets_api_audit_org_idx ON public.aitickets_api_audit (organization_id, created_at DESC);

ALTER TABLE public.aitickets_api_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_api_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_api_audit TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_api_audit_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_api_audit_id_seq TO service_role;

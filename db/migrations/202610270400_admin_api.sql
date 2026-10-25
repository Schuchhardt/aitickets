-- MCP de administración de AI Tickets (/api/admin/mcp, src/lib/admin-api/). Idempotente. Ver docs/specs/mcp-admin.md.
--
-- public.aitickets_admin_audit: TODA llamada al MCP de admin (también las lecturas: el admin ve datos personales
--   de todas las organizaciones). Nunca guarda los argumentos: solo su hash, el resumen, el motivo y el objetivo.
-- public.aitickets_admin_notes: notas internas de soporte por organización.
-- public.aitickets_platform_settings: configuración de la plataforma (clave → jsonb). Aquí: support_user_id.
-- public.aitickets_admin_confirmations / aitickets_admin_idempotency: confirmación en dos pasos e idempotencia
--   de las herramientas propias del admin (las de productor que el admin usa con org_* siguen usando
--   aitickets_api_confirmations / aitickets_api_idempotency de su organización).
-- Usuario de servicio "Soporte AI Tickets": el actor de org_* (las FK created_by/requested_by… necesitan un
--   users.id). SIN correo y SIN usuario de Auth a propósito: "Continuar con Google" y aceptar una invitación
--   ligan cuentas por correo, así que ningún flujo de login puede encontrarlo. Inactivo y sin organización:
--   authenticateApiKey lo rechaza.
-- aitickets_api_audit.channel y las columnas *_via aceptan 'admin' (org_* escribe en las mismas tablas que el MCP).
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  tool text NOT NULL CHECK (char_length(tool) BETWEEN 1 AND 80),
  key_kind text NOT NULL CHECK (key_kind IN ('full', 'readonly')),
  key_fingerprint text NOT NULL CHECK (char_length(key_fingerprint) <= 16),
  read_only boolean NOT NULL,
  ok boolean NOT NULL,
  error_code text CHECK (error_code IS NULL OR char_length(error_code) <= 40),
  organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_id bigint,
  target text CHECK (target IS NULL OR char_length(target) <= 120),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 300),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 300),
  args_hash text CHECK (args_hash IS NULL OR args_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  duration_ms integer
);
CREATE INDEX IF NOT EXISTS aitickets_admin_audit_created_idx ON public.aitickets_admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_admin_audit_org_idx ON public.aitickets_admin_audit (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_admin_audit_tool_idx ON public.aitickets_admin_audit (tool, created_at DESC);
ALTER TABLE public.aitickets_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_admin_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_admin_audit TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_admin_audit_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_admin_audit_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_admin_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aitickets_admin_notes_org_idx ON public.aitickets_admin_notes (organization_id, created_at DESC);
ALTER TABLE public.aitickets_admin_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_admin_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_admin_notes TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_admin_notes_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_admin_notes_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_platform_settings (
  key text PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 80),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitickets_platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_platform_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_platform_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_admin_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  tool text NOT NULL,
  args_hash text NOT NULL CHECK (args_hash ~ '^[0-9a-f]{64}$'),
  key_fingerprint text NOT NULL,
  summary jsonb,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_admin_confirmations_token_key UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS aitickets_admin_confirmations_exp_idx ON public.aitickets_admin_confirmations (expires_at);
ALTER TABLE public.aitickets_admin_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_admin_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_admin_confirmations TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_admin_idempotency (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tool text NOT NULL,
  idem_key text NOT NULL CHECK (char_length(idem_key) BETWEEN 1 AND 200),
  args_hash text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'done')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_admin_idempotency_key UNIQUE (tool, idem_key)
);
ALTER TABLE public.aitickets_admin_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_admin_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_admin_idempotency TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_admin_idempotency_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_admin_idempotency_id_seq TO service_role;

-- Usuario de servicio (ver arriba). Solo se crea una vez: su id queda en aitickets_platform_settings.
DO $$
DECLARE uid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.aitickets_platform_settings WHERE key = 'support_user_id') THEN
    INSERT INTO public.users (name, email, role, active, organization_id, auth_user_id)
    VALUES ('Soporte AI Tickets', NULL, 'viewer', false, NULL, NULL)
    RETURNING id INTO uid;
    INSERT INTO public.aitickets_platform_settings (key, value) VALUES ('support_user_id', to_jsonb(uid));
  END IF;
END $$;

-- org_* (canal 'admin') escribe en las mismas tablas que el MCP y el panel: la bitácora del productor y las columnas
-- que guardan por dónde se hizo algo (link de vista previa, reembolso, invitación al equipo, mensaje programado,
-- retiro). Sin 'admin' en sus CHECK, un reembolso o un mensaje hecho por soporte fallaría al insertar.
-- Solo se amplían: el código anterior nunca escribe 'admin' (expand/contract).
ALTER TABLE public.aitickets_api_audit DROP CONSTRAINT IF EXISTS aitickets_api_audit_channel_check;
ALTER TABLE public.aitickets_api_audit
  ADD CONSTRAINT aitickets_api_audit_channel_check CHECK (channel IN ('mcp', 'rest', 'dashboard', 'admin'));

ALTER TABLE public.aitickets_event_preview_links DROP CONSTRAINT IF EXISTS aitickets_event_preview_links_created_via_check;
ALTER TABLE public.aitickets_event_preview_links
  ADD CONSTRAINT aitickets_event_preview_links_created_via_check CHECK (created_via IN ('dashboard', 'mcp', 'rest', 'admin'));

ALTER TABLE public.aitickets_payouts DROP CONSTRAINT IF EXISTS aitickets_payouts_requested_via_check;
ALTER TABLE public.aitickets_payouts
  ADD CONSTRAINT aitickets_payouts_requested_via_check CHECK (requested_via IN ('dashboard', 'mcp', 'rest', 'admin'));

ALTER TABLE public.aitickets_refunds DROP CONSTRAINT IF EXISTS aitickets_refunds_requested_via_check;
ALTER TABLE public.aitickets_refunds
  ADD CONSTRAINT aitickets_refunds_requested_via_check CHECK (requested_via IN ('dashboard', 'mcp', 'rest', 'admin'));

ALTER TABLE public.aitickets_team_invitations DROP CONSTRAINT IF EXISTS aitickets_team_invitations_invited_via_check;
ALTER TABLE public.aitickets_team_invitations
  ADD CONSTRAINT aitickets_team_invitations_invited_via_check CHECK (invited_via IN ('dashboard', 'mcp', 'rest', 'admin'));

ALTER TABLE public.aitickets_scheduled_messages DROP CONSTRAINT IF EXISTS aitickets_scheduled_messages_created_via_check;
ALTER TABLE public.aitickets_scheduled_messages
  ADD CONSTRAINT aitickets_scheduled_messages_created_via_check CHECK (created_via IN ('dashboard', 'mcp', 'rest', 'admin'));

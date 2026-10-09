-- API de productores v2 (MCP /api/mcp + REST /api/v1): plata, equipo, postventa, invitados, acceso,
-- comunicación y auditoría. Idempotente y expand-only (el código desplegado sigue funcionando).
--
-- Reglas transversales que soporta este esquema:
--   * Confirmación en el servidor: lo que mueve plata o es público se ejecuta en DOS llamadas. La primera
--     guarda un token de un solo uso (aitickets_api_confirmations, solo el sha256) atado a la llave, la
--     herramienta y el hash de los argumentos; la segunda lo consume.
--   * Idempotencia: aitickets_api_idempotency guarda la respuesta por (organización, herramienta, clave).
--   * Retiros solo a cuenta verificada y con espera tras cambiar los datos bancarios: el trigger de
--     organization_payout_accounts anula la verificación y marca bank_changed_at en CUALQUIER cambio de
--     datos bancarios, venga del panel o de donde sea.
-- Todo lo nuevo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

-- ---------------------------------------------------------------------------
-- Scopes nuevos de las llaves: 'finance' (saldo, retiros, reembolsos) y 'team' (equipo)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  c record;
BEGIN
  FOREACH t IN ARRAY ARRAY['aitickets_api_keys', 'aitickets_oauth_codes', 'aitickets_oauth_grants'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR c IN
      SELECT conname FROM pg_constraint
       WHERE conrelid = ('public.' || t)::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%scopes%' AND pg_get_constraintdef(oid) LIKE '%attendees%'
         AND pg_get_constraintdef(oid) NOT LIKE '%finance%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, c.conname); -- lint:allow tablas aitickets_* de la lista fija
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_scopes_v2_check'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (scopes <@ ARRAY[''read'', ''write'', ''publish'', ''attendees'', ''finance'', ''team'']::text[])', t, t || '_scopes_v2_check'); -- lint:allow tablas aitickets_* de la lista fija
    END IF;
  END LOOP;
END $$;

-- Roles nuevos de users ('finance', 'viewer'): users.role es text sin CHECK en el esquema conocido; si en esta
-- base existe una restricción sobre role con la lista antigua, se reemplaza por una que incluye los nuevos.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%role%' AND pg_get_constraintdef(oid) LIKE '%validator%'
       AND pg_get_constraintdef(oid) NOT LIKE '%finance%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', c.conname); -- lint:allow restricción de roles de users (tabla de AI Tickets)
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.users'::regclass AND conname = 'users_role_v2_check') THEN
      ALTER TABLE public.users ADD CONSTRAINT users_role_v2_check
        CHECK (role IS NULL OR role IN ('producer', 'admin', 'finance', 'editor', 'validator', 'viewer')) NOT VALID;
    END IF;
  END LOOP;
END $$;

-- Bitácora: resumen legible (sin datos personales) de cada acción
ALTER TABLE public.aitickets_api_audit ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.aitickets_api_audit ADD COLUMN IF NOT EXISTS target text;
CREATE INDEX IF NOT EXISTS aitickets_api_audit_org_tool_idx ON public.aitickets_api_audit (organization_id, tool, created_at DESC);

-- ---------------------------------------------------------------------------
-- Confirmación en dos pasos e idempotencia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_api_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id bigint NOT NULL,
  api_key_id uuid,
  tool text NOT NULL,
  args_hash text NOT NULL,
  summary jsonb,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_api_confirmations_token_key UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS aitickets_api_confirmations_exp_idx ON public.aitickets_api_confirmations (expires_at);
ALTER TABLE public.aitickets_api_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_api_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_api_confirmations TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_api_idempotency (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tool text NOT NULL,
  idem_key text NOT NULL CHECK (char_length(idem_key) BETWEEN 1 AND 200),
  args_hash text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'done')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_api_idempotency_key UNIQUE (organization_id, tool, idem_key)
);
ALTER TABLE public.aitickets_api_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_api_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_api_idempotency TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_api_idempotency_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_api_idempotency_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- Cuenta de pago: verificación y espera tras cambios
-- ---------------------------------------------------------------------------
ALTER TABLE public.organization_payout_accounts ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.organization_payout_accounts ADD COLUMN IF NOT EXISTS verified_by text;
ALTER TABLE public.organization_payout_accounts ADD COLUMN IF NOT EXISTS verification_notes text;
ALTER TABLE public.organization_payout_accounts ADD COLUMN IF NOT EXISTS bank_changed_at timestamptz;
ALTER TABLE public.organization_payout_accounts ADD COLUMN IF NOT EXISTS removed_at timestamptz;

-- Cuentas completas ya existentes: AI Tickets ya les transfería manualmente => verificadas ('legacy').
UPDATE public.organization_payout_accounts
   SET verified_at = COALESCE(updated_at, now()), verified_by = 'legacy', bank_changed_at = COALESCE(bank_changed_at, updated_at)
 WHERE verified_at IS NULL AND verified_by IS NULL
   AND bank_name IS NOT NULL AND bank_account_number IS NOT NULL AND bank_account_holder IS NOT NULL AND bank_account_rut IS NOT NULL;

CREATE OR REPLACE FUNCTION public.aitickets_payout_account_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
     OR NEW.bank_account_type IS DISTINCT FROM OLD.bank_account_type
     OR NEW.bank_account_number IS DISTINCT FROM OLD.bank_account_number
     OR NEW.bank_account_holder IS DISTINCT FROM OLD.bank_account_holder
     OR NEW.bank_account_rut IS DISTINCT FROM OLD.bank_account_rut THEN
    NEW.bank_changed_at := now();
    -- Solo AI Tickets (verified_by distinto de NULL en el mismo UPDATE que no toca datos) verifica
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    IF NEW.bank_account_number IS NOT NULL THEN NEW.removed_at := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_payout_account_changed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_payout_account_changed() TO service_role;

DROP TRIGGER IF EXISTS aitickets_payout_account_changed ON public.organization_payout_accounts;
CREATE TRIGGER aitickets_payout_account_changed
  BEFORE INSERT OR UPDATE ON public.organization_payout_accounts
  FOR EACH ROW EXECUTE FUNCTION public.aitickets_payout_account_changed();

-- ---------------------------------------------------------------------------
-- Retiros (payouts). Cada retiro reparte su monto por evento en event_withdrawals (payout_id), que es lo
-- que ya usa el panel de finanzas.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'paid', 'cancelled', 'failed')),
  bank_name text,
  bank_account_type text,
  bank_account_last4 text,
  requested_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  requested_via text NOT NULL DEFAULT 'mcp' CHECK (requested_via IN ('dashboard', 'mcp', 'rest')),
  estimated_payment_date date,
  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  failure_reason text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aitickets_payouts_org_idx ON public.aitickets_payouts (organization_id, created_at DESC);
ALTER TABLE public.aitickets_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_payouts TO service_role;

ALTER TABLE public.event_withdrawals ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES public.aitickets_payouts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS event_withdrawals_payout_idx ON public.event_withdrawals (payout_id);
CREATE INDEX IF NOT EXISTS event_withdrawals_event_status_idx ON public.event_withdrawals (event_id, status);

-- ---------------------------------------------------------------------------
-- Reembolsos (los procesa AI Tickets con el medio de pago; aquí queda la solicitud y su estado)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.event_orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('full', 'partial')),
  ticket_amount bigint NOT NULL DEFAULT 0 CHECK (ticket_amount >= 0),
  fee_amount bigint NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  total_amount bigint NOT NULL CHECK (total_amount >= 0),
  cancelled_ticket_ids uuid[] NOT NULL DEFAULT '{}',
  reason text,
  source text NOT NULL DEFAULT 'refund_order' CHECK (source IN ('refund_order', 'cancel_event', 'dashboard')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'failed', 'cancelled')),
  requested_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  requested_via text NOT NULL DEFAULT 'mcp' CHECK (requested_via IN ('dashboard', 'mcp', 'rest')),
  provider_reference text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aitickets_refunds_org_idx ON public.aitickets_refunds (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_refunds_order_idx ON public.aitickets_refunds (order_id);
CREATE INDEX IF NOT EXISTS aitickets_refunds_event_idx ON public.aitickets_refunds (event_id);
ALTER TABLE public.aitickets_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_refunds TO service_role;

-- ---------------------------------------------------------------------------
-- Eventos: quién paga el cargo por servicio, archivo y cancelación
-- ---------------------------------------------------------------------------
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS fee_absorbed boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cancellation_reason text;
-- Orden con cargo absorbido por el productor: el comprador pagó el precio de lista (total_payment) y
-- amount = precio - cargo neto - IVA del cargo (lo que recibe el productor, como siempre).
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS fee_absorbed boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Equipo: invitaciones y acceso por evento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 200),
  name text CHECK (name IS NULL OR char_length(name) <= 150),
  role text NOT NULL CHECK (role IN ('admin', 'finance', 'editor', 'validator', 'viewer')),
  event_ids bigint[] NOT NULL DEFAULT '{}',
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  invited_via text NOT NULL DEFAULT 'mcp' CHECK (invited_via IN ('dashboard', 'mcp', 'rest')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_team_invitations_token_key UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS aitickets_team_invitations_org_idx ON public.aitickets_team_invitations (organization_id, created_at DESC);
ALTER TABLE public.aitickets_team_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_team_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_team_invitations TO service_role;

-- Si un usuario tiene filas aquí, solo accede a esos eventos (p. ej. el equipo de puerta de un evento).
CREATE TABLE IF NOT EXISTS public.aitickets_event_staff (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_event_staff_key UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS aitickets_event_staff_user_idx ON public.aitickets_event_staff (user_id);
ALTER TABLE public.aitickets_event_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_staff FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_staff TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_event_staff_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_event_staff_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- Lista de invitados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 150),
  email text CHECK (email IS NULL OR char_length(email) <= 200),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 30),
  plus_ones integer NOT NULL DEFAULT 0 CHECK (plus_ones BETWEEN 0 AND 20),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 300),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'removed')),
  invited_at timestamptz,
  invite_channel text CHECK (invite_channel IS NULL OR invite_channel IN ('email', 'whatsapp')),
  invite_count integer NOT NULL DEFAULT 0,
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS aitickets_guests_event_idx ON public.aitickets_guests (event_id, created_at);
ALTER TABLE public.aitickets_guests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_guests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_guests TO service_role;

-- ---------------------------------------------------------------------------
-- Links de escáner para la puerta (sin cuenta; solo el sha256 del token)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_checkin_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label text CHECK (label IS NULL OR char_length(label) <= 80),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  scan_count integer NOT NULL DEFAULT 0,
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_checkin_links_token_key UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS aitickets_checkin_links_event_idx ON public.aitickets_checkin_links (event_id);
ALTER TABLE public.aitickets_checkin_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_checkin_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_checkin_links TO service_role;

-- ---------------------------------------------------------------------------
-- Mensajes a asistentes (inmediatos o programados) y recordatorios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('message', 'reminder')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 150),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'not_checked_in')),
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  recipients_count integer,
  failed_count integer,
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_via text NOT NULL DEFAULT 'mcp' CHECK (created_via IN ('dashboard', 'mcp', 'rest')),
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aitickets_scheduled_messages_due_idx ON public.aitickets_scheduled_messages (status, send_at);
CREATE INDEX IF NOT EXISTS aitickets_scheduled_messages_event_idx ON public.aitickets_scheduled_messages (event_id, created_at DESC);
ALTER TABLE public.aitickets_scheduled_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_scheduled_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_scheduled_messages TO service_role;

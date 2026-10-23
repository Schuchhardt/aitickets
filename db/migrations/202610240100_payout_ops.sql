-- Operación de retiros, reembolsos y verificación de cuentas bancarias (hasta ahora: SQL a mano + Slack). Idempotente.
--
-- 1. event_withdrawals queda SIEMPRE sincronizada con su retiro: un trigger sobre aitickets_payouts copia status y
--    paid_at a las filas del reparto por evento (payout_id). El saldo (src/lib/producer-api/ledger.ts) lee
--    event_withdrawals y list_payouts lee aitickets_payouts: un UPDATE manual de una sola de las dos tablas las
--    desfasaba (p. ej. un retiro 'failed' seguía restando del saldo).
-- 2. Funciones para el operador de AI Tickets (Supabase > SQL editor hoy; el MCP de administración después).
--    Validan las transiciones y nunca tocan lo que no deben:
--      select aitickets_verify_payout_account(<org_id>, 'approve', '<quién>', null, '<últimos 4>');
--      select aitickets_verify_payout_account(<org_id>, 'reject', '<quién>', '<qué debe corregir el productor>');
--      select aitickets_set_payout_status('<payout_id>', 'paid', '<n° de comprobante>', null, '<quién>');
--      select aitickets_set_payout_status('<payout_id>', 'failed', null, '<motivo>', '<quién>');
--      select aitickets_set_refund_status('<refund_id>', 'completed', '<id del reembolso en Flow>', null, '<quién>');
--      select aitickets_set_refund_status('<refund_id>', 'failed', null, '<motivo>', '<quién>');
-- 3. Datos bancarios en event_withdrawals: el código ya no copia el número de cuenta, el titular ni su RUT
--    completos (solo enmascarados). Para transferir se usa organization_payout_accounts (la cuenta verificada).
--    Las filas de retiros terminados se enmascaran al final de este archivo y el trigger enmascara las demás
--    cuando su retiro termina (paid/cancelled/failed).

-- ---------------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------------
-- Rechazo de la verificación: el productor ve verification_notes en el panel y en get_verification_status
ALTER TABLE public.organization_payout_accounts ADD COLUMN IF NOT EXISTS verification_rejected_at timestamptz;
-- Quién registró el pago/fallo (texto libre: nombre del operador o 'admin:<huella>')
ALTER TABLE public.aitickets_payouts ADD COLUMN IF NOT EXISTS processed_by text;
ALTER TABLE public.aitickets_refunds ADD COLUMN IF NOT EXISTS processed_by text;
-- reason es el motivo del reembolso que dio el productor; el motivo de un fallo va aparte
ALTER TABLE public.aitickets_refunds ADD COLUMN IF NOT EXISTS failure_reason text;

-- ---------------------------------------------------------------------------
-- Enmascarado (mismo formato que src/lib/producer-api/tools/finance.ts: maskAccountNumber, maskRut, maskName).
-- Idempotentes: enmascarar un valor ya enmascarado lo deja igual.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aitickets_mask_account_number(v text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(regexp_replace(v, '\D', '', 'g'), '') = '' THEN '••••'
    ELSE '•••• ' || right(regexp_replace(v, '\D', '', 'g'), 4)
  END
$$;

CREATE OR REPLACE FUNCTION public.aitickets_mask_rut(v text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text := regexp_replace(coalesce(v, ''), '[^0-9kK]', '', 'g');
BEGIN
  IF length(s) < 2 THEN
    RETURN '••••';
  END IF;
  -- '••••' + los 3 dígitos antes del verificador + '-' + verificador (12.345.678-9 → ••••678-9)
  RETURN '••••' || substr(s, greatest(length(s) - 3, 1), least(3, length(s) - 1)) || '-' || upper(right(s, 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.aitickets_mask_person_name(v text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- Inicial de cada palabra + asteriscos (Ana Pérez → A** P****)
  SELECT coalesce(string_agg(left(t.w, 1) || repeat('*', greatest(2, length(t.w) - 1)), ' ' ORDER BY t.ord), '••••')
    FROM regexp_split_to_table(btrim(coalesce(v, '')), '\s+') WITH ORDINALITY AS t(w, ord)
   WHERE t.w <> ''
$$;

REVOKE EXECUTE ON FUNCTION public.aitickets_mask_account_number(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aitickets_mask_rut(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aitickets_mask_person_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_mask_account_number(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aitickets_mask_rut(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.aitickets_mask_person_name(text) TO service_role;

-- ---------------------------------------------------------------------------
-- Cambio de datos bancarios: mismo comportamiento que 202610090200 (anula la verificación y marca
-- bank_changed_at) y además borra un rechazo previo y sus notas: los datos nuevos se revisan desde cero.
-- ---------------------------------------------------------------------------
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
    -- Solo AI Tickets verifica (aitickets_verify_payout_account: un UPDATE que no toca los datos bancarios)
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    NEW.verification_rejected_at := NULL;
    NEW.verification_notes := NULL;
    IF NEW.bank_account_number IS NOT NULL THEN NEW.removed_at := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_payout_account_changed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_payout_account_changed() TO service_role;

-- ---------------------------------------------------------------------------
-- Retiro ↔ reparto por evento
-- ---------------------------------------------------------------------------
-- BEFORE: un retiro que pasa a 'paid' sin paid_at lo recibe (también si se marca a mano), y updated_at se renueva.
CREATE OR REPLACE FUNCTION public.aitickets_payout_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_payout_touch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_payout_touch() TO service_role;

DROP TRIGGER IF EXISTS aitickets_payout_touch ON public.aitickets_payouts;
CREATE TRIGGER aitickets_payout_touch
  BEFORE UPDATE ON public.aitickets_payouts
  FOR EACH ROW EXECUTE FUNCTION public.aitickets_payout_touch();

-- AFTER: copia status/paid_at a event_withdrawals y, si el retiro terminó, enmascara los datos bancarios copiados.
CREATE OR REPLACE FUNCTION public.aitickets_payout_sync_withdrawals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  terminal boolean := NEW.status IN ('paid', 'cancelled', 'failed');
BEGIN
  UPDATE public.event_withdrawals w
     SET status = NEW.status,
         paid_at = NEW.paid_at,
         account_number = CASE WHEN terminal THEN public.aitickets_mask_account_number(w.account_number) ELSE w.account_number END,
         account_holder_name = CASE WHEN terminal THEN public.aitickets_mask_person_name(w.account_holder_name) ELSE w.account_holder_name END,
         account_holder_rut = CASE WHEN terminal THEN public.aitickets_mask_rut(w.account_holder_rut) ELSE w.account_holder_rut END
   WHERE w.payout_id = NEW.id;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_payout_sync_withdrawals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_payout_sync_withdrawals() TO service_role;

DROP TRIGGER IF EXISTS aitickets_payout_sync_withdrawals ON public.aitickets_payouts;
CREATE TRIGGER aitickets_payout_sync_withdrawals
  AFTER UPDATE OF status, paid_at ON public.aitickets_payouts
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.paid_at IS DISTINCT FROM NEW.paid_at)
  EXECUTE FUNCTION public.aitickets_payout_sync_withdrawals();

-- ---------------------------------------------------------------------------
-- Verificar o rechazar la cuenta bancaria de una organización
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aitickets_verify_payout_account(
  p_organization_id bigint,
  p_decision text,
  p_verified_by text,
  p_notes text DEFAULT NULL,
  p_expected_last4 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acc public.organization_payout_accounts%ROWTYPE;
  digits text;
  notes text := nullif(btrim(coalesce(p_notes, '')), '');
  ts timestamptz := now();
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'p_decision debe ser ''approve'' o ''reject'' (llegó %)', coalesce(p_decision, 'NULL');
  END IF;
  IF nullif(btrim(coalesce(p_verified_by, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_verified_by es obligatorio: quién revisó la cuenta';
  END IF;
  IF p_decision = 'reject' AND notes IS NULL THEN
    RAISE EXCEPTION 'Para rechazar escribe en p_notes qué debe corregir el productor (lo ve en el panel)';
  END IF;

  SELECT * INTO acc FROM public.organization_payout_accounts WHERE organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La organización % no tiene datos bancarios registrados', p_organization_id;
  END IF;
  IF acc.bank_name IS NULL OR acc.bank_account_number IS NULL OR acc.bank_account_holder IS NULL OR acc.bank_account_rut IS NULL THEN
    RAISE EXCEPTION 'Los datos bancarios de la organización % están incompletos o dados de baja: no hay nada que verificar', p_organization_id;
  END IF;
  digits := regexp_replace(acc.bank_account_number, '\D', '', 'g');
  IF p_expected_last4 IS NOT NULL AND right(digits, 4) IS DISTINCT FROM regexp_replace(p_expected_last4, '\D', '', 'g') THEN
    RAISE EXCEPTION 'La cuenta registrada termina en % y no en %: pudo haber cambiado. Revisa los datos antes de decidir.', right(digits, 4), p_expected_last4;
  END IF;

  -- Solo columnas de verificación: el trigger aitickets_payout_account_changed no se dispara.
  UPDATE public.organization_payout_accounts
     SET verified_at = CASE WHEN p_decision = 'approve' THEN ts END,
         verified_by = btrim(p_verified_by),
         verification_notes = notes,
         verification_rejected_at = CASE WHEN p_decision = 'reject' THEN ts END
   WHERE organization_id = p_organization_id;

  RETURN jsonb_build_object(
    'organization_id', p_organization_id,
    'decision', p_decision,
    'bank', acc.bank_name,
    'account_last4', right(digits, 4),
    'verified_at', CASE WHEN p_decision = 'approve' THEN ts END,
    'rejected_at', CASE WHEN p_decision = 'reject' THEN ts END,
    'notes', notes,
    -- Los retiros además esperan 72 h desde el último cambio de datos (BANK_CHANGE_HOLD_HOURS)
    'payouts_enabled_from', CASE WHEN p_decision = 'approve' THEN greatest(ts, coalesce(acc.bank_changed_at, ts) + interval '72 hours') END
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_verify_payout_account(bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_verify_payout_account(bigint, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Estado de un retiro: requested|processing → processing|paid|failed (el trigger sincroniza event_withdrawals)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aitickets_set_payout_status(
  p_payout_id uuid,
  p_status text,
  p_reference text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL,
  p_actor text DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.aitickets_payouts%ROWTYPE;
  acc record;
  digits text;
  synced integer;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_failure text := nullif(btrim(coalesce(p_failure_reason, '')), '');
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('processing', 'paid', 'failed') THEN
    RAISE EXCEPTION 'p_status debe ser processing, paid o failed (llegó %). Un retiro aún requested lo anula el productor con cancel_payout (MCP/API).', coalesce(p_status, 'NULL');
  END IF;

  SELECT * INTO p FROM public.aitickets_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el retiro %', p_payout_id;
  END IF;

  -- Repetir la misma transición no cambia nada (idempotente)
  IF p.status = p_status THEN
    RETURN jsonb_build_object('payout_id', p.id, 'organization_id', p.organization_id, 'amount', p.amount, 'status', p.status,
                              'paid_at', p.paid_at, 'reference', p.reference, 'failure_reason', p.failure_reason, 'changed', false);
  END IF;
  IF p.status NOT IN ('requested', 'processing') THEN
    RAISE EXCEPTION 'El retiro % está ''%'': solo uno requested o processing puede pasar a %', p.id, p.status, p_status;
  END IF;

  IF p_status = 'paid' THEN
    IF v_reference IS NULL THEN
      RAISE EXCEPTION 'Indica p_reference: el n° de comprobante de la transferencia (lo ve el productor)';
    END IF;
    IF NOT coalesce(p_force, false) THEN
      SELECT verified_at, bank_changed_at, bank_account_number INTO acc
        FROM public.organization_payout_accounts WHERE organization_id = p.organization_id;
      IF NOT FOUND OR acc.verified_at IS NULL THEN
        RAISE EXCEPTION 'La cuenta bancaria de la organización % no está verificada. Verifícala (aitickets_verify_payout_account) antes de transferir; si ya transferiste a la cuenta correcta usa p_force => true.', p.organization_id;
      END IF;
      IF acc.bank_changed_at IS NOT NULL AND acc.bank_changed_at > p.created_at THEN
        RAISE EXCEPTION 'La cuenta bancaria cambió (%) después de pedir el retiro (%): confirma con el productor a qué cuenta transferir. Si ya transferiste a la cuenta correcta usa p_force => true.', acc.bank_changed_at, p.created_at;
      END IF;
      digits := regexp_replace(coalesce(acc.bank_account_number, ''), '\D', '', 'g');
      IF p.bank_account_last4 IS NOT NULL AND right(digits, 4) IS DISTINCT FROM p.bank_account_last4 THEN
        RAISE EXCEPTION 'El retiro se pidió a la cuenta terminada en % y la cuenta registrada termina en %. Si ya transferiste a la cuenta correcta usa p_force => true.', p.bank_account_last4, right(digits, 4);
      END IF;
    END IF;
  END IF;
  IF p_status = 'failed' AND v_failure IS NULL THEN
    RAISE EXCEPTION 'Indica p_failure_reason (lo ve el productor en list_payouts); el monto vuelve a su saldo disponible';
  END IF;

  UPDATE public.aitickets_payouts
     SET status = p_status,
         paid_at = CASE WHEN p_status = 'paid' THEN now() ELSE paid_at END,
         reference = coalesce(v_reference, aitickets_payouts.reference),
         failure_reason = CASE WHEN p_status = 'failed' THEN v_failure ELSE aitickets_payouts.failure_reason END,
         processed_by = coalesce(nullif(btrim(coalesce(p_actor, '')), ''), aitickets_payouts.processed_by)
   WHERE id = p_payout_id
  RETURNING * INTO p;

  SELECT count(*) INTO synced FROM public.event_withdrawals WHERE payout_id = p_payout_id AND status = p_status;
  RETURN jsonb_build_object('payout_id', p.id, 'organization_id', p.organization_id, 'amount', p.amount, 'status', p.status,
                            'paid_at', p.paid_at, 'reference', p.reference, 'failure_reason', p.failure_reason,
                            'processed_by', p.processed_by, 'withdrawals_synced', synced, 'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_set_payout_status(uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_set_payout_status(uuid, text, text, text, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- Estado de un reembolso: requested|processing → processing|completed|failed.
-- 'failed' libera el bloqueo de doble reembolso (isActiveRefund) y deja de restar del saldo del productor, pero
-- NO revive las entradas ni devuelve la orden a 'paid': la devolución al comprador queda pendiente por otra vía.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aitickets_set_refund_status(
  p_refund_id uuid,
  p_status text,
  p_provider_reference text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_actor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.aitickets_refunds%ROWTYPE;
  v_provider_ref text := nullif(btrim(coalesce(p_provider_reference, '')), '');
  v_failure text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('processing', 'completed', 'failed') THEN
    RAISE EXCEPTION 'p_status debe ser processing, completed o failed (llegó %)', coalesce(p_status, 'NULL');
  END IF;

  SELECT * INTO r FROM public.aitickets_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el reembolso %', p_refund_id;
  END IF;

  IF r.status = p_status THEN
    RETURN jsonb_build_object('refund_id', r.id, 'order_id', r.order_id, 'event_id', r.event_id, 'status', r.status,
                              'total_amount', r.total_amount, 'provider_reference', r.provider_reference, 'changed', false);
  END IF;
  IF r.status NOT IN ('requested', 'processing') THEN
    RAISE EXCEPTION 'El reembolso % está ''%'': solo uno requested o processing puede pasar a %', r.id, r.status, p_status;
  END IF;
  IF p_status = 'completed' AND r.total_amount > 0 AND v_provider_ref IS NULL AND r.provider_reference IS NULL THEN
    RAISE EXCEPTION 'Indica p_provider_reference: el id del reembolso en Flow (o el comprobante de la devolución)';
  END IF;
  IF p_status = 'failed' AND v_failure IS NULL THEN
    RAISE EXCEPTION 'Indica p_reason: por qué no se pudo devolver';
  END IF;

  UPDATE public.aitickets_refunds
     SET status = p_status,
         provider_reference = coalesce(v_provider_ref, aitickets_refunds.provider_reference),
         processed_at = CASE WHEN p_status IN ('completed', 'failed') THEN now() ELSE aitickets_refunds.processed_at END,
         failure_reason = CASE WHEN p_status = 'failed' THEN v_failure ELSE aitickets_refunds.failure_reason END,
         processed_by = coalesce(nullif(btrim(coalesce(p_actor, '')), ''), aitickets_refunds.processed_by)
   WHERE id = p_refund_id
  RETURNING * INTO r;

  RETURN jsonb_build_object('refund_id', r.id, 'order_id', r.order_id, 'event_id', r.event_id, 'kind', r.kind,
                            'status', r.status, 'total_amount', r.total_amount, 'provider_reference', r.provider_reference,
                            'processed_at', r.processed_at, 'failure_reason', r.failure_reason, 'processed_by', r.processed_by,
                            'changed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_set_refund_status(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_set_refund_status(uuid, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- IRREVERSIBLE. Enmascara los datos bancarios copiados en el reparto de retiros YA TERMINADOS
-- (paid, cancelled, failed): número de cuenta → '•••• 1234', titular → 'A** P****', RUT → '••••678-9'.
-- Los retiros requested/processing quedan intactos para poder pagarlos; el trigger de arriba los enmascara al
-- terminar. La cuenta vigente de cada organización sigue completa en organization_payout_accounts.
-- ---------------------------------------------------------------------------
UPDATE public.event_withdrawals
   SET account_number = public.aitickets_mask_account_number(account_number),
       account_holder_name = public.aitickets_mask_person_name(account_holder_name),
       account_holder_rut = public.aitickets_mask_rut(account_holder_rut)
 WHERE status IN ('paid', 'cancelled', 'failed')
   AND (account_number IS DISTINCT FROM public.aitickets_mask_account_number(account_number)
        OR account_holder_name IS DISTINCT FROM public.aitickets_mask_person_name(account_holder_name)
        OR account_holder_rut IS DISTINCT FROM public.aitickets_mask_rut(account_holder_rut));

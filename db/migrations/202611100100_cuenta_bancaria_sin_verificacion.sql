-- La cuenta bancaria ya no se verifica: solo se verifica la identidad del productor (Didit).
-- aitickets_set_payout_status deja de exigir organization_payout_accounts.verified_at para marcar un retiro pagado.
-- Se mantienen los chequeos de cuenta cambiada después de pedir el retiro y de últimos 4 dígitos distintos.

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

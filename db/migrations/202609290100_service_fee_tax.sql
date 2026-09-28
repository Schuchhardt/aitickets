-- Cargo por servicio con IVA separado (decisión del dueño, oct 2026).
--
-- El comprador paga: subtotal (precio del productor) + cargo por servicio (10% del subtotal)
-- + IVA (19%) del cargo. event_orders guarda:
--   amount           subtotal de entradas (lo que recibe el productor)
--   ticket_fee       cargo por servicio NETO (sin IVA), igual que antes
--   service_fee_tax  IVA del cargo por servicio (nuevo; 0 en órdenes anteriores y en cortesías)
-- El monto esperado del pago (Flow/Stripe) es amount + ticket_fee + COALESCE(service_fee_tax, 0).
--
-- aitickets_reserve_order (202609270110, inmutable) se reemplaza con la misma firma para que también
-- guarde p_order->>'service_fee_tax'. Idempotente.
--
-- Rollback del código: el código anterior espera amount + ticket_fee; las órdenes creadas con IVA que
-- se paguen después quedan en status='review' (service_fee_tax > 0) y se confirman a mano.
-- Checklist en docs/deploy/fee-iva-rollback.md.

ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS service_fee_tax bigint DEFAULT 0;

UPDATE public.event_orders SET service_fee_tax = 0 WHERE service_fee_tax IS NULL;

COMMENT ON COLUMN public.event_orders.service_fee_tax IS
  'IVA (19%) del cargo por servicio al comprador, CLP. Total cobrado = amount + ticket_fee + service_fee_tax.';

CREATE OR REPLACE FUNCTION public.aitickets_reserve_order(
  p_event_id bigint,
  p_lines jsonb,
  p_order jsonb,
  p_hold_minutes int
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket record;
  v_used int;
  v_order_id uuid;
  v_ids bigint[];
  v_qtys int[];
  v_found bigint[];
  v_missing bigint;
  v_hold int := LEAST(GREATEST(COALESCE(p_hold_minutes, 15), 1), 24 * 60);
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'INVALID_LINES' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) l
     WHERE NOT (jsonb_typeof(l) = 'object'
                AND (l->>'id') ~ '^[0-9]{1,18}$'
                AND (l->>'quantity') ~ '^[0-9]{1,6}$')
  ) THEN
    RAISE EXCEPTION 'INVALID_LINES' USING ERRCODE = 'P0001';
  END IF;

  -- Líneas normalizadas (id -> cantidad total), ordenadas por id.
  SELECT array_agg(id ORDER BY id), array_agg(qty ORDER BY id)
    INTO v_ids, v_qtys
    FROM (
      SELECT (l->>'id')::bigint AS id, sum((l->>'quantity')::int)::int AS qty
        FROM jsonb_array_elements(p_lines) l
       GROUP BY 1
      HAVING sum((l->>'quantity')::int) > 0
    ) s;
  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'INVALID_LINES' USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueo de los tipos de entrada involucrados, siempre en orden de id (evita deadlocks).
  SELECT array_agg(id ORDER BY id) INTO v_found
    FROM (
      SELECT t.id
        FROM public.event_tickets t
       WHERE t.event_id = p_event_id
         AND t.id = ANY (v_ids)
         AND t.status = 'available'
       ORDER BY t.id
         FOR UPDATE
    ) locked;

  SELECT i INTO v_missing FROM unnest(v_ids) AS i WHERE NOT (i = ANY (COALESCE(v_found, ARRAY[]::bigint[]))) LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'TICKET_UNAVAILABLE:%', v_missing USING ERRCODE = 'P0001';
  END IF;

  -- Recuento con el bloqueo tomado (READ COMMITTED: cada sentencia ve lo ya confirmado por otros).
  FOR v_ticket IN
    SELECT t.id, t.total_quantity, q.qty
      FROM unnest(v_ids, v_qtys) AS q(id, qty)
      JOIN public.event_tickets t ON t.id = q.id
     WHERE t.total_quantity IS NOT NULL
     ORDER BY t.id
  LOOP
    SELECT COALESCE(a.sold, 0) + COALESCE(a.pending, 0) INTO v_used
      FROM public.aitickets_ticket_availability(p_event_id) a
     WHERE a.ticket_id = v_ticket.id;
    IF COALESCE(v_used, 0) + v_ticket.qty > v_ticket.total_quantity THEN
      RAISE EXCEPTION 'SOLD_OUT:%', v_ticket.id USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO public.event_orders (
    event_id, attendee_id, status, amount, ticket_fee, service_fee_tax, total_payment, ticket_qty, ticket_details,
    buyer_first_name, buyer_last_name, buyer_email, buyer_phone,
    ref, utm_source, utm_medium, utm_campaign,
    payment_provider, currency, hold_expires_at, terms_version, terms_accepted_at
  ) VALUES (
    p_event_id,
    (p_order->>'attendee_id')::bigint,
    'pending',
    COALESCE((p_order->>'amount')::bigint, 0),
    COALESCE((p_order->>'ticket_fee')::bigint, 0),
    COALESCE((p_order->>'service_fee_tax')::bigint, 0),
    (p_order->>'total_payment')::bigint,
    (p_order->>'ticket_qty')::int,
    p_order->'ticket_details',
    p_order->>'buyer_first_name',
    p_order->>'buyer_last_name',
    p_order->>'buyer_email',
    p_order->>'buyer_phone',
    p_order->>'ref',
    p_order->>'utm_source',
    p_order->>'utm_medium',
    p_order->>'utm_campaign',
    COALESCE(p_order->>'payment_provider', 'flow'),
    COALESCE(p_order->>'currency', 'CLP'),
    now() + make_interval(mins => v_hold),
    p_order->>'terms_version',
    CASE WHEN p_order->>'terms_version' IS NOT NULL THEN now() END
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aitickets_reserve_order(bigint, jsonb, jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aitickets_reserve_order(bigint, jsonb, jsonb, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_reserve_order(bigint, jsonb, jsonb, int) TO service_role;

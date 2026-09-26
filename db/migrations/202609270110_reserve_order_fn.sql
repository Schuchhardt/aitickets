-- WP2: disponibilidad y reserva ATÓMICA de stock.
--
-- aitickets_ticket_availability(event_id): fuente única de vendidas/pendientes por tipo de entrada.
--   sold    = event_attendees del tipo con status distinto de 'cancelled' (NULL cuenta como vendida).
--   pending = cantidades en ticket_details de órdenes del evento:
--             * 'processing' siempre (el webhook está emitiendo; puede solaparse un momento con sold,
--               lo que solo hace el conteo más conservador),
--             * 'pending' mientras COALESCE(hold_expires_at, created_at + 15 min) > now().
--
-- aitickets_reserve_order(event_id, lines, order, hold_minutes): bloquea FOR UPDATE las filas de
--   event_tickets involucradas (en orden de id para evitar deadlocks), recuenta con la misma regla y,
--   si alcanza, inserta la orden 'pending' con hold_expires_at = now() + hold_minutes. Dos compras
--   concurrentes por la última entrada quedan serializadas por el bloqueo: una obtiene la orden y la
--   otra recibe SOLD_OUT. Errores (SQLSTATE P0001):
--     'SOLD_OUT:<ticket_id>'            no queda stock suficiente para ese tipo
--     'TICKET_UNAVAILABLE:<ticket_id>'  el tipo no existe en el evento o no está 'available'
--     'INVALID_LINES'                   p_lines vacío o mal formado
--   Las cortesías (dashboard) NO pasan por aquí: pueden superar el stock a propósito.
--
-- Ambas: SECURITY DEFINER, search_path fijo, EXECUTE solo para service_role.

CREATE OR REPLACE FUNCTION public.aitickets_ticket_availability(p_event_id bigint)
RETURNS TABLE (ticket_id bigint, sold int, pending int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tickets AS (
    SELECT t.id FROM public.event_tickets t WHERE t.event_id = p_event_id
  ),
  issued AS (
    SELECT a.event_ticket_id AS id, count(*)::int AS n
      FROM public.event_attendees a
     WHERE a.event_id = p_event_id
       AND a.status IS DISTINCT FROM 'cancelled'
     GROUP BY a.event_ticket_id
  ),
  held AS (
    SELECT (line->>'id')::bigint AS id, sum((line->>'quantity')::int)::int AS n
      FROM public.event_orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.ticket_details) = 'array' THEN o.ticket_details ELSE '[]'::jsonb END
      ) AS line
     WHERE o.event_id = p_event_id
       AND (
         o.status = 'processing'
         OR (o.status = 'pending' AND COALESCE(o.hold_expires_at, o.created_at + interval '15 minutes') > now())
       )
       AND (line->>'id') ~ '^[0-9]{1,18}$'
       AND (line->>'quantity') ~ '^[0-9]{1,6}$'
     GROUP BY 1
  )
  SELECT t.id AS ticket_id,
         COALESCE(i.n, 0) AS sold,
         COALESCE(h.n, 0) AS pending
    FROM tickets t
    LEFT JOIN issued i ON i.id = t.id
    LEFT JOIN held h ON h.id = t.id;
$$;

REVOKE ALL ON FUNCTION public.aitickets_ticket_availability(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aitickets_ticket_availability(bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_ticket_availability(bigint) TO service_role;

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
    event_id, attendee_id, status, amount, ticket_fee, total_payment, ticket_qty, ticket_details,
    buyer_first_name, buyer_last_name, buyer_email, buyer_phone,
    ref, utm_source, utm_medium, utm_campaign,
    payment_provider, currency, hold_expires_at, terms_version, terms_accepted_at
  ) VALUES (
    p_event_id,
    (p_order->>'attendee_id')::bigint,
    'pending',
    COALESCE((p_order->>'amount')::bigint, 0),
    COALESCE((p_order->>'ticket_fee')::bigint, 0),
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

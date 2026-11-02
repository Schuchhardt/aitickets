-- Entradas numeradas: mapa de asientos por sala y asiento elegido por el comprador. Idempotente.
--
-- El formato del mapa y las plantillas están en src/lib/seatMap.mjs.
-- event_locations.seat_map  mapa que se vende en esa ubicación del evento (NULL = entrada general, sin asientos).
-- venues.seat_map           último mapa guardado de la sala: el panel lo propone al crear el próximo evento ahí.
-- event_tickets.seat_sections  secciones del mapa donde vale la entrada (NULL = todas). Así "Platea" y "Balcón"
--                              tienen precios distintos. El cupo (total_quantity) lo calcula el servidor a partir de
--                              los asientos; el tope real es que un asiento se vende una sola vez por función.
-- event_orders.seat_selection  asientos de la compra: {event_date_id, seats: [{key, label, ticket_id}]}.
-- event_attendees.seat_key / seat_label  asiento de este QR ("platea:C:7" / "Fila C · Asiento 7"). No confundir con
--                              seat_number, que es el lugar dentro de una mesa para N.
--
-- public.aitickets_event_seats: un asiento tomado por función (UNIQUE event_date_id + seat_key).
--   status 'held'  reservado por una orden en curso hasta expires_at (el mismo plazo que la orden).
--   status 'sold'  emitido: attendee_ticket_id apunta al QR.
-- Un asiento vuelve a estar libre, sin barrer nada, cuando:
--   * 'held' y la orden ya no está en curso (failed/cancelled/expired...) o venció su plazo sin estar en proceso de
--     pago (processing) ni pagada;
--   * 'sold' y su QR fue anulado (event_attendees.status = 'cancelled') o borrado.
-- aitickets_hold_seats borra esas filas viejas antes de tomar el asiento; aitickets_taken_seats lista solo los
-- asientos realmente ocupados. Un pago tardío vuelve a llamar a aitickets_hold_seats: si alguien tomó el asiento
-- entretanto, la orden pasa a revisión (netlify/lib/orders.mjs).
-- RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

ALTER TABLE public.event_locations ADD COLUMN IF NOT EXISTS seat_map jsonb;
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS seat_map jsonb;
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS seat_sections text[];
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS seat_selection jsonb;
ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS seat_key text;
ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS seat_label text;

COMMENT ON COLUMN public.event_locations.seat_map IS 'Mapa de asientos de esta ubicación (src/lib/seatMap.mjs). NULL = entrada general.';
COMMENT ON COLUMN public.venues.seat_map IS 'Último mapa de asientos guardado para esta sala (se propone en el próximo evento).';
COMMENT ON COLUMN public.event_tickets.seat_sections IS 'Secciones del mapa donde vale la entrada numerada. NULL = todas.';
COMMENT ON COLUMN public.event_orders.seat_selection IS 'Asientos elegidos: {event_date_id, seats: [{key, label, ticket_id}]}.';
COMMENT ON COLUMN public.event_attendees.seat_key IS 'Asiento numerado de este QR ("<sección>:<fila>:<n>"). NULL = sin asiento.';
COMMENT ON COLUMN public.event_attendees.seat_label IS 'Asiento para mostrar ("Platea · Fila C · Asiento 7").';

CREATE TABLE IF NOT EXISTS public.aitickets_event_seats (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id bigint NOT NULL REFERENCES public.event_dates(id) ON DELETE CASCADE,
  seat_key text NOT NULL CHECK (seat_key ~ '^[a-z0-9-]{1,40}:[A-Z]{1,2}:[0-9]{1,3}$'),
  order_id uuid REFERENCES public.event_orders(id) ON DELETE CASCADE,
  attendee_ticket_id uuid REFERENCES public.event_attendees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'sold')),
  expires_at timestamptz,
  CONSTRAINT aitickets_event_seats_seat_key UNIQUE (event_date_id, seat_key)
);

CREATE INDEX IF NOT EXISTS aitickets_event_seats_order_idx ON public.aitickets_event_seats (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS aitickets_event_seats_event_idx ON public.aitickets_event_seats (event_id);

COMMENT ON TABLE public.aitickets_event_seats IS
  'Asientos numerados tomados por función (reservados o vendidos). src/lib/seatMap.mjs, netlify/lib/seats.mjs.';

ALTER TABLE public.aitickets_event_seats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_seats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_seats TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_event_seats_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_event_seats_id_seq TO service_role;

-- true si la fila todavía ocupa el asiento (ver la cabecera).
CREATE OR REPLACE FUNCTION public.aitickets_seat_is_live(p_status text, p_expires_at timestamptz, p_order_id uuid, p_attendee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_status = 'sold' THEN
      p_attendee_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.event_attendees a WHERE a.id = p_attendee_id AND a.status IS DISTINCT FROM 'cancelled'
      )
    ELSE EXISTS (
      SELECT 1 FROM public.event_orders o
       WHERE o.id = p_order_id
         AND (
           o.status IN ('processing', 'paid')
           OR (o.status = 'pending' AND COALESCE(p_expires_at, o.hold_expires_at, o.created_at + interval '15 minutes') > now())
         )
    )
  END;
$$;

-- Toma los asientos para la orden. Devuelve los que no se pudieron tomar (vacío = todos tomados). Si alguno falla,
-- suelta los que tomó: la compra se hace completa o no se hace. Idempotente para la misma orden.
CREATE OR REPLACE FUNCTION public.aitickets_hold_seats(p_order_id uuid, p_event_date_id bigint, p_keys text[], p_expires_at timestamptz)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id bigint;
  v_taken text[];
BEGIN
  SELECT event_id INTO v_event_id FROM public.event_orders WHERE id = p_order_id;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.id = p_event_date_id AND d.event_id = v_event_id) THEN
    RAISE EXCEPTION 'FUNCTION_NOT_IN_EVENT';
  END IF;

  DELETE FROM public.aitickets_event_seats s
   WHERE s.event_date_id = p_event_date_id
     AND s.seat_key = ANY (p_keys)
     AND s.order_id IS DISTINCT FROM p_order_id
     AND NOT public.aitickets_seat_is_live(s.status, s.expires_at, s.order_id, s.attendee_ticket_id);

  INSERT INTO public.aitickets_event_seats (event_id, event_date_id, seat_key, order_id, status, expires_at)
  SELECT v_event_id, p_event_date_id, k, p_order_id, 'held', p_expires_at
    FROM unnest(p_keys) AS k
  ON CONFLICT (event_date_id, seat_key) DO NOTHING;

  -- Las de esta orden renuevan el plazo (reintento o pago tardío)
  UPDATE public.aitickets_event_seats
     SET expires_at = p_expires_at
   WHERE order_id = p_order_id AND event_date_id = p_event_date_id AND status = 'held';

  SELECT COALESCE(array_agg(k), '{}') INTO v_taken
    FROM unnest(p_keys) AS k
   WHERE NOT EXISTS (
     SELECT 1 FROM public.aitickets_event_seats s
      WHERE s.event_date_id = p_event_date_id AND s.seat_key = k AND s.order_id = p_order_id
   );

  IF array_length(v_taken, 1) > 0 THEN
    DELETE FROM public.aitickets_event_seats WHERE order_id = p_order_id AND status = 'held';
  END IF;
  RETURN v_taken;
END;
$$;

-- Asientos ocupados de una función (reservados vigentes o vendidos).
CREATE OR REPLACE FUNCTION public.aitickets_taken_seats(p_event_date_id bigint)
RETURNS TABLE (seat_key text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.seat_key, s.status
    FROM public.aitickets_event_seats s
   WHERE s.event_date_id = p_event_date_id
     AND public.aitickets_seat_is_live(s.status, s.expires_at, s.order_id, s.attendee_ticket_id);
$$;

-- Asientos ocupados por función de un evento (para marcar funciones agotadas).
CREATE OR REPLACE FUNCTION public.aitickets_seat_counts(p_event_id bigint)
RETURNS TABLE (event_date_id bigint, taken int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.event_date_id, count(*)::int
    FROM public.aitickets_event_seats s
   WHERE s.event_id = p_event_id
     AND public.aitickets_seat_is_live(s.status, s.expires_at, s.order_id, s.attendee_ticket_id)
   GROUP BY s.event_date_id;
$$;

REVOKE ALL ON FUNCTION public.aitickets_seat_is_live(text, timestamptz, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aitickets_hold_seats(uuid, bigint, text[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aitickets_taken_seats(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aitickets_seat_counts(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_seat_is_live(text, timestamptz, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aitickets_hold_seats(uuid, bigint, text[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.aitickets_taken_seats(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.aitickets_seat_counts(bigint) TO service_role;

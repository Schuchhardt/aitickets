-- Mesa para N: un tipo de entrada que emite un QR por persona. Idempotente.
--
-- event_tickets.people_per_ticket: personas por unidad (1 = entrada normal). Una "Mesa VIP · 6 personas" vendida
--   una vez emite 6 filas en event_attendees (6 QR que se validan uno por uno).
-- El cupo (total_quantity), el máximo por compra y el precio son POR MESA: aitickets_reserve_order sigue contando
--   unidades (sin cambios, con el mismo bloqueo) y aitickets_ticket_availability cuenta como vendida cada mesa con al
--   menos un QR vigente.
-- event_attendees.unit_id: mismo uuid para los QR de una misma mesa (NULL en entradas normales).
-- event_attendees.seat_number: 1..N dentro de la mesa ("Invitado 2 de 6").

ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS people_per_ticket smallint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_tickets_people_per_ticket_range') THEN
    ALTER TABLE public.event_tickets
      ADD CONSTRAINT event_tickets_people_per_ticket_range CHECK (people_per_ticket BETWEEN 1 AND 30);
  END IF;
END $$;

ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS seat_number smallint;

COMMENT ON COLUMN public.event_tickets.people_per_ticket IS
  'Personas por unidad (mesa para N): emite un QR por persona. Cupo, máximo por compra y precio son por unidad.';
COMMENT ON COLUMN public.event_attendees.unit_id IS 'Unidad comprada (mesa) a la que pertenece el QR. NULL = entrada normal.';
COMMENT ON COLUMN public.event_attendees.seat_number IS 'Lugar dentro de la mesa (1..N). NULL = entrada normal.';

-- Misma función que 202609270110, pero "sold" cuenta unidades: los QR de una mesa (mismo unit_id) cuentan una vez.
-- Las entradas normales (unit_id NULL) cuentan como siempre, una por fila.
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
    SELECT a.event_ticket_id AS id, count(DISTINCT COALESCE(a.unit_id, a.id))::int AS n
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

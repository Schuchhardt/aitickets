-- Ingreso por entrada Y función: un pase de varios días entra una vez cada día. Idempotente.
--
-- Hasta ahora el check-in era un solo flag por entrada (event_attendees.status = 'validated' + validated_at), así
-- que una entrada "para todas las funciones" (event_tickets.event_date_id NULL) de un evento con varias funciones
-- (taller de 4 sesiones, seminario de 3 días) se acreditaba el primer día y después ya no entraba.
--
-- public.aitickets_attendee_checkins: una fila por ingreso de una entrada a una función.
--   event_attendee_id  la entrada (event_attendees.id)
--   event_id           evento (para listar la asistencia de un evento sin pasar por event_attendees)
--   event_date_id      la función a la que entró (la de hoy en hora de Chile, o la más cercana; netlify/lib/checkin.mjs)
--   checked_in_at      hora del ingreso (la del dispositivo si validó sin conexión)
-- UNIQUE (event_attendee_id, event_date_id): dos dispositivos no pueden registrar el mismo ingreso dos veces; el
-- segundo recibe 23505 y responde "Ya ingresó hoy".
--
-- Solo se usa para entradas multifunción. Las entradas de una función (o de eventos con una sola función) siguen
-- con el flag de siempre. En las multifunción, event_attendees.status pasa a 'validated' en el primer ingreso
-- (validated_at = primer ingreso): así "asistió" sigue significando lo mismo en estadísticas, reseñas y mensajes.
--
-- Backfill: las entradas multifunción ya validadas quedan registradas en la función del día en que se validaron
-- (o la más cercana), para que no puedan volver a entrar ese mismo día después del deploy.
--
-- El código tolera que la tabla no exista (vuelve a la regla de un solo ingreso). RLS sin políticas y REVOKE a
-- anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_attendee_checkins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_attendee_id uuid NOT NULL REFERENCES public.event_attendees(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id bigint NOT NULL REFERENCES public.event_dates(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_attendee_checkins_once UNIQUE (event_attendee_id, event_date_id)
);

CREATE INDEX IF NOT EXISTS aitickets_attendee_checkins_event_idx ON public.aitickets_attendee_checkins (event_id, event_date_id);

COMMENT ON TABLE public.aitickets_attendee_checkins IS
  'Ingreso de una entrada multifunción a cada función (un pase de 3 días entra una vez por día). netlify/lib/checkin.mjs.';

ALTER TABLE public.aitickets_attendee_checkins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_attendee_checkins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_attendee_checkins TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_attendee_checkins_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_attendee_checkins_id_seq TO service_role;

-- Backfill de las entradas multifunción ya validadas.
INSERT INTO public.aitickets_attendee_checkins (event_attendee_id, event_id, event_date_id, checked_in_at)
SELECT ea.id, ea.event_id, fn.id, ea.validated_at
FROM public.event_attendees ea
JOIN public.event_tickets et ON et.id = ea.event_ticket_id
CROSS JOIN LATERAL (
  SELECT d.id
  FROM public.event_dates d
  WHERE d.event_id = ea.event_id
  ORDER BY abs(d.date - (ea.validated_at AT TIME ZONE 'America/Santiago')::date), d.date DESC, d.start_time
  LIMIT 1
) fn
WHERE ea.status = 'validated'
  AND ea.validated_at IS NOT NULL
  AND et.event_date_id IS NULL
  AND (SELECT count(*) FROM public.event_dates d2 WHERE d2.event_id = ea.event_id) > 1
ON CONFLICT (event_attendee_id, event_date_id) DO NOTHING;

-- Agenda del evento: bloques con hora, título, expositores y sala, por función. Idempotente.
--
-- Hasta ahora el programa iba en la descripción (texto libre). Con bloques propios la página del evento muestra la
-- agenda por día (src/lib/eventAgenda.ts, EventSections.vue) y el productor la edita en el panel (pestaña Página,
-- EventAgendaManager.vue) o con el asistente de IA (get_event_agenda / update_event_agenda).
--
-- Tabla y no un jsonb en events: cada bloque apunta a su función con una FK (event_dates), así un cambio de
-- funciones no deja bloques colgando de un id que ya no existe, y la página pública lo lee sin tocar la fila del
-- evento (que se carga en una RPC aparte).
--
-- public.aitickets_event_agenda: una fila por bloque.
--   event_id       evento
--   event_date_id  función (día) del bloque; NULL = vale para todas las funciones (un taller con el mismo horario
--                  cada día). Si se borra la función, el bloque queda sin función en vez de perderse.
--   starts_at / ends_at  hora local de inicio y de término (opcional)
--   title          título del bloque ("Panel: IA en la empresa")
--   speakers       expositores en texto libre ("Ana Pérez (Empresa X), Juan Soto")
--   room           sala o escenario ("Sala 2")
--   position       orden de bloques que empiezan a la misma hora
-- RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_event_agenda (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id bigint REFERENCES public.event_dates(id) ON DELETE SET NULL,
  starts_at time NOT NULL,
  ends_at time,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  speakers text CHECK (speakers IS NULL OR char_length(speakers) <= 300),
  room text CHECK (room IS NULL OR char_length(room) <= 80),
  position integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS aitickets_event_agenda_event_idx ON public.aitickets_event_agenda (event_id, event_date_id, starts_at);

COMMENT ON TABLE public.aitickets_event_agenda IS
  'Agenda del evento: bloques con hora, expositores y sala por función. src/lib/eventAgenda.ts.';

ALTER TABLE public.aitickets_event_agenda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_agenda FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_agenda TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_event_agenda_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_event_agenda_id_seq TO service_role;

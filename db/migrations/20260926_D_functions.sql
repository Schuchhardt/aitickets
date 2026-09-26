-- Agente F1: entradas por función (contrato R1).
-- event_tickets.event_date_id NULL = la entrada es válida para cualquier función del evento.
-- Idempotente. Solo toca objetos de AI Tickets (public.event_tickets).
-- ON DELETE SET NULL: si el productor elimina una función, sus entradas pasan a "todas las funciones"
-- en vez de bloquear el borrado.

ALTER TABLE public.event_tickets
  ADD COLUMN IF NOT EXISTS event_date_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_tickets_event_date_id_fkey'
      AND conrelid = 'public.event_tickets'::regclass
  ) THEN
    ALTER TABLE public.event_tickets
      ADD CONSTRAINT event_tickets_event_date_id_fkey
      FOREIGN KEY (event_date_id) REFERENCES public.event_dates(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_tickets_event_date_id_idx
  ON public.event_tickets (event_date_id)
  WHERE event_date_id IS NOT NULL;

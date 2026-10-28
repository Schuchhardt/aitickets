-- Dirección que solo ven quienes compran: cuándo se revela. Idempotente.
--
-- events.secret_location (ya existía) es la dirección privada: nunca sale en lo público (aitickets_public_event_page
-- solo dice has_secret_location). secret_location_reveal_hours = cuántas horas antes de la primera función de la
-- entrada se muestra en la orden y la entrada, y se manda por correo (función programada send-secret-location).
-- NULL = apenas compran (como antes). Lógica en netlify/lib/secret-location.mjs.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS secret_location_reveal_hours integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_secret_location_reveal_hours_range') THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_secret_location_reveal_hours_range
      CHECK (secret_location_reveal_hours IS NULL OR secret_location_reveal_hours BETWEEN 1 AND 168);
  END IF;
END $$;

COMMENT ON COLUMN public.events.secret_location_reveal_hours IS
  'Horas antes de la función en que se revela secret_location a quienes compraron. NULL = apenas compran.';

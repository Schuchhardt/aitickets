-- Dirección privada: secret_location_reveal_hours = 0 significa "el día de la función" (a las 9:00 en hora de Chile, o al
-- empezar si es antes). Amplía el rango del CHECK de 202610300310 (1 a 168) a 0 a 168. Idempotente.
-- Lógica en netlify/lib/secret-location.mjs (REVEAL_EVENT_DAY).

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_secret_location_reveal_hours_range;

ALTER TABLE public.events
  ADD CONSTRAINT events_secret_location_reveal_hours_range
  CHECK (secret_location_reveal_hours IS NULL OR secret_location_reveal_hours BETWEEN 0 AND 168);

COMMENT ON COLUMN public.events.secret_location_reveal_hours IS
  'Cuándo se revela secret_location a quienes compraron: NULL = apenas compran; 0 = el día de la función; N = N horas antes.';

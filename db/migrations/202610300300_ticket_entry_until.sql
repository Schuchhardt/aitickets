-- Hora límite de ingreso por tipo de entrada: la lista "hasta las 01:00". Idempotente.
--
-- entry_until = hora local (America/Santiago) relativa a la función de la entrada: si es anterior a su hora de
-- inicio, es de la madrugada siguiente (función a las 23:00, entry_until 01:00 = 01:00 del día siguiente). Pasada esa
-- hora, confirmar el ingreso responde "fuera de horario" (409 late_entry) y la puerta decide si deja entrar igual
-- (force). La regla vive en src/lib/entryDeadline.mjs (servidor y escáner offline). NULL = entra a cualquier hora.

ALTER TABLE public.event_tickets
  ADD COLUMN IF NOT EXISTS entry_until time;

COMMENT ON COLUMN public.event_tickets.entry_until IS
  'Hora límite de ingreso (hora de Chile; antes del inicio de la función = madrugada siguiente). NULL = sin límite.';

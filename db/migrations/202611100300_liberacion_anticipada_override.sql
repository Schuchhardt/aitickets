-- release_event_funds (MCP de admin) con override_conditions=true: el ledger deja de exigir las condiciones de
-- liberación (identidad, check-ins, reclamos) al tramo liberado. Antes el override solo se evaluaba al confirmar y
-- no quedaba guardado, así que el saldo no cambiaba. Se marca en el evento (todas sus ventas) o en una función.
alter table public.events add column if not exists release_override_at timestamptz;
alter table public.event_dates add column if not exists release_override_at timestamptz;

comment on column public.events.release_override_at is
  'release_event_funds con override_conditions: el ledger libera lo vendido del evento sin exigir condiciones. Quién: released_early_by.';
comment on column public.event_dates.release_override_at is
  'release_event_funds con override_conditions para esta función: el ledger la libera sin exigir condiciones. Quién: released_early_by.';

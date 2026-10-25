-- migrate:no-transaction
-- MCP de administración (src/lib/admin-api/): Visitas de toda la plataforma por período.
-- Un índice por archivo: CREATE INDEX CONCURRENTLY no corre dentro de una transacción, y varias sentencias en una
-- misma consulta se ejecutan como una. CONCURRENTLY no bloquea escrituras; IF NOT EXISTS lo deja idempotente.
CREATE INDEX CONCURRENTLY IF NOT EXISTS aitickets_event_visits_created_idx ON public.event_visits (created_at);

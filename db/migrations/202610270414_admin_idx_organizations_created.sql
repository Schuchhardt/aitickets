-- migrate:no-transaction
-- MCP de administración (src/lib/admin-api/): Registros de productores por período (embudo, actividad).
-- Un índice por archivo: CREATE INDEX CONCURRENTLY no corre dentro de una transacción, y varias sentencias en una
-- misma consulta se ejecutan como una. CONCURRENTLY no bloquea escrituras; IF NOT EXISTS lo deja idempotente.
CREATE INDEX CONCURRENTLY IF NOT EXISTS aitickets_organizations_created_idx ON public.organizations (created_at);

-- migrate:no-transaction
-- MCP de administración (src/lib/admin-api/): Bandeja de retiros por estado.
-- Un índice por archivo: CREATE INDEX CONCURRENTLY no corre dentro de una transacción, y varias sentencias en una
-- misma consulta se ejecutan como una. CONCURRENTLY no bloquea escrituras; IF NOT EXISTS lo deja idempotente.
CREATE INDEX CONCURRENTLY IF NOT EXISTS aitickets_payouts_status_created_idx ON public.aitickets_payouts (status, created_at);

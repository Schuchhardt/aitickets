-- migrate:no-transaction
-- MCP de administración (src/lib/admin-api/): KPIs por período (órdenes pagadas creadas en un rango).
-- Un índice por archivo: CREATE INDEX CONCURRENTLY no corre dentro de una transacción, y varias sentencias en una
-- misma consulta se ejecutan como una. CONCURRENTLY no bloquea escrituras; IF NOT EXISTS lo deja idempotente.
CREATE INDEX CONCURRENTLY IF NOT EXISTS aitickets_event_orders_status_created_idx ON public.event_orders (status, created_at);

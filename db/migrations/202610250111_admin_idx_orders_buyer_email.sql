-- migrate:no-transaction
-- MCP de administración (src/lib/admin-api/): search_orders por correo del comprador.
-- Un índice por archivo: CREATE INDEX CONCURRENTLY no corre dentro de una transacción, y varias sentencias en una
-- misma consulta se ejecutan como una. CONCURRENTLY no bloquea escrituras; IF NOT EXISTS lo deja idempotente.
CREATE INDEX CONCURRENTLY IF NOT EXISTS aitickets_event_orders_buyer_email_idx ON public.event_orders (lower(buyer_email));

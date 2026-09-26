-- WP2: proveedor de pago por orden (Flow / Stripe), reserva de stock por orden y registro de eventos
-- de webhooks para idempotencia. Expand-only: el código desplegado hoy sigue funcionando (todas las
-- columnas nuevas son opcionales o tienen default).
-- Solo toca public.event_orders (tabla de AI Tickets) y crea public.aitickets_payment_events.

-- ---------------------------------------------------------------------------
-- event_orders: columnas nuevas
-- ---------------------------------------------------------------------------
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS payment_provider text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS currency text;
-- Stripe: id de la Checkout Session (cs_...). Flow sigue usando payment_external_id (flowOrder).
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS provider_session_id text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS payment_intent_id text;
-- Fin de la reserva de stock de una orden pendiente (15 min Flow, 31 min Stripe).
-- NULL (órdenes antiguas) = created_at + 15 minutos.
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS terms_version text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

-- Backfill del proveedor: monto 0 -> 'free' (o 'courtesy' si la marcó el dashboard), resto -> 'flow'.
UPDATE public.event_orders
   SET payment_provider = CASE
         WHEN ticket_details @> '[{"complimentary": true}]'::jsonb THEN 'courtesy'
         WHEN COALESCE(amount, 0) = 0 AND COALESCE(ticket_fee, 0) = 0 THEN 'free'
         ELSE 'flow'
       END
 WHERE payment_provider IS NULL;

UPDATE public.event_orders SET currency = 'CLP' WHERE currency IS NULL;

ALTER TABLE public.event_orders ALTER COLUMN payment_provider SET DEFAULT 'flow';
ALTER TABLE public.event_orders ALTER COLUMN payment_provider SET NOT NULL;
ALTER TABLE public.event_orders ALTER COLUMN currency SET DEFAULT 'CLP';
ALTER TABLE public.event_orders ALTER COLUMN currency SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'event_orders_payment_provider_check'
       AND conrelid = 'public.event_orders'::regclass
  ) THEN
    ALTER TABLE public.event_orders
      ADD CONSTRAINT event_orders_payment_provider_check
      CHECK (payment_provider IN ('flow', 'stripe', 'free', 'demo', 'courtesy'));
  END IF;
END $$;

-- status es text (sin enum): el vocabulario suma 'refunded' (reembolso de Stripe) y 'expired'.
-- Valores en uso: pending, processing, paid, failed, rejected, cancelled, expired, review, refunded.

CREATE INDEX IF NOT EXISTS idx_event_orders_provider_session_id
  ON public.event_orders (provider_session_id);
CREATE INDEX IF NOT EXISTS idx_event_orders_event_status_hold
  ON public.event_orders (event_id, status, hold_expires_at);
-- expire-pending-orders busca pendientes vencidas de todos los eventos
CREATE INDEX IF NOT EXISTS idx_event_orders_status_hold
  ON public.event_orders (status, hold_expires_at);

-- ---------------------------------------------------------------------------
-- aitickets_payment_events: idempotencia de webhooks (id = id del evento del proveedor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_payment_events (
  id text PRIMARY KEY,
  provider text NOT NULL,
  type text NOT NULL,
  order_id uuid NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_aitickets_payment_events_order
  ON public.aitickets_payment_events (order_id);

ALTER TABLE public.aitickets_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aitickets_payment_events FROM PUBLIC;
REVOKE ALL ON public.aitickets_payment_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aitickets_payment_events TO service_role;

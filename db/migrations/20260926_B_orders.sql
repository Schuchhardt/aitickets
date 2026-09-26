-- Agente B: columnas de atribución e idempotencia del correo en event_orders.
-- Idempotente. Solo toca public.event_orders (tabla de AI Tickets).

ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS ref text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS utm_source text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS utm_medium text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS utm_campaign text;
-- Momento en que se envió el correo con las entradas (guarda de idempotencia del webhook / reenvíos).
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

-- Stock: órdenes pendientes recientes por evento (regla C2) y búsqueda de entradas por orden.
CREATE INDEX IF NOT EXISTS idx_event_orders_event_status_created
  ON public.event_orders (event_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_event_attendees_event_order_id
  ON public.event_attendees (event_order_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_event_ticket
  ON public.event_attendees (event_id, event_ticket_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_qr_code
  ON public.event_attendees (qr_code);

-- ---------------------------------------------------------------------------
-- Ronda 2 (F2)
-- ---------------------------------------------------------------------------
-- R2: datos del comprador por orden (el registro `attendees` se comparte por email entre órdenes).
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS buyer_first_name text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS buyer_last_name text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS buyer_email text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS buyer_phone text;

-- Correo de entradas: email_sent_at = enviado con éxito; email_claimed_at = envío en curso.
-- Un claim sin éxito con más de 10 minutos se considera abandonado y puede reclamarse de nuevo.
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS email_claimed_at timestamptz;

-- Webhook de Flow: la orden se reclama (status 'processing') antes de emitir entradas.
-- Un 'processing' con más de 5 minutos se considera abandonado (la función murió) y puede reclamarse.
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

-- Límite de órdenes pendientes simultáneas por comprador + evento.
CREATE INDEX IF NOT EXISTS idx_event_orders_event_attendee_status
  ON public.event_orders (event_id, attendee_id, status);

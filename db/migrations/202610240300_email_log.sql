-- Registro de entrega de los correos de entradas (Resend). Idempotente.
--
-- Hasta ahora la única huella del correo de entradas era event_orders.email_sent_at / email_claimed_at:
-- notification_log no guarda destinatario, proveedor ni error, y no se guardaba el id de Resend, así que
-- "no me llegó la entrada" no se podía diagnosticar (¿se envió? ¿a qué correo? ¿rebotó?).
--
-- public.aitickets_email_log: una fila por INTENTO de envío (también los reenvíos con force=true).
--   kind                 'tickets' (correo de entradas de una orden). Abierto a otros tipos más adelante.
--   order_id / event_id  orden y evento del correo (sin FK: el log no debe bloquear borrados ni fallar el envío).
--   recipient            dirección a la que se envió (la del comprador de la orden). Nunca el contenido.
--   provider_message_id  id del correo en Resend; con él el webhook (/api/webhooks/resend) actualiza el estado.
--   status               sent | failed (local) y delivered | delayed | bounced | complained (webhook de Resend).
--   error                motivo del fallo o del rebote (truncado).
--   events               últimos eventos del proveedor [{id, type, at}] (deduplicados por id de Svix).
--   last_event_at        fecha del último evento del proveedor.
--
-- El código tolera que la tabla no exista (deploy previews sobre la BD de producción sin migrar): registrar
-- nunca hace fallar el envío. Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_email_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'tickets' CHECK (char_length(kind) BETWEEN 1 AND 40),
  order_id uuid,
  event_id bigint,
  recipient text CHECK (recipient IS NULL OR char_length(recipient) <= 320),
  provider text NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend')),
  provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'delivered', 'delayed', 'bounced', 'complained')),
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_event_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS aitickets_email_log_provider_message_key
  ON public.aitickets_email_log (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS aitickets_email_log_order_idx ON public.aitickets_email_log (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_email_log_created_idx ON public.aitickets_email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_email_log_status_idx ON public.aitickets_email_log (status, created_at DESC);

COMMENT ON TABLE public.aitickets_email_log IS
  'Intentos de envío de correos de entradas y su estado de entrega (Resend + webhook). Sin contenido del correo.';

ALTER TABLE public.aitickets_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_email_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_email_log TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_email_log_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_email_log_id_seq TO service_role;

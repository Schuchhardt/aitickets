-- Correos de reseña: hasta 3 por persona y evento (el primero y dos recordatorios, netlify/lib/review-requests.mjs).
-- Idempotente.
--
-- notification_log.email: a quién se le mandó. Los correos de reseña también van a quien compró (event_orders.
--   buyer_email) y al asistente de cada QR (event_attendees.holder_email), que puede no tener fila en attendees
--   (attendee_id NULL): sin el email no habría cómo contar cuántos recibió. También registra la baja de los
--   recordatorios de un evento (type 'review_request_optout'). Filas anteriores: NULL (se asocian por attendee_id).

ALTER TABLE public.notification_log ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.notification_log.email IS
  'Correo del destinatario (minúsculas). Lo usan los correos de reseña y su baja; NULL en filas antiguas o de otros tipos.';

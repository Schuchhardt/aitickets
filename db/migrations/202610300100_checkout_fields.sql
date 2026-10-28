-- Datos extra del checkout configurables por evento (src/lib/checkoutFields.mjs). Idempotente.
--
-- events.checkout_fields: { attendee_names: 'off'|'optional'|'required', company: bool, questions: [...] }.
--   NULL = el checkout de siempre (solo nombre y correo de quien compra).
-- event_orders.attendee_holders: [{ ticket_id, name, email }], un elemento por QR, en el orden en que se emiten
--   (netlify/lib/tickets.mjs: buildAttendeeRows). Se copia a event_attendees al emitir.
-- event_orders.registration_answers: [{ id, question, answer }], las respuestas a las preguntas del evento (una vez
--   por compra; guarda el texto de la pregunta tal como se vio).
-- event_orders.company_rut / company_name: RUT (12345678-5) y razón social de la empresa, opcionales. Salen en el
--   comprobante, que NO es boleta ni factura.
-- event_attendees.holder_name / holder_email: asistente de cada QR. NULL = el de quien compró la orden.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS checkout_fields jsonb;

ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS attendee_holders jsonb;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS registration_answers jsonb;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS company_rut text;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS company_name text;

ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS holder_name text;
ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS holder_email text;

COMMENT ON COLUMN public.events.checkout_fields IS
  'Datos extra del checkout: asistentes por entrada, datos de empresa y preguntas (src/lib/checkoutFields.mjs). NULL = ninguno.';
COMMENT ON COLUMN public.event_orders.attendee_holders IS
  'Asistente de cada QR de la compra [{ticket_id, name, email}], en orden de emisión. NULL = todos a nombre de quien compra.';
COMMENT ON COLUMN public.event_orders.registration_answers IS
  'Respuestas a las preguntas del evento [{id, question, answer}].';
COMMENT ON COLUMN public.event_orders.company_rut IS 'RUT de la empresa que compra (opcional). No implica boleta ni factura.';
COMMENT ON COLUMN public.event_orders.company_name IS 'Razón social de la empresa que compra (opcional). No implica boleta ni factura.';
COMMENT ON COLUMN public.event_attendees.holder_name IS 'Nombre del asistente de este QR. NULL = quien compró.';
COMMENT ON COLUMN public.event_attendees.holder_email IS 'Correo del asistente de este QR (recibe su entrada). NULL = quien compró.';

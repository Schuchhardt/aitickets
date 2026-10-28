-- Preguntas por persona (src/lib/checkoutFields.mjs, questions[].per = 'attendee'). Idempotente.
--
-- event_attendees.registration_answers: [{ id, question, answer }], las respuestas de la persona de este QR. Vienen de
--   event_orders.attendee_holders[i].answers al emitir (netlify/lib/tickets.mjs: buildAttendeeRows) o las completa
--   la persona desde su entrada (/ticket/<id>, POST /api/tickets/holder) cuando quien compró la invitó por correo
--   (checkout_fields.holders = 'invite'). NULL = sin respuestas propias.
-- events.checkout_fields suma holders ('buyer' | 'invite') y questions[].per ('order' | 'attendee'); es jsonb, no
--   cambia la columna.

ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS registration_answers jsonb;

COMMENT ON COLUMN public.event_attendees.registration_answers IS
  'Respuestas de la persona de este QR a las preguntas por persona [{id, question, answer}]. NULL = sin respuestas.';

-- Envíos de certificados de asistencia por correo. Idempotente.
--
-- El certificado no se guarda: se arma en cada descarga desde los check-ins (src/lib/certificates.ts) y cada
-- asistente lo descarga con un link firmado (/certificado/<token>). Esta tabla solo registra cada envío por correo
-- (send_attendance_certificates, desde el panel o el asistente de IA): a quiénes ya se les mandó, para que un segundo
-- envío llegue solo a quienes faltan, y para mostrar en el panel cuándo se envió.
--
-- public.aitickets_certificate_sends: una fila por envío.
--   event_id / organization_id  evento y productora
--   ticket_ids        entradas (event_attendees.id) cuyos certificados se enviaron
--   recipients_count  correos enviados (una persona con varias entradas recibe un solo correo)
--   min_sessions      mínimo de funciones con ingreso que se exigió a los pases
--   hours             horas fijadas por el productor (NULL = las de las funciones)
--   created_by        quién lo envió (users.id)
-- RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_certificate_sends (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ticket_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  recipients_count integer NOT NULL DEFAULT 0,
  min_sessions integer NOT NULL DEFAULT 1,
  hours numeric(5,1),
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS aitickets_certificate_sends_event_idx ON public.aitickets_certificate_sends (event_id, created_at DESC);

COMMENT ON TABLE public.aitickets_certificate_sends IS
  'Envíos por correo de certificados de asistencia (a quiénes ya se les mandó). src/lib/producer-api/tools/certificates.ts.';

ALTER TABLE public.aitickets_certificate_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_certificate_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_certificate_sends TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_certificate_sends_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_certificate_sends_id_seq TO service_role;

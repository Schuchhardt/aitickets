-- Reporte semanal para productores (correo de los domingos con ventas, mejor canal y sugerencias con IA). Idempotente.
--
-- 1) aitickets_weekly_reports: un reporte por organización y semana. La background function
--    send-weekly-reports-background (netlify/lib/weekly-report-send.mjs) RECLAMA la semana con un INSERT (la clave
--    única organization_id + week_start hace que dos ejecuciones nunca manden dos veces el mismo reporte) y lo
--    cierra con status 'sent' | 'skipped' | 'failed'. Una fila 'sending' de más de 20 min (la invocación murió) se
--    vuelve a tomar hasta 3 intentos: los correos llevan Idempotency-Key de Resend por destinatario y semana, así
--    que un reintento el mismo domingo no duplica.
--    week_start = domingo (hora de Chile) en que empieza la semana reportada; la semana va de ese domingo 00:00 al
--    domingo siguiente 00:00 (el día del envío). summary guarda las cifras y las sugerencias enviadas (soporte y
--    comparación con la semana anterior).
--
-- 2) aitickets_user_email_optouts: personas del equipo de una productora (public.users) que no quieren un correo
--    automático de AI Tickets. topic 'weekly_report' = reporte semanal. La escribe /api/reporte-semanal/baja
--    (enlace firmado del correo, one-click de List-Unsubscribe) y la borra el mismo endpoint al re-suscribirse.
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  recipients integer NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  events integer NOT NULL DEFAULT 0 CHECK (events >= 0),
  ai_provider text CHECK (ai_provider IS NULL OR char_length(ai_provider) <= 40),
  summary jsonb,
  error text CHECK (error IS NULL OR char_length(error) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS aitickets_weekly_reports_org_week_idx
  ON public.aitickets_weekly_reports (organization_id, week_start);
CREATE INDEX IF NOT EXISTS aitickets_weekly_reports_week_status_idx
  ON public.aitickets_weekly_reports (week_start, status);

ALTER TABLE public.aitickets_weekly_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_weekly_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_weekly_reports TO service_role;

COMMENT ON TABLE public.aitickets_weekly_reports IS
  'Reporte semanal a productores: una fila por organización y semana (reclamo atómico del envío). Solo service role.';

CREATE TABLE IF NOT EXISTS public.aitickets_user_email_optouts (
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic text NOT NULL CHECK (topic IN ('weekly_report')),
  source text NOT NULL DEFAULT 'unsubscribe_link' CHECK (source IN ('unsubscribe_link', 'one_click', 'dashboard')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic)
);

ALTER TABLE public.aitickets_user_email_optouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_user_email_optouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_user_email_optouts TO service_role;

COMMENT ON TABLE public.aitickets_user_email_optouts IS
  'Miembros de una productora que no quieren un correo automático (topic weekly_report = reporte semanal). Solo service role.';

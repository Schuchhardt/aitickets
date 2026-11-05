-- Latido de las funciones programadas: una fila por job, que cada ejecución actualiza aunque no haya tenido nada que
-- hacer. get_system_health se basa en esto en vez de inferir desde tablas de negocio (netlify/lib/job-heartbeat.mjs).
CREATE TABLE IF NOT EXISTS public.aitickets_job_heartbeats (
  job text PRIMARY KEY,
  last_run_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  items_processed integer,
  last_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitickets_job_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_job_heartbeats FROM PUBLIC, anon, authenticated;

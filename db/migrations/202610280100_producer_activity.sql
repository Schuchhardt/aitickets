-- Bitácora de uso del panel de productores (/dashboard). Idempotente.
--
-- Qué secciones abre cada miembro del equipo, cuánto tiempo activo pasa en cada una, dónde hace clic, qué acciones
-- intenta (llamadas a /api del panel), qué errores ve y dónde se traba (clics repetidos, formularios abandonados).
-- La escriben el layout del panel (page_view, en el servidor) y src/lib/producerActivityClient.js (el resto, por
-- POST /api/dashboard/journal). Se consulta solo desde el MCP de administración: get_producer_activity y
-- list_dashboard_issues (src/lib/admin-api/tools/dashboardActivity.ts). Detalle: docs/specs/bitacora-panel.md.
--
-- public.aitickets_producer_activity: una fila por hecho, solo se inserta (append-only).
--   occurred_at      cuándo pasó: hora del navegador corregida con el desfase de su reloj (page_view: hora del servidor)
--   organization_id  organización de la sesión (la del servidor, nunca la que diga el navegador)
--   user_id          miembro del equipo (users.id)
--   page_view_id     carga de página a la que pertenece (uuid que genera el layout al renderizar)
--   type             page_view | page_time | click | rage_click | dead_click | form_start | form_submit | navigation |
--                    api_call | api_error | js_error | ui_message | custom
--   path / route     ruta visitada (/dashboard/events/812) y su patrón (/dashboard/events/[id])
--   event_id         evento de la ruta (/dashboard/events/<id> o ?event=<id>), si aplica
--   label            texto corto: botón, mensaje de error, nombre del formulario (sin correos, RUT, teléfonos ni tokens)
--   target           dónde: sección de la página ("Tipos de entrada", "Menú lateral") o endpoint (POST /api/events/update)
--   status           código HTTP (api_call / api_error; 0 = sin conexión)
--   duration_ms      duración de la llamada (api_*) o tiempo activo acumulado en la página (page_time)
--   data             detalle acotado por tipo (≤ 4 KB). Nunca valores de campos de formularios.
--
-- Retención: 12 meses (docs/runbooks/retencion-de-registros.md). La función programada purge-producer-activity
-- llama a aitickets_purge_producer_activity a diario.
-- RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_producer_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  page_view_id uuid,
  type text NOT NULL CHECK (type IN (
    'page_view', 'page_time', 'click', 'rage_click', 'dead_click', 'form_start', 'form_submit', 'navigation',
    'api_call', 'api_error', 'js_error', 'ui_message', 'custom'
  )),
  path text CHECK (path IS NULL OR char_length(path) <= 300),
  route text CHECK (route IS NULL OR char_length(route) <= 200),
  event_id bigint,
  label text CHECK (label IS NULL OR char_length(label) <= 300),
  target text CHECK (target IS NULL OR char_length(target) <= 300),
  status integer CHECK (status IS NULL OR status BETWEEN 0 AND 999),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(data::text) <= 4096)
);

CREATE INDEX IF NOT EXISTS aitickets_producer_activity_org_idx ON public.aitickets_producer_activity (organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_producer_activity_occurred_idx ON public.aitickets_producer_activity (occurred_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_producer_activity_user_idx ON public.aitickets_producer_activity (user_id, occurred_at DESC);

COMMENT ON TABLE public.aitickets_producer_activity IS
  'Uso del panel de productores: páginas, tiempo activo, clics, acciones, errores y fricción. Sin valores de formularios. Retención 12 meses.';

ALTER TABLE public.aitickets_producer_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_producer_activity FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.aitickets_producer_activity TO service_role;
REVOKE ALL ON SEQUENCE public.aitickets_producer_activity_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_producer_activity_id_seq TO service_role;

-- Borra lo más antiguo que p_keep_days, de a p_batch filas por llamada (la función programada repite hasta vaciar).
CREATE OR REPLACE FUNCTION public.aitickets_purge_producer_activity(p_keep_days integer DEFAULT 365, p_batch integer DEFAULT 20000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 30 THEN
    RAISE EXCEPTION 'p_keep_days debe ser al menos 30';
  END IF;
  DELETE FROM public.aitickets_producer_activity
  WHERE id IN (
    SELECT id FROM public.aitickets_producer_activity
    WHERE occurred_at < now() - make_interval(days => p_keep_days)
    ORDER BY occurred_at
    LIMIT greatest(1, least(coalesce(p_batch, 20000), 100000))
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.aitickets_purge_producer_activity(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_purge_producer_activity(integer, integer) TO service_role;

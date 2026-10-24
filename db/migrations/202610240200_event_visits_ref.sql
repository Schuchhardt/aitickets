-- Analítica de visitas (src/lib/eventAnalytics.ts). Idempotente; solo agrega.
--
-- 1) event_visits.ref: el ?ref= de los links de seguimiento (create_tracking_link, TrackingLinkBuilder). Hasta ahora
--    solo llegaba a event_orders.ref (vía la atribución del checkout), así que no había visitas ni conversión por
--    ref. Nullable y sin default: agregarla es solo catálogo. El código tolera que no exista (deploy preview sin
--    migrar): lee las visitas sin ref y no muestra la conversión de los canales ref.
--    Sin índice nuevo: las consultas filtran por event_id (idx_event_visits_event_id) y agrupan en el servidor.
--
-- 2) aitickets_event_visit_counts(event_id): visitas y visitantes únicos (ip_hash distintos) sin traer las filas.
--    El resumen del evento en el panel traía todos los ip_hash sin paginar y se cortaba en 1000 filas.
--    Solo service_role. Si no existe, el código cuenta paginando.

ALTER TABLE public.event_visits ADD COLUMN IF NOT EXISTS ref text;

CREATE OR REPLACE FUNCTION public.aitickets_event_visit_counts(p_event_id bigint)
RETURNS TABLE (visits bigint, unique_visitors bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::bigint, count(DISTINCT v.ip_hash)::bigint
    FROM public.event_visits v
   WHERE v.event_id = p_event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.aitickets_event_visit_counts(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_event_visit_counts(bigint) TO service_role;

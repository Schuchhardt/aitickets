-- Visitas de bots y de desarrollo en la analítica (netlify/lib/visit-bots.mjs). Idempotente; solo agrega.
--
-- 1) event_visits.is_bot + bot_reason: la ingesta (recordEventVisit) ya no descarta los bots, los MARCA. La analítica
--    (visitas, conversión, fuentes, ubicaciones, hora pico, reportes, admin) filtra is_bot = false. Nada se borra.
--    NOT NULL DEFAULT false con un default constante es solo catálogo (sin reescribir la tabla). Las filas existentes
--    quedan en false: el marcado retroactivo es scripts/mark-bot-visits.mjs (dry run primero, luego --apply).
--    bot_reason: ua:<grupo>, geo:meta-datacenter o dev:<origen>.
--
-- 2) aitickets_event_visit_counts: cuenta solo personas y devuelve además bot_visits (cuántas se excluyeron). Cambia
--    las columnas de salida, así que se borra y se vuelve a crear (en la misma transacción de la migración).

ALTER TABLE public.event_visits ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;
ALTER TABLE public.event_visits ADD COLUMN IF NOT EXISTS bot_reason text;

DROP FUNCTION IF EXISTS public.aitickets_event_visit_counts(bigint);

CREATE FUNCTION public.aitickets_event_visit_counts(p_event_id bigint)
RETURNS TABLE (visits bigint, unique_visitors bigint, bot_visits bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FILTER (WHERE NOT v.is_bot)::bigint,
         count(DISTINCT v.ip_hash) FILTER (WHERE NOT v.is_bot)::bigint,
         count(*) FILTER (WHERE v.is_bot)::bigint
    FROM public.event_visits v
   WHERE v.event_id = p_event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.aitickets_event_visit_counts(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_event_visit_counts(bigint) TO service_role;

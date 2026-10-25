-- MCP de administración (src/lib/admin-api/tools/analytics.ts): visitas y visitantes únicos de un período, contados en
-- la base. Antes se traían todas las filas de event_visits del período (paginadas de a 1000), lo que no escala.
-- p_group: 'total' | 'event' | 'org' | 'day' | 'week' | 'month'. Días, semanas (desde el lunes) y meses en hora de
-- Chile, con las mismas claves que bucketOf() en TypeScript ('YYYY-MM-DD', lunes 'YYYY-MM-DD', 'YYYY-MM').
-- unique_visitors = ip_hash distintos DENTRO de cada grupo. Solo service_role.
CREATE OR REPLACE FUNCTION public.aitickets_admin_visit_counts(p_from timestamptz, p_to timestamptz, p_event_ids bigint[], p_group text DEFAULT 'total')
RETURNS TABLE (bucket text, visits bigint, unique_visitors bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_group
           WHEN 'event' THEN v.event_id::text
           WHEN 'org' THEN e.organization_id::text
           WHEN 'day' THEN to_char(v.created_at AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD')
           WHEN 'week' THEN to_char(date_trunc('week', v.created_at AT TIME ZONE 'America/Santiago'), 'YYYY-MM-DD')
           WHEN 'month' THEN to_char(v.created_at AT TIME ZONE 'America/Santiago', 'YYYY-MM')
           ELSE 'total'
         END AS bucket,
         count(*)::bigint AS visits,
         count(DISTINCT v.ip_hash)::bigint AS unique_visitors
    FROM public.event_visits v
    JOIN public.events e ON e.id = v.event_id
   WHERE v.created_at >= p_from
     AND v.created_at < p_to
     AND v.event_id = ANY (p_event_ids)
   GROUP BY 1;
$$;

REVOKE EXECUTE ON FUNCTION public.aitickets_admin_visit_counts(timestamptz, timestamptz, bigint[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_admin_visit_counts(timestamptz, timestamptz, bigint[], text) TO service_role;

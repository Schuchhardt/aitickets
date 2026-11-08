-- Catálogo normalizado de los objetos de AI Tickets en la base: una fila (key, value) por objeto.
-- Lo usa scripts/db-drift.mjs para comparar la base real con la que arman db/schema.sql + db/migrations (CI). Así
-- se detecta lo que existe solo en la base (creado a mano en el dashboard de Supabase) o lo que falta en ella.
--
-- El proyecto de Supabase es COMPARTIDO (Kefy y otras apps): solo entran
--   * tablas de AI Tickets: las de scripts/lint-migrations.mjs (AITICKETS_TABLES) y aitickets_*;
--   * funciones de public: aitickets_*, handle_new_user, las de triggers sobre esas tablas o sobre auth.users, y
--     cualquiera cuyo cuerpo nombre una tabla de AI Tickets (así aparecen las creadas a mano);
--   * triggers sobre esas tablas y los de auth.users que llaman a una función de public;
--   * buckets "Events" y aitickets-*.
-- Solo lectura. Sin parámetros: se puede pegar tal cual en el editor SQL.
WITH ait_tables AS (
  SELECT c.oid, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (c.relname LIKE 'aitickets\_%' OR c.relname IN (
      'attendees', 'category_tags', 'newsletter', 'organizations', 'venues', 'users',
      'events', 'event_tickets', 'event_locations', 'event_orders', 'event_faqs',
      'event_tags', 'event_withdrawals', 'questions', 'event_dates', 'event_visits',
      'event_attendees', 'social_accounts', 'social_posts', 'ad_account_connections',
      'ad_campaigns', 'notification_log', 'organization_payout_accounts'))
),
ait_triggers AS (
  SELECT t.oid, t.tgname, t.tgfoid, c.relname, n.nspname
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
  WHERE NOT t.tgisinternal
    AND (t.tgrelid IN (SELECT oid FROM ait_tables) OR (n.nspname = 'auth' AND c.relname = 'users' AND pn.nspname = 'public'))
),
ait_functions AS (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    AND (p.proname LIKE 'aitickets\_%' OR p.proname = 'handle_new_user'
      OR p.oid IN (SELECT tgfoid FROM ait_triggers)
      OR EXISTS (
        SELECT 1 FROM ait_tables t
        WHERE p.prosrc ~* ('(from|into|update|join|table)\s+(public\.)?' || t.relname || '\M')))
)
SELECT key, value FROM (
  SELECT 'table:' || t.relname AS key,
         'rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity AS value
  FROM ait_tables t JOIN pg_class c ON c.oid = t.oid
  UNION ALL
  SELECT 'column:' || t.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod) || ' notnull=' || a.attnotnull
           || ' default=' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '-')
           || CASE WHEN a.attidentity <> '' THEN ' identity=' || a.attidentity::text ELSE '' END
  FROM ait_tables t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  UNION ALL
  SELECT 'constraint:' || t.relname || '.' || co.conname, pg_get_constraintdef(co.oid)
  FROM ait_tables t JOIN pg_constraint co ON co.conrelid = t.oid
  UNION ALL
  SELECT 'index:' || t.relname || '.' || ic.relname, replace(pg_get_indexdef(i.indexrelid), 'public.', '')
  FROM ait_tables t JOIN pg_index i ON i.indrelid = t.oid JOIN pg_class ic ON ic.oid = i.indexrelid
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conindid = i.indexrelid)
  UNION ALL
  SELECT 'policy:' || p.tablename || '.' || p.policyname,
         p.cmd || ' roles=' || p.roles::text || ' using=' || coalesce(p.qual, '-') || ' check=' || coalesce(p.with_check, '-')
  FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename IN (SELECT relname FROM ait_tables)
  UNION ALL
  SELECT 'grant:' || t.relname,
         coalesce((SELECT string_agg(r.rolname || '=' || x.privilege_type, ',' ORDER BY r.rolname, x.privilege_type)
                   FROM aclexplode(c.relacl) x JOIN pg_roles r ON r.oid = x.grantee
                   WHERE r.rolname IN ('anon', 'authenticated')), '-')
  FROM ait_tables t JOIN pg_class c ON c.oid = t.oid
  UNION ALL
  SELECT 'trigger:' || tr.nspname || '.' || tr.relname || '.' || tr.tgname,
         replace(pg_get_triggerdef(tr.oid), 'public.', '')
  FROM ait_triggers tr
  UNION ALL
  SELECT 'function:' || f.proname || '(' || f.args || ')',
         'md5=' || md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) || ' lang=' || l.lanname || ' secdef=' || p.prosecdef
           || ' returns=' || pg_get_function_result(p.oid) || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '-')
  FROM ait_functions f JOIN pg_proc p ON p.oid = f.oid JOIN pg_language l ON l.oid = p.prolang
  UNION ALL
  SELECT 'function_grant:' || f.proname || '(' || f.args || ')',
         coalesce((SELECT string_agg(DISTINCT r.rolname, ',' ORDER BY r.rolname)
                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x JOIN pg_roles r ON r.oid = x.grantee
                   WHERE x.privilege_type = 'EXECUTE' AND r.rolname IN ('anon', 'authenticated', 'service_role')), '-')
           || CASE WHEN EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                WHERE x.privilege_type = 'EXECUTE' AND x.grantee = 0) THEN ',PUBLIC' ELSE '' END
  FROM ait_functions f JOIN pg_proc p ON p.oid = f.oid
  UNION ALL
  SELECT 'bucket:' || b.id, 'public=' || b.public || ' limit=' || coalesce(b.file_size_limit::text, '-')
           || ' mimes=' || coalesce(array_to_string(b.allowed_mime_types, ','), '-')
  FROM storage.buckets b WHERE b.id = 'Events' OR b.id LIKE 'aitickets-%'
) catalog
ORDER BY key

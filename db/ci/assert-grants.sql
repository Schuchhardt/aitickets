-- Aserción de permisos para la CI, después de aplicar todas las migraciones sobre
-- db/ci/stubs.sql + db/schema.sql. Falla (RAISE EXCEPTION) si:
--   * anon o authenticated tienen algún privilegio sobre una tabla/vista de public,
--   * anon o authenticated pueden ejecutar alguna función de public (directo o vía PUBLIC),
--   * una tabla de public no tiene RLS activado.
-- Regla del plan: todo el acceso es server-side con service_role; las tablas/funciones nuevas deben
-- hacer REVOKE explícito a anon, authenticated (no basta con PUBLIC, porque Supabase otorga
-- default privileges directos a esos roles).
\set ON_ERROR_STOP on

DO $$
DECLARE
  problems text[] := ARRAY[]::text[];
  r record;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, role.rolname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role(rolname)
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    IF has_table_privilege(r.rolname, r.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
      problems := problems || format('tabla public.%s: %s tiene privilegios', r.relname, r.rolname);
    END IF;
  END LOOP;

  -- Secuencias de objetos nuevos (aitickets_*, p. ej. las implícitas de un bigserial): Supabase otorga
  -- ALL sobre secuencias nuevas a anon/authenticated por default privileges. Las secuencias de las tablas
  -- heredadas de db/schema.sql quedan fuera (anteriores a esta regla).
  FOR r IN
    SELECT c.oid, c.relname, role.rolname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role(rolname)
     WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname LIKE 'aitickets\_%'
  LOOP
    IF has_sequence_privilege(r.rolname, r.oid, 'USAGE, SELECT, UPDATE') THEN
      problems := problems || format('secuencia public.%s: %s tiene privilegios', r.relname, r.rolname);
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    problems := problems || format('tabla public.%s: RLS desactivado', r.relname);
  END LOOP;

  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS sig, role.rolname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role(rolname)
     WHERE n.nspname = 'public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    IF has_function_privilege(r.rolname, r.oid, 'EXECUTE') THEN
      problems := problems || format('función %s: %s puede ejecutarla', r.sig, r.rolname);
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND NOT EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg WHERE cfg LIKE 'search_path=%'
       )
  LOOP
    problems := problems || format('función %s: SECURITY DEFINER sin SET search_path', r.sig);
  END LOOP;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION E'Aserción de permisos falló (% problema(s)):\n  %',
      array_length(problems, 1), array_to_string(problems, E'\n  ');
  END IF;
  RAISE NOTICE 'Permisos OK: anon/authenticated sin acceso a tablas ni funciones de public; RLS activo.';
END $$;

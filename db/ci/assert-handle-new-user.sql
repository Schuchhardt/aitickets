-- CI: comportamiento de public.handle_new_user() (trigger on_auth_user_created sobre auth.users, compartido con
-- Kefy) y de las altas que completan su fila. Corre sobre la BD desechable de la CI después de las migraciones;
-- NUNCA contra Supabase. Todo dentro de una transacción con ROLLBACK.
--
-- En Supabase el trigger ya existe (heredado); en la CI se crea aquí para probar la función de las migraciones.
\set ON_ERROR_STOP on
BEGIN;

-- La CI crea la organización 1 con OVERRIDING SYSTEM VALUE: la identidad sigue en 1 y el INSERT del trigger chocaría
SELECT setval(pg_get_serial_sequence('public.organizations', 'id'), (SELECT max(id) FROM public.organizations));

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $$
DECLARE
  u record;
  org_count_before bigint;
  orphan_auth uuid := gen_random_uuid();
  member_auth uuid := gen_random_uuid();
  failed boolean;
BEGIN
  -- 1. Registro antiguo con organization_name: crea la organización y quien la crea queda como 'producer'
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (gen_random_uuid(), 'signup@ci.test', '{"organization_name": "Productora CI", "full_name": "Ana CI"}');
  SELECT us.*, o.public_name AS org_name INTO u
  FROM public.users us JOIN public.organizations o ON o.id = us.organization_id
  WHERE us.email = 'signup@ci.test';
  IF u IS NULL OR u.role IS DISTINCT FROM 'producer' OR u.org_name <> 'Productora CI' OR u.name <> 'Ana CI' THEN
    RAISE EXCEPTION 'organization_name: se esperaba la organización con el usuario como producer, quedó %', row_to_json(u);
  END IF;

  -- 2. Sin organización (registro actual, Google, agregar miembro, otras apps): fila sin organización y SIN rol
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (orphan_auth, 'nuevo@ci.test', '{"full_name": "Nuevo"}');
  SELECT * INTO u FROM public.users WHERE auth_user_id = orphan_auth;
  IF u IS NULL OR u.organization_id IS NOT NULL OR u.role IS NOT NULL OR u.name <> 'Nuevo' THEN
    RAISE EXCEPTION 'sin organization_name: se esperaba role NULL y sin organización, quedó %', row_to_json(u);
  END IF;

  -- 3. La organización/rol de la metadata del usuario nunca se usan (el registro público la controla el usuario)
  SELECT count(*) INTO org_count_before FROM public.organizations;
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (gen_random_uuid(), 'intruso@ci.test', '{"organization_id": 1, "role": "admin"}');
  SELECT * INTO u FROM public.users WHERE email = 'intruso@ci.test';
  IF u.organization_id IS NOT NULL OR u.role IS NOT NULL OR (SELECT count(*) FROM public.organizations) <> org_count_before THEN
    RAISE EXCEPTION 'la metadata organization_id/role no debe asignar organización ni rol: %', row_to_json(u);
  END IF;

  -- 4. Correo que ya está en public.users: el trigger no inserta ni aborta el alta en Auth
  INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'NUEVO@ci.test');
  IF (SELECT count(*) FROM public.users WHERE lower(email) = 'nuevo@ci.test') <> 1 THEN
    RAISE EXCEPTION 'correo repetido: no debió crear otra fila';
  END IF;

  -- 5. Un error dentro del trigger nunca aborta el alta en Auth (lo que protege a Kefy y a cualquier otra app)
  ALTER TABLE public.users ADD CONSTRAINT ci_tmp_name_check CHECK (name IS DISTINCT FROM 'romper');
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (gen_random_uuid(), 'romper@ci.test', '{"full_name": "romper"}');
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'romper@ci.test') OR EXISTS (SELECT 1 FROM public.users WHERE email = 'romper@ci.test') THEN
    RAISE EXCEPTION 'un error del trigger debe quedar como WARNING sin abortar el alta';
  END IF;
  ALTER TABLE public.users DROP CONSTRAINT ci_tmp_name_check;

  -- 6. Alta de un miembro (src/lib/team-add.ts): createUser + UPDATE de la fila del trigger, sin INSERT
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (member_auth, 'puerta@ci.test', '{"full_name": "Puerta"}');
  failed := false;
  BEGIN
    -- Lo que hacía el código anterior: INSERT propio => choca con users_email_key (el "ya está registrado" de 07-11)
    INSERT INTO public.users (name, email, role, organization_id, auth_user_id, active) VALUES ('Puerta', 'puerta@ci.test', 'validator', 1, member_auth, true);
  EXCEPTION WHEN unique_violation THEN
    failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'se esperaba unique_violation al insertar sobre la fila del trigger'; END IF;
  UPDATE public.users SET organization_id = 1, role = 'validator', active = true WHERE auth_user_id = member_auth AND organization_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'el UPDATE por auth_user_id debió encontrar la fila del trigger'; END IF;

  -- 7. Reversión: con la fila presente no se puede borrar la cuenta de Auth (FK sin ON DELETE); borrándola antes, sí
  failed := false;
  BEGIN
    DELETE FROM auth.users WHERE id = orphan_auth;
  EXCEPTION WHEN foreign_key_violation THEN
    failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'se esperaba foreign_key_violation al borrar la cuenta con la fila presente'; END IF;
  DELETE FROM public.users WHERE auth_user_id = orphan_auth;
  DELETE FROM auth.users WHERE id = orphan_auth;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = orphan_auth) THEN RAISE EXCEPTION 'la cuenta debió borrarse'; END IF;
END $$;

ROLLBACK;
\echo 'handle_new_user OK'

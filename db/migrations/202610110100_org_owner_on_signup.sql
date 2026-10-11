-- Dueño de la organización ('producer').
--
-- handle_new_user() (alta con correo) creaba la organización pero dejaba a quien la creó como 'admin': ninguna
-- organización tenía dueño, y las acciones solo del dueño (retiros, reembolsos, cuenta bancaria, cancelar un
-- evento, asignar el rol Finanzas) no las podía hacer nadie. El alta con Google (src/lib/google-auth.ts) ya
-- usaba 'producer'.
--
-- 1. handle_new_user(): quien crea la organización queda como 'producer' (sin organización sigue 'admin').
-- 2. Organizaciones sin dueño: pasa a 'producer' el admin activo cuyo correo es el de la organización (quien la
--    creó: el alta copia su correo a organizations.email) o, si no hay, el único admin activo. Las que tienen
--    varios admins y ninguno con ese correo quedan igual (se asignan a mano).
-- Idempotente: solo toca organizaciones que no tienen 'producer'.

CREATE OR REPLACE FUNCTION public.handle_new_user() -- lint:allow función existente del trigger on_auth_user_created (escribe solo tablas de AI Tickets)
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  org_id bigint;
BEGIN
  BEGIN
    IF NEW.email IS NOT NULL AND EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = lower(NEW.email)) THEN
      RETURN NEW;
    END IF;

    IF NEW.raw_user_meta_data->>'organization_name' IS NOT NULL THEN
      INSERT INTO public.organizations (public_name, email)
      VALUES (NEW.raw_user_meta_data->>'organization_name', NEW.email)
      RETURNING id INTO org_id;
    END IF;

    INSERT INTO public.users (auth_user_id, email, name, organization_id, role)
    VALUES (
      NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'), org_id,
      CASE WHEN org_id IS NOT NULL THEN 'producer' ELSE 'admin' END
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'handle_new_user: no se creó public.users para % (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

WITH orgs_without_owner AS (
  SELECT o.id, lower(coalesce(o.email, '')) AS email
  FROM public.organizations o
  WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.organization_id = o.id AND u.role = 'producer')
),
admins AS (
  SELECT u.id, u.organization_id, lower(coalesce(u.email, '')) AS email,
         count(*) OVER (PARTITION BY u.organization_id) AS admin_count
  FROM public.users u
  JOIN orgs_without_owner w ON w.id = u.organization_id
  WHERE u.role = 'admin' AND coalesce(u.active, true)
),
chosen AS (
  SELECT DISTINCT ON (a.organization_id) a.id
  FROM admins a
  JOIN orgs_without_owner w ON w.id = a.organization_id
  WHERE (w.email <> '' AND a.email = w.email) OR a.admin_count = 1
  ORDER BY a.organization_id, (w.email <> '' AND a.email = w.email) DESC, a.id
)
UPDATE public.users u SET role = 'producer' FROM chosen c WHERE u.id = c.id;

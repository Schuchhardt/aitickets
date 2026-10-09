-- public.handle_new_user() (trigger on_auth_user_created sobre auth.users, heredado: no estaba en el repo)
-- inserta una fila en public.users por CADA usuario nuevo de Auth. public.users.email es UNIQUE: si el correo
-- ya existía (otra cuenta, registro previo), el INSERT fallaba y Supabase Auth abortaba el alta con
-- "Database error saving new user" (p. ej. "Continuar con Google"). Idempotente.
--
-- Ahora: no inserta si el correo ya está en public.users (la app decide qué hacer: google-auth.ts responde
-- email_in_use) y cualquier error queda como WARNING sin abortar el alta en Auth. Mismo comportamiento en
-- el caso normal (fila con role 'admin' y organización opcional desde organization_name).
-- No se toca el trigger (el CREATE OR REPLACE mantiene el vínculo), solo la función.

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
    VALUES (NEW.id, NEW.email, coalesce(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'), org_id, 'admin');
  EXCEPTION WHEN others THEN
    RAISE WARNING 'handle_new_user: no se creó public.users para % (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

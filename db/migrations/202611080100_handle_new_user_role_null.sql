-- handle_new_user(): un usuario de Auth SIN organización queda con role NULL (antes 'admin').
--
-- El trigger on_auth_user_created corre por CADA alta en auth.users, que comparten AI Tickets y Kefy. Sin
-- organization_name en la metadata (el caso de todas las altas actuales: registro, Google, agregar miembro,
-- invitaciones y cuentas de otras apps) dejaba la fila con role 'admin': un rol de administración para alguien que
-- todavía no administra nada. Si después un camino completaba solo organization_id sin poner el rol, la persona
-- terminaba como 'admin' de una organización (y la organización sin dueño 'producer'), que es lo que pasó con las
-- organizaciones creadas desde el registro y desde Google.
--
-- Con NULL, una fila que nadie completa no tiene ningún permiso (hasRole, API_ROLES y los guards fallan cerrado con
-- NULL; además la sesión del panel exige organization_id). Ningún código depende de 'admin' en filas sin
-- organización: cada camino que asigna una organización pone el rol explícito (src/pages/api/auth/register.ts,
-- src/lib/google-auth.ts, src/lib/team-add.ts, src/lib/team-accept.ts).
--
-- Sin cambios:
--   * Con organization_name (registro antiguo): crea la organización y deja a quien la crea como 'producer'.
--   * El EXCEPTION WHEN others: un error aquí nunca aborta el alta en Auth (tampoco las de Kefy).
--   * Si el correo ya está en public.users no inserta nada.
--   * El trigger (CREATE OR REPLACE mantiene el vínculo) y el DEFAULT 'admin' de la columna users.role.
-- No toca filas existentes.
-- La organización y el rol de un MIEMBRO del equipo nunca se leen de la metadata: la escribe el usuario en el
-- registro público y cualquiera podría meterse a una organización ajena.

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
      CASE WHEN org_id IS NOT NULL THEN 'producer' ELSE NULL END
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'handle_new_user: no se creó public.users para % (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

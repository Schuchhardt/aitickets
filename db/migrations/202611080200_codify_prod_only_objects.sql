-- Pasa a código los objetos de AI Tickets que existían SOLO en la base de producción (creados a mano en el dashboard
-- de Supabase) y quita los que quedaron muertos. Lo encontró scripts/db-drift.mjs comparando producción con la base
-- que arman db/schema.sql + db/migrations. En producción todo esto es un no-op (los objetos ya existen o ya no
-- existen); en la CI y en el stack local de e2e crea lo mismo que hay en producción, así que se puede testear.
--
-- 1. Trigger on_auth_user_created (auth.users → public.handle_new_user). Crea la fila de public.users de cada alta en
--    Auth. Nunca estuvo en el repo: la CI tenía que crearlo a mano (db/ci/assert-handle-new-user.sql) y el bug de
--    "agregar miembro" (orgs 45-49) nació de no verlo. Solo se crea si no existe: el proyecto es compartido con Kefy y
--    no se reemplaza un trigger de auth.users en uso.
-- 2. Bucket público "Events" (imágenes de eventos, src/lib/imageStorage.ts). Solo si no existe.
-- 3. Funciones muertas create_courtesy_ticket() y update_ticket_end_date(): eran de los triggers hechos a mano que
--    quitaron 202611020200 y 202611020300 (que dejaron la función por precaución). Se verificó que solo tocan
--    event_tickets (tabla de AI Tickets) y que ningún trigger las usa: se borran solo si sigue siendo así.
-- 4. CHECK duplicado events_secret_location_reveal_hours_check: lo crea 202610300310 en una base nueva junto a
--    events_secret_location_reveal_hours_range (el que existe en producción). Mismo predicado: se deja solo _range.
-- Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND tgrelid = 'auth.users'::regclass -- lint:allow solo lee el catálogo
  ) THEN
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users -- lint:allow trigger de AI Tickets sobre auth.users, solo si no existe
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR insufficient_privilege THEN
    RAISE NOTICE 'No se pudo crear on_auth_user_created (%): revisa ese trigger a mano', SQLERRM;
END
$$;

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public) -- lint:allow bucket de AI Tickets (Events), solo si no existe
  VALUES ('Events', 'Events', true)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_column OR insufficient_privilege THEN
    RAISE NOTICE 'No se pudo crear el bucket Events (%)', SQLERRM;
END
$$;

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['create_courtesy_ticket', 'update_ticket_end_date'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || fn || '()'))
       AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = to_regprocedure('public.' || fn || '()')) THEN
      EXECUTE format('DROP FUNCTION public.%I()', fn); -- lint:allow funciones muertas de AI Tickets (solo event_tickets, sin trigger)
      RAISE NOTICE 'Función muerta public.%() borrada', fn;
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.events'::regclass AND conname = 'events_secret_location_reveal_hours_check')
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.events'::regclass AND conname = 'events_secret_location_reveal_hours_range') THEN
    ALTER TABLE public.events DROP CONSTRAINT events_secret_location_reveal_hours_check;
  END IF;
END
$$;

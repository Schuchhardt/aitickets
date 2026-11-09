-- CI: comportamiento de cada trigger de AI Tickets y de las reglas de borrado/unicidad de las tablas base. Corre sobre la
-- base desechable de la CI (scripts/db-ci-setup.sh) después de las migraciones; NUNCA contra Supabase. Todo dentro de
-- una transacción con ROLLBACK.
--
-- tests/unit/db-catalog.test.mjs exige que cada trigger de db/catalog.snapshot.tsv aparezca en algún db/ci/assert-*.sql:
-- un trigger nuevo sin prueba hace fallar la CI. (on_auth_user_created se prueba en assert-handle-new-user.sql.)
\set ON_ERROR_STOP on
BEGIN;

SELECT setval(pg_get_serial_sequence('public.organizations', 'id'), (SELECT max(id) FROM public.organizations));

DO $$
DECLARE
  org bigint;
  ev bigint;
  usr bigint;
  att bigint;
  venue uuid;
  loc uuid;
  dt bigint;
  payout uuid;
  wd bigint;
  r record;
  failed boolean;
BEGIN
  INSERT INTO public.organizations (public_name) VALUES ('Org triggers CI') RETURNING id INTO org;
  INSERT INTO public.users (email, name, organization_id, role) VALUES ('owner@ci.test', 'Owner', org, 'producer') RETURNING id INTO usr;
  INSERT INTO public.events (name, organization_id, slug) VALUES ('Evento CI', org, 'evento-ci-triggers') RETURNING id INTO ev;

  -- aitickets_attendees_normalize_names: nombres con mayúscula inicial; partículas en minúscula en el apellido
  INSERT INTO public.attendees (first_name, last_name, email) VALUES ('  jUAN   pablo ', 'DE LA fuente', 'jp@ci.test') RETURNING id INTO att;
  SELECT first_name, last_name INTO r FROM public.attendees WHERE id = att;
  IF r.first_name <> 'Juan Pablo' OR r.last_name <> 'de la Fuente' THEN
    RAISE EXCEPTION 'aitickets_attendees_normalize_names: quedó "%" "%"', r.first_name, r.last_name;
  END IF;
  UPDATE public.attendees SET last_name = 'GONZÁLEZ y PÉREZ' WHERE id = att;
  IF (SELECT last_name FROM public.attendees WHERE id = att) <> 'González y Pérez' THEN
    RAISE EXCEPTION 'aitickets_attendees_normalize_names (UPDATE): quedó "%"', (SELECT last_name FROM public.attendees WHERE id = att);
  END IF;

  -- aitickets_event_orders_normalize_names
  INSERT INTO public.event_orders (event_id, attendee_id, amount, buyer_first_name, buyer_last_name)
  VALUES (ev, att, 1000, 'mARÍA josé', 'del RÍO') RETURNING buyer_first_name, buyer_last_name INTO r;
  IF r.buyer_first_name <> 'María José' OR r.buyer_last_name <> 'del Río' THEN
    RAISE EXCEPTION 'aitickets_event_orders_normalize_names: quedó "%" "%"', r.buyer_first_name, r.buyer_last_name;
  END IF;

  -- aitickets_guests_normalize_name (un nombre que queda vacío al normalizar se conserva tal cual)
  INSERT INTO public.aitickets_guests (organization_id, event_id, name) VALUES (org, ev, 'pEDRO  soto') RETURNING name INTO r;
  IF r.name <> 'Pedro Soto' THEN RAISE EXCEPTION 'aitickets_guests_normalize_name: quedó "%"', r.name; END IF;

  -- aitickets_payout_account_changed: cambiar datos bancarios anula la verificación; otros campos no
  INSERT INTO public.organization_payout_accounts (organization_id, bank_name, bank_account_number, bank_account_holder, bank_account_rut)
  VALUES (org, 'Banco CI', '000123456789', 'Owner', '11.111.111-1');
  IF (SELECT bank_changed_at FROM public.organization_payout_accounts WHERE organization_id = org) IS NULL THEN
    RAISE EXCEPTION 'aitickets_payout_account_changed: el INSERT no marcó bank_changed_at';
  END IF;
  UPDATE public.organization_payout_accounts SET verified_at = now(), verified_by = 'ci' WHERE organization_id = org;
  IF (SELECT verified_at FROM public.organization_payout_accounts WHERE organization_id = org) IS NULL THEN
    RAISE EXCEPTION 'aitickets_payout_account_changed: verificar (sin tocar datos bancarios) no debe anular la verificación';
  END IF;
  UPDATE public.organization_payout_accounts SET bank_account_number = '999999999' WHERE organization_id = org;
  IF (SELECT verified_at FROM public.organization_payout_accounts WHERE organization_id = org) IS NOT NULL THEN
    RAISE EXCEPTION 'aitickets_payout_account_changed: cambiar la cuenta debe anular la verificación';
  END IF;

  -- aitickets_payout_touch + aitickets_payout_sync_withdrawals: pagar marca paid_at y enmascara los retiros asociados
  INSERT INTO public.aitickets_payouts (organization_id, amount) VALUES (org, 50000) RETURNING id INTO payout;
  INSERT INTO public.event_withdrawals (event_id, user_id, amount, account_number, bank_name, account_holder_name, account_holder_rut, payout_id)
  VALUES (ev, usr, 50000, '000123456789', 'Banco CI', 'Owner Persona', '11.111.111-1', payout) RETURNING id INTO wd;
  UPDATE public.aitickets_payouts SET status = 'paid' WHERE id = payout;
  SELECT status, paid_at, updated_at INTO r FROM public.aitickets_payouts WHERE id = payout;
  IF r.paid_at IS NULL THEN RAISE EXCEPTION 'aitickets_payout_touch: un retiro pagado debe tener paid_at'; END IF;
  SELECT status, paid_at, account_number, account_holder_rut INTO r FROM public.event_withdrawals WHERE id = wd;
  IF r.status <> 'paid' OR r.paid_at IS NULL THEN
    RAISE EXCEPTION 'aitickets_payout_sync_withdrawals: el retiro quedó %', row_to_json(r);
  END IF;
  IF r.account_number = '000123456789' OR r.account_number NOT LIKE '%6789' OR r.account_holder_rut = '11.111.111-1' THEN
    RAISE EXCEPTION 'aitickets_payout_sync_withdrawals: al terminar debe enmascarar los datos bancarios: %', row_to_json(r);
  END IF;

  -- Borrar un evento borra en cascada sus funciones, entradas, FAQ, tags y ubicaciones (como en producción)
  INSERT INTO public.venues (name, organization_id) VALUES ('Teatro CI', org) RETURNING id INTO venue;
  INSERT INTO public.event_locations (event_id, venue_id) VALUES (ev, venue) RETURNING id INTO loc;
  INSERT INTO public.event_dates (event_id, date, start_time, event_location_id) VALUES (ev, '2030-01-01', '20:00', loc) RETURNING id INTO dt;
  INSERT INTO public.event_tickets (event_id, ticket_name, price, event_date_id) VALUES (ev, 'General', 1000, dt);
  INSERT INTO public.event_faqs (event_id, question, answer) VALUES (ev, '¿Hora?', '20:00');

  -- Una ubicación con funciones no se puede borrar (RESTRICT); un venue con ubicaciones tampoco
  failed := false;
  BEGIN
    DELETE FROM public.event_locations WHERE id = loc;
  EXCEPTION WHEN foreign_key_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'event_dates_event_location_id_fkey: se esperaba RESTRICT'; END IF;
  failed := false;
  BEGIN
    DELETE FROM public.venues WHERE id = venue;
  EXCEPTION WHEN foreign_key_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'event_locations_venue_id_fkey: se esperaba RESTRICT'; END IF;

  -- Una ubicación por evento + venue (+ nombre); un venue por slug (sale del nombre)
  failed := false;
  BEGIN
    INSERT INTO public.event_locations (event_id, venue_id) VALUES (ev, venue);
  EXCEPTION WHEN unique_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'event_locations_unique_unnamed: se esperaba unique_violation'; END IF;
  failed := false;
  BEGIN
    INSERT INTO public.venues (name, organization_id) VALUES ('TEATRO ci', org);
  EXCEPTION WHEN unique_violation THEN failed := true;
  END;
  IF NOT failed THEN RAISE EXCEPTION 'venues_slug_key: se esperaba unique_violation para otro venue con el mismo slug'; END IF;

  DELETE FROM public.event_withdrawals WHERE event_id = ev;
  DELETE FROM public.event_orders WHERE event_id = ev;
  DELETE FROM public.aitickets_guests WHERE event_id = ev;
  DELETE FROM public.events WHERE id = ev;
  IF EXISTS (SELECT 1 FROM public.event_dates WHERE event_id = ev)
     OR EXISTS (SELECT 1 FROM public.event_tickets WHERE event_id = ev)
     OR EXISTS (SELECT 1 FROM public.event_faqs WHERE event_id = ev)
     OR EXISTS (SELECT 1 FROM public.event_locations WHERE event_id = ev) THEN
    RAISE EXCEPTION 'Borrar un evento debe borrar en cascada funciones, entradas, FAQ y ubicaciones';
  END IF;
END $$;

ROLLBACK;
\echo 'triggers OK'

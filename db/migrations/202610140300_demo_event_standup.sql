-- Siembra idempotente del evento demo original 'evento-demo-aitickets' (Noche de Stand-up). Idempotente.
--
-- Este demo se creó a mano en producción antes de que existieran las migraciones, así que en una base nueva
-- (CI, local) no existía. Los datos son los de producción (evento 127): recinto, una función (fecha dinámica:
-- último día del mes, src/lib/demoEvent.mjs), entradas General y Preferencial, FAQs y categoría.
-- En producción no hace nada (el slug ya existe). Solo se siembra si existe la organización 1.

DO $$
DECLARE
  v_event_id bigint;
  v_venue_id uuid;
  v_location_id uuid;
  v_tag_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 1) THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE slug = 'evento-demo-aitickets') THEN
    RETURN;
  END IF;

  INSERT INTO public.venues (name, address_line1, city, state_province, country_code, latitude, longitude, timezone, capacity, notes, organization_id)
  VALUES ('Sala de ejemplo AI Tickets', 'Av. Providencia 1234', 'Providencia', 'Región Metropolitana', 'CL', -33.4263, -70.6170,
          'America/Santiago', 150, 'Recinto ficticio del evento de demostración (evento-demo-aitickets)', 1)
  RETURNING id INTO v_venue_id;

  INSERT INTO public.events (name, title, slug, description, image_url, location, capacity, status, accessibility, organization_id)
  VALUES (
    'Noche de Stand-up (evento de demostración)',
    'Noche de Stand-up (evento de demostración)',
    'evento-demo-aitickets',
    '<p><strong>Este es un evento de demostración de AI Tickets.</strong> Sirve para que veas cómo se ve la página de tu evento y cómo compran tus asistentes: elegir entradas, ingresar sus datos y revisar el resumen con el cargo por servicio. Al final no se crea ninguna orden ni se cobra nada.</p>'
      || '<p>Imagina una noche de stand-up con tres comediantes en una sala íntima de Providencia: entradas generales y preferenciales, una función a fin de mes y un asistente con IA que responde las dudas de tu público.</p>'
      || '<p>¿Organizas eventos? Crea el tuyo gratis en aitickets.cl/organizadores.</p>',
    'https://bgsmqjrdryafvlyxywud.supabase.co/storage/v1/object/public/Events/demo/evento-demo-aitickets.jpg',
    'Sala de ejemplo AI Tickets, Av. Providencia 1234, Providencia',
    150, 'published', 'private', 1
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.event_locations (event_id, venue_id, name)
  VALUES (v_event_id, v_venue_id, 'Main')
  RETURNING id INTO v_location_id;

  -- La fecha real la calcula src/lib/demoEvent.mjs (último día del mes); esta solo deja la función con horario
  INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
  VALUES (v_event_id, DATE '2026-09-30', TIME '20:30', TIME '22:30', v_location_id);

  INSERT INTO public.event_tickets (event_id, ticket_name, price, max_quantity, is_gift, status, total_quantity)
  VALUES
    (v_event_id, 'General', 8000, 10, false, 'available', NULL),
    (v_event_id, 'Preferencial (primeras filas)', 12000, 6, false, 'available', 18);

  INSERT INTO public.event_faqs (event_id, question, answer)
  VALUES
    (v_event_id, '¿Es un evento real?', 'No. Es un evento de demostración de AI Tickets: puedes recorrer el flujo de compra, pero no se venden entradas ni se cobra nada.'),
    (v_event_id, '¿Desde qué edad se puede entrar?', 'En este ejemplo, desde los 18 años. Cada productor define sus propias condiciones.'),
    (v_event_id, '¿Cómo recibo mis entradas?', 'En un evento real, llegan por email con un código QR apenas se confirma el pago, y el equipo del productor las escanea en la puerta desde el celular.');

  INSERT INTO public.category_tags (name) VALUES ('Evento cultural') ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_tag_id FROM public.category_tags WHERE name = 'Evento cultural';
  IF v_tag_id IS NOT NULL THEN
    INSERT INTO public.event_tags (event_id, tag_id) VALUES (v_event_id, v_tag_id);
  END IF;
END $$;

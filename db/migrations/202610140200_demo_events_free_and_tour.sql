-- Dos eventos de demostración más para mostrar los estados del rediseño de la página del evento. Idempotente.
--
--  'evento-demo-gratis' : evento GRATIS (registro inline en la card, "+ Llevo acompañantes": hasta 4 por persona).
--  'evento-demo-gira'   : GIRA con 5 funciones en 3 ciudades/recintos (Providencia, Ñuñoa, Viña del Mar) y entradas
--                         amarradas a cada función: el checkout pide Lugar → Fecha y hora → Entradas. Una función está
--                         agotada (total_quantity 0) y otra tiene "Últimas" (8 entradas en total).
--
-- Igual que los demos de 202610090100: organización 1 (AI Tickets), privados (fuera del sitemap) pero listados en
-- /eventos, fechas dinámicas (src/lib/demoEvent.mjs; la gira mantiene la separación entre funciones con su ancla
-- 2026-10-23) y la compra se rechaza en el servidor. Solo se siembran si existe la organización 1 y no existe el slug.
-- Portadas propias en el bucket público Events/demo/ (evento-demo-gratis.jpg y evento-demo-gira.jpg, 1200×1500).

DO $$
DECLARE
  v_event_id bigint;
  v_venue_id uuid;
  v_location_id uuid;
  v_loc_prov uuid;
  v_loc_nunoa uuid;
  v_loc_vina uuid;
  v_fn1 bigint;
  v_fn2 bigint;
  v_fn3 bigint;
  v_fn4 bigint;
  v_fn5 bigint;
  v_tag_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = 1) THEN
    RETURN;
  END IF;

  -- Gratis: mercado de emprendedores con entrada liberada (todos los jueves)
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE slug = 'evento-demo-gratis') THEN
    INSERT INTO public.venues (name, address_line1, city, state_province, country_code, latitude, longitude, timezone, capacity, notes, organization_id)
    VALUES ('Galpón de ejemplo AI Tickets', 'Av. Italia 1450', 'Providencia', 'Región Metropolitana', 'CL', -33.4465, -70.6215,
            'America/Santiago', 60, 'Recinto ficticio del evento de demostración (evento-demo-gratis)', 1)
    RETURNING id INTO v_venue_id;

    INSERT INTO public.events (name, title, slug, description, image_url, location, capacity, status, accessibility, organization_id)
    VALUES (
      'Mercado de Emprendedores (evento de demostración)',
      'Mercado de Emprendedores (evento de demostración)',
      'evento-demo-gratis',
      '<p><strong>Este es un evento de demostración de AI Tickets.</strong> Muestra cómo se ve un evento gratuito: la asistencia se confirma en la misma página, con nombre y email, sin pasos ni pagos. No se crea ninguna entrada real.</p>'
        || '<p>Imagina una tarde con 25 emprendimientos locales, café de especialidad y música en vivo. La entrada es liberada, pero los cupos son limitados.</p>'
        || '<p>¿Organizas eventos gratuitos? Crea el tuyo gratis en aitickets.cl/organizadores.</p>',
      'https://bgsmqjrdryafvlyxywud.supabase.co/storage/v1/object/public/Events/demo/evento-demo-gratis.jpg',
      'Galpón de ejemplo AI Tickets, Av. Italia 1450, Providencia',
      60, 'published', 'private', 1
    )
    RETURNING id INTO v_event_id;

    INSERT INTO public.event_locations (event_id, venue_id, name)
    VALUES (v_event_id, v_venue_id, 'Main')
    RETURNING id INTO v_location_id;

    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-10-15', TIME '18:00', TIME '21:00', v_location_id);

    INSERT INTO public.event_tickets (event_id, ticket_name, price, max_quantity, is_gift, status, total_quantity)
    VALUES (v_event_id, 'Entrada liberada', 0, 4, false, 'available', 60);

    INSERT INTO public.event_faqs (event_id, question, answer)
    VALUES
      (v_event_id, '¿Es un evento real?', 'No. Es un evento de demostración de AI Tickets: puedes confirmar tu asistencia, pero no se crea ninguna entrada.'),
      (v_event_id, '¿Puedo ir con más personas?', 'Sí, hasta 4 por inscripción en este ejemplo. Cada productor define su límite.'),
      (v_event_id, '¿Cómo recibo mi entrada?', 'En un evento real, llega por email con un código QR apenas confirmas tu asistencia.');

    INSERT INTO public.category_tags (name) VALUES ('Gastronomía') ON CONFLICT (name) DO NOTHING;
    SELECT id INTO v_tag_id FROM public.category_tags WHERE name = 'Gastronomía';
    IF v_tag_id IS NOT NULL THEN
      INSERT INTO public.event_tags (event_id, tag_id) VALUES (v_event_id, v_tag_id);
    END IF;
  END IF;

  -- Gira: 5 funciones en 3 ciudades (viernes y sábados desde el próximo viernes)
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE slug = 'evento-demo-gira') THEN
    INSERT INTO public.events (name, title, slug, description, image_url, location, capacity, status, accessibility, organization_id)
    VALUES (
      'Gira Ciudades 2026 (evento de demostración)',
      'Gira Ciudades 2026 (evento de demostración)',
      'evento-demo-gira',
      '<p><strong>Este es un evento de demostración de AI Tickets.</strong> Muestra cómo se ve una gira: varias funciones en distintas ciudades y recintos, cada una con sus propias entradas. Primero eliges el lugar, después la fecha y al final las entradas. No se crea ninguna orden ni se cobra nada.</p>'
        || '<p>Imagina una banda indie presentando su nuevo disco en Santiago y Viña del Mar, con funciones viernes y sábado.</p>'
        || '<p>¿Organizas giras? Crea la tuya gratis en aitickets.cl/organizadores.</p>',
      'https://bgsmqjrdryafvlyxywud.supabase.co/storage/v1/object/public/Events/demo/evento-demo-gira.jpg',
      'Providencia, Ñuñoa y Viña del Mar',
      900, 'published', 'private', 1
    )
    RETURNING id INTO v_event_id;

    INSERT INTO public.venues (name, address_line1, city, state_province, country_code, latitude, longitude, timezone, capacity, notes, organization_id)
    VALUES ('Sala de ejemplo Providencia', 'Av. Providencia 2330', 'Providencia', 'Región Metropolitana', 'CL', -33.4205, -70.6070,
            'America/Santiago', 300, 'Recinto ficticio del evento de demostración (evento-demo-gira)', 1)
    RETURNING id INTO v_venue_id;
    INSERT INTO public.event_locations (event_id, venue_id, name) VALUES (v_event_id, v_venue_id, 'Main') RETURNING id INTO v_loc_prov;

    INSERT INTO public.venues (name, address_line1, city, state_province, country_code, latitude, longitude, timezone, capacity, notes, organization_id)
    VALUES ('Teatro de ejemplo Ñuñoa', 'Av. Irarrázaval 3450', 'Ñuñoa', 'Región Metropolitana', 'CL', -33.4545, -70.5960,
            'America/Santiago', 400, 'Recinto ficticio del evento de demostración (evento-demo-gira)', 1)
    RETURNING id INTO v_venue_id;
    INSERT INTO public.event_locations (event_id, venue_id, name) VALUES (v_event_id, v_venue_id, 'Main') RETURNING id INTO v_loc_nunoa;

    INSERT INTO public.venues (name, address_line1, city, state_province, country_code, latitude, longitude, timezone, capacity, notes, organization_id)
    VALUES ('Sala de ejemplo Viña del Mar', 'Av. San Martín 450', 'Viña del Mar', 'Valparaíso', 'CL', -33.0175, -71.5520,
            'America/Santiago', 200, 'Recinto ficticio del evento de demostración (evento-demo-gira)', 1)
    RETURNING id INTO v_venue_id;
    INSERT INTO public.event_locations (event_id, venue_id, name) VALUES (v_event_id, v_venue_id, 'Main') RETURNING id INTO v_loc_vina;

    -- Fechas guardadas: la primera (2026-10-23, viernes) es el ancla de src/lib/demoEvent.mjs
    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-10-23', TIME '21:00', TIME '23:00', v_loc_prov) RETURNING id INTO v_fn1;
    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-10-24', TIME '21:00', TIME '23:00', v_loc_prov) RETURNING id INTO v_fn2;
    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-10-30', TIME '21:00', TIME '23:00', v_loc_nunoa) RETURNING id INTO v_fn3;
    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-10-31', TIME '21:00', TIME '23:00', v_loc_nunoa) RETURNING id INTO v_fn4;
    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-11-06', TIME '21:30', TIME '23:30', v_loc_vina) RETURNING id INTO v_fn5;

    -- Entradas por función. fn2: "Últimas" (8 en total). fn4: agotada (0).
    INSERT INTO public.event_tickets (event_id, event_date_id, ticket_name, price, max_quantity, is_gift, status, total_quantity)
    VALUES
      (v_event_id, v_fn1, 'General', 14000, 10, false, 'available', 200),
      (v_event_id, v_fn1, 'Platea preferente', 22000, 6, false, 'available', 40),
      (v_event_id, v_fn2, 'General', 14000, 10, false, 'available', 5),
      (v_event_id, v_fn2, 'Platea preferente', 22000, 6, false, 'available', 3),
      (v_event_id, v_fn3, 'General', 14000, 10, false, 'available', 250),
      (v_event_id, v_fn3, 'Platea preferente', 22000, 6, false, 'available', 60),
      (v_event_id, v_fn4, 'General', 14000, 10, false, 'available', 0),
      (v_event_id, v_fn4, 'Platea preferente', 22000, 6, false, 'available', 0),
      (v_event_id, v_fn5, 'General', 12000, 10, false, 'available', 150),
      (v_event_id, v_fn5, 'Platea preferente', 19000, 6, false, 'available', 30);

    INSERT INTO public.event_faqs (event_id, question, answer)
    VALUES
      (v_event_id, '¿Es un evento real?', 'No. Es un evento de demostración de AI Tickets: puedes recorrer el flujo de compra, pero no se venden entradas ni se cobra nada.'),
      (v_event_id, '¿Las entradas sirven para cualquier función?', 'No. En este ejemplo cada entrada es para una función y un recinto específicos.'),
      (v_event_id, '¿Cómo recibo mis entradas?', 'En un evento real, llegan por email con un código QR apenas se confirma el pago.');

    SELECT id INTO v_tag_id FROM public.category_tags WHERE name = 'Conciertos y Música en Vivo';
    IF v_tag_id IS NOT NULL THEN
      INSERT INTO public.event_tags (event_id, tag_id) VALUES (v_event_id, v_tag_id);
    END IF;
  END IF;
END $$;

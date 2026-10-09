-- Ajuste de la portada del evento + dos eventos de demostración más. Idempotente.
--
-- 1) events.cover_settings: cómo se muestra la portada en la página pública, por dispositivo.
--    { "desktop": { "height": 480, "position_y": 50, "fit": "cover" },
--      "mobile":  { "height": 360, "position_y": 50, "fit": "cover" } }
--    height en px, position_y en % (0 = arriba, 100 = abajo), fit 'cover' (recortar) o 'contain'
--    (imagen completa sobre fondo difuminado). NULL = valores por defecto. La valida /api/events/update
--    (src/lib/eventCover.ts).
--
-- 2) Eventos demo 'evento-demo-concierto' y 'evento-demo-feria' (organización 1, AI Tickets), además del
--    existente 'evento-demo-aitickets'. Se listan siempre en /eventos con fecha dinámica
--    (src/lib/demoEvent.mjs: la fecha guardada en event_dates se reemplaza al mostrarlos) y la compra se
--    rechaza en el servidor. Privados para no entrar al sitemap. Solo se siembran si existe la organización 1
--    y no existe el slug (en la CI, con la BD vacía, no hacen nada).

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cover_settings jsonb;

COMMENT ON COLUMN public.events.cover_settings IS
  'Ajuste de la portada por dispositivo: {desktop|mobile: {height px, position_y %, fit cover|contain}}. NULL = por defecto.';

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

  -- Concierto (sábado siguiente)
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE slug = 'evento-demo-concierto') THEN
    INSERT INTO public.venues (name, address_line1, city, state_province, country_code, latitude, longitude, timezone, capacity, notes, organization_id)
    VALUES ('Club de ejemplo AI Tickets', 'Av. Italia 1150', 'Providencia', 'Región Metropolitana', 'CL', -33.4440, -70.6230,
            'America/Santiago', 400, 'Recinto ficticio del evento de demostración (evento-demo-concierto)', 1)
    RETURNING id INTO v_venue_id;

    INSERT INTO public.events (name, title, slug, description, image_url, location, capacity, status, accessibility, organization_id)
    VALUES (
      'Noche Indie en Vivo (evento de demostración)',
      'Noche Indie en Vivo (evento de demostración)',
      'evento-demo-concierto',
      '<p><strong>Este es un evento de demostración de AI Tickets.</strong> Muestra cómo se ve la página de un concierto: portada, funciones, entradas con preventa y un asistente con IA que responde las dudas del público. No se crea ninguna orden ni se cobra nada.</p>'
        || '<p>Imagina tres bandas emergentes de la escena indie de Santiago en un club de Providencia: puertas a las 20:30, primera banda a las 21:00 y barra abierta toda la noche.</p>'
        || '<p>¿Organizas eventos? Crea el tuyo gratis en aitickets.cl/organizadores.</p>',
      'https://bgsmqjrdryafvlyxywud.supabase.co/storage/v1/object/public/Events/demo/evento-demo-concierto.jpg',
      'Club de ejemplo AI Tickets, Av. Italia 1150, Providencia',
      400, 'published', 'private', 1
    )
    RETURNING id INTO v_event_id;

    INSERT INTO public.event_locations (event_id, venue_id, name)
    VALUES (v_event_id, v_venue_id, 'Main')
    RETURNING id INTO v_location_id;

    -- La fecha real la calcula src/lib/demoEvent.mjs; esta solo deja la función con horario
    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-10-10', TIME '21:00', TIME '23:30', v_location_id);

    INSERT INTO public.event_tickets (event_id, ticket_name, price, max_quantity, is_gift, status, total_quantity)
    VALUES
      (v_event_id, 'Preventa', 10000, 6, false, 'available', 40),
      (v_event_id, 'General', 14000, 10, false, 'available', NULL);

    INSERT INTO public.event_faqs (event_id, question, answer)
    VALUES
      (v_event_id, '¿Es un evento real?', 'No. Es un evento de demostración de AI Tickets: puedes recorrer el flujo de compra, pero no se venden entradas ni se cobra nada.'),
      (v_event_id, '¿A qué hora abren las puertas?', 'En este ejemplo, a las 20:30. La primera banda parte a las 21:00.'),
      (v_event_id, '¿Cómo recibo mis entradas?', 'En un evento real, llegan por email con un código QR apenas se confirma el pago.');

    SELECT id INTO v_tag_id FROM public.category_tags WHERE name = 'Conciertos y Música en Vivo';
    IF v_tag_id IS NOT NULL THEN
      INSERT INTO public.event_tags (event_id, tag_id) VALUES (v_event_id, v_tag_id);
    END IF;
  END IF;

  -- Feria gastronómica (día 15 de cada mes)
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE slug = 'evento-demo-feria') THEN
    INSERT INTO public.venues (name, address_line1, city, state_province, country_code, latitude, longitude, timezone, capacity, notes, organization_id)
    VALUES ('Parque de ejemplo AI Tickets', 'Av. Andrés Bello 2100', 'Providencia', 'Región Metropolitana', 'CL', -33.4180, -70.6060,
            'America/Santiago', 2000, 'Recinto ficticio del evento de demostración (evento-demo-feria)', 1)
    RETURNING id INTO v_venue_id;

    INSERT INTO public.events (name, title, slug, description, image_url, location, capacity, status, accessibility, organization_id)
    VALUES (
      'Feria Sabores de Chile (evento de demostración)',
      'Feria Sabores de Chile (evento de demostración)',
      'evento-demo-feria',
      '<p><strong>Este es un evento de demostración de AI Tickets.</strong> Muestra cómo se ve la página de una feria o festival al aire libre: entradas generales, para niños y con degustación incluida. No se crea ninguna orden ni se cobra nada.</p>'
        || '<p>Imagina una tarde en un parque con más de 30 puestos de cocina chilena, vinos de distintos valles y música en vivo hasta el atardecer.</p>'
        || '<p>¿Organizas eventos? Crea el tuyo gratis en aitickets.cl/organizadores.</p>',
      'https://bgsmqjrdryafvlyxywud.supabase.co/storage/v1/object/public/Events/demo/evento-demo-feria.jpg',
      'Parque de ejemplo AI Tickets, Av. Andrés Bello 2100, Providencia',
      2000, 'published', 'private', 1
    )
    RETURNING id INTO v_event_id;

    INSERT INTO public.event_locations (event_id, venue_id, name)
    VALUES (v_event_id, v_venue_id, 'Main')
    RETURNING id INTO v_location_id;

    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-10-15', TIME '12:00', TIME '20:00', v_location_id);

    INSERT INTO public.event_tickets (event_id, ticket_name, price, max_quantity, is_gift, status, total_quantity)
    VALUES
      (v_event_id, 'General', 5000, 10, false, 'available', NULL),
      (v_event_id, 'Niños (hasta 12 años)', 2000, 10, false, 'available', NULL),
      (v_event_id, 'General + degustación de vinos', 15000, 6, false, 'available', 120);

    INSERT INTO public.event_faqs (event_id, question, answer)
    VALUES
      (v_event_id, '¿Es un evento real?', 'No. Es un evento de demostración de AI Tickets: puedes recorrer el flujo de compra, pero no se venden entradas ni se cobra nada.'),
      (v_event_id, '¿Se puede ir con mascotas?', 'En este ejemplo, sí, con correa. Cada productor define sus propias condiciones.'),
      (v_event_id, '¿Cómo recibo mis entradas?', 'En un evento real, llegan por email con un código QR apenas se confirma el pago.');

    INSERT INTO public.category_tags (name) VALUES ('Gastronomía') ON CONFLICT (name) DO NOTHING;
    SELECT id INTO v_tag_id FROM public.category_tags WHERE name = 'Gastronomía';
    IF v_tag_id IS NOT NULL THEN
      INSERT INTO public.event_tags (event_id, tag_id) VALUES (v_event_id, v_tag_id);
    END IF;
  END IF;
END $$;

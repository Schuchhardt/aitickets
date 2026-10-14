-- Sexto evento de demostración: una obra de teatro (foto cuadrada 1:1, Events/demo/evento-demo-teatro.jpg) para que
-- la grilla masonry de /eventos (src/components/EventList.vue) quede pareja solo con eventos demo y muestre las tres
-- proporciones de imagen (3:2, 4:5 y 1:1). Fecha dinámica: todos los domingos (src/lib/demoEvent.mjs).
-- Igual que los otros demos: organización 1, privado (fuera del sitemap) pero listado en /eventos, y la compra se
-- rechaza en el servidor. Diseño póster y fondo "Perla" (el único preset que no usaba otro demo).
--
-- Además, categorías más precisas para filtrar el listado: el stand-up suma "Comedia / Stand-up" y el teatro
-- usa "Teatro" (nueva). Idempotente: solo siembra si existe la organización 1 y no existe el slug.

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

  IF NOT EXISTS (SELECT 1 FROM public.events WHERE slug = 'evento-demo-teatro') THEN
    INSERT INTO public.venues (name, address_line1, city, state_province, country_code, latitude, longitude, timezone, capacity, notes, organization_id)
    VALUES ('Teatro de ejemplo Bellavista', 'Antonia López de Bello 0125', 'Recoleta', 'Región Metropolitana', 'CL', -33.4337, -70.6345,
            'America/Santiago', 90, 'Recinto ficticio del evento de demostración (evento-demo-teatro)', 1)
    RETURNING id INTO v_venue_id;

    INSERT INTO public.events (name, title, slug, description, image_url, location, capacity, status, accessibility, organization_id)
    VALUES (
      'La Ventana: obra de teatro',
      'La Ventana: obra de teatro',
      'evento-demo-teatro',
      '<p><strong>Este es un evento de demostración de AI Tickets.</strong> Muestra cómo se ve la página de una obra de teatro con función semanal, entrada general y entrada con descuento para estudiantes. No se crea ninguna orden ni se cobra nada.</p>'
        || '<p>Imagina una obra íntima para dos actores en una sala de Bellavista: una pareja, una silla y una ventana que nadie se atreve a abrir. 70 minutos, todos los domingos.</p>'
        || '<p>¿Produces teatro? Vende tus funciones gratis en aitickets.cl/organizadores.</p>',
      'https://bgsmqjrdryafvlyxywud.supabase.co/storage/v1/object/public/Events/demo/evento-demo-teatro.jpg',
      'Teatro de ejemplo Bellavista, Antonia López de Bello 0125, Recoleta',
      90, 'published', 'private', 1
    )
    RETURNING id INTO v_event_id;

    UPDATE public.events SET page_settings = '{"layout": "poster", "background": "pearl"}'::jsonb WHERE id = v_event_id;

    INSERT INTO public.event_locations (event_id, venue_id, name)
    VALUES (v_event_id, v_venue_id, 'Main')
    RETURNING id INTO v_location_id;

    -- La fecha real la calcula src/lib/demoEvent.mjs (próximo domingo)
    INSERT INTO public.event_dates (event_id, date, start_time, end_time, event_location_id)
    VALUES (v_event_id, DATE '2026-10-18', TIME '19:00', TIME '20:10', v_location_id);

    INSERT INTO public.event_tickets (event_id, ticket_name, price, max_quantity, is_gift, status, total_quantity)
    VALUES
      (v_event_id, 'General', 9000, 8, false, 'available', 70),
      (v_event_id, 'Estudiantes (con credencial)', 6000, 4, false, 'available', 20);

    INSERT INTO public.event_faqs (event_id, question, answer)
    VALUES
      (v_event_id, '¿Es un evento real?', 'No. Es un evento de demostración de AI Tickets: puedes recorrer el flujo de compra, pero no se venden entradas ni se cobra nada.'),
      (v_event_id, '¿Se puede entrar después de que empieza la obra?', 'En este ejemplo, no: las puertas se cierran al comenzar. Cada productor define sus propias reglas.'),
      (v_event_id, '¿Cómo recibo mis entradas?', 'En un evento real, llegan por email con un código QR apenas se confirma el pago.');

    INSERT INTO public.category_tags (name) VALUES ('Teatro') ON CONFLICT (name) DO NOTHING;
    SELECT id INTO v_tag_id FROM public.category_tags WHERE name = 'Teatro';
    IF v_tag_id IS NOT NULL THEN
      INSERT INTO public.event_tags (event_id, tag_id) VALUES (v_event_id, v_tag_id);
    END IF;
  END IF;

  -- Stand-up: categoría propia (además de "Evento cultural")
  INSERT INTO public.category_tags (name) VALUES ('Comedia / Stand-up') ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_tag_id FROM public.category_tags WHERE name = 'Comedia / Stand-up';
  SELECT id INTO v_event_id FROM public.events WHERE slug = 'evento-demo-aitickets';
  IF v_tag_id IS NOT NULL AND v_event_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.event_tags WHERE event_id = v_event_id AND tag_id = v_tag_id) THEN
    INSERT INTO public.event_tags (event_id, tag_id) VALUES (v_event_id, v_tag_id);
  END IF;
END $$;

-- Quita el trigger que copiaba events.end_date como fin de venta (event_tickets.end_date) en TODAS las entradas del
-- evento cada vez que cambiaba la fecha de término. Idempotente.
--
-- Ese trigger (trigger_update_ticket_end_date → update_ticket_end_date) se creó a mano en Supabase y la app no lo
-- conocía. La fecha de término del evento cambia sola (refreshEventDenorm al agregar o mover funciones desde el panel o
-- update_event_functions), así que pisaba en silencio el fin de venta que el productor definió (p. ej. una preventa
-- que termina antes) y lo dejaba igual al fin del evento.
-- Como el proyecto de Supabase es compartido, se busca por lo que hace (una función de un trigger de usuario sobre
-- public.events que hace UPDATE de event_tickets y su end_date) y solo se borra el TRIGGER; la función queda.
--
-- Datos: sin el trigger, una entrada cuyo fin de venta es igual al fin actual del evento (casi seguro lo escribió el
-- trigger) dejaría de venderse antes de tiempo apenas el evento sumara una función más tarde. Esas pasan a NULL, que en
-- la app es "a la venta mientras el evento esté publicado" (contrato C2): lo mismo que hacían en la práctica, porque
-- la venta igual se corta cuando termina la función o el evento. Las que tienen otra fecha se respetan.

DO $$
DECLARE
  t record;
  n integer;
BEGIN
  FOR t IN
    SELECT tg.tgname, p.proname
      FROM pg_trigger tg
      JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = 'public.events'::regclass
       AND NOT tg.tgisinternal
       AND pg_get_functiondef(p.oid) ~* 'update\s+(public\.)?event_tickets'
       AND pg_get_functiondef(p.oid) ~* 'end_date'
  LOOP
    RAISE NOTICE 'Quitando el trigger % (función %) de public.events', t.tgname, t.proname;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.events', t.tgname); -- lint:allow trigger de fin de venta sobre events (tabla de AI Tickets)
  END LOOP;

  UPDATE public.event_tickets tk
     SET end_date = NULL
    FROM public.events ev
   WHERE ev.id = tk.event_id
     AND tk.end_date IS NOT NULL
     AND ev.end_date IS NOT NULL
     AND tk.end_date = ev.end_date
     AND tk.is_gift IS DISTINCT FROM true;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Entradas con el fin de venta copiado del evento, ahora sin fecha de cierre: %', n;
END $$;

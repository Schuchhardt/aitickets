-- Quita el trigger que creaba el tipo de entrada "Cortesía" (event_tickets.is_gift = true) con cada evento. Idempotente.
--
-- Ese trigger se creó a mano en Supabase (no está en las migraciones), así que se busca por lo que hace, no por su
-- nombre: un trigger de usuario sobre public.events cuya función inserta en event_tickets con is_gift. Problemas que
-- tenía: los eventos creados sin él (o duplicados) quedaban sin cortesías, aparecía como un tipo más en todos lados
-- y en eventos con entradas numeradas su cupo no calza con los asientos.
-- Desde ahora el tipo Cortesía lo crea la app al emitir la primera cortesía del evento (ensureCourtesyTicket en
-- src/lib/courtesy.ts). Los tipos Cortesía que ya existen se quedan: tienen las cortesías ya emitidas.
-- Solo se borra el TRIGGER (de la tabla events, de AI Tickets). La función se deja: el proyecto de Supabase es
-- compartido y no se toca un objeto que podría usar otra app; sin el trigger no corre.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tg.tgname, p.proname
      FROM pg_trigger tg
      JOIN pg_proc p ON p.oid = tg.tgfoid
     WHERE tg.tgrelid = 'public.events'::regclass
       AND NOT tg.tgisinternal
       AND pg_get_functiondef(p.oid) ILIKE '%event_tickets%'
       AND pg_get_functiondef(p.oid) ILIKE '%is_gift%'
       AND pg_get_functiondef(p.oid) ILIKE '%insert%'
  LOOP
    RAISE NOTICE 'Quitando el trigger % (función %) de public.events', t.tgname, t.proname;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.events', t.tgname); -- lint:allow trigger de cortesías sobre events (tabla de AI Tickets)
  END LOOP;
END $$;

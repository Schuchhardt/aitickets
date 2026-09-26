-- Lockdown RLS de las tablas de AI Tickets.
--
-- Contexto: desde este cambio TODO el acceso de la app a Supabase es server-side con la
-- service role key (que se salta RLS) y la autorización se hace en el código
-- (sesión -> public.users -> organization_id). Por lo tanto los roles `anon` y
-- `authenticated` no necesitan ningún acceso directo a estas tablas vía PostgREST.
--
-- IMPORTANTE:
--   * El proyecto de Supabase es COMPARTIDO con otras apps. Este script solo toca las
--     tablas de AI Tickets listadas explícitamente. Antes de aplicarlo, confirmar que
--     ninguna otra app lee/escribe estas tablas con anon/authenticated (en especial
--     `public.users` y `public.organizations`, que tienen nombres genéricos).
--   * Aplicar SOLO DESPUÉS de desplegar el código que usa service role en todas partes,
--     si no, el sitio actual (que usa la anon key) deja de funcionar.
--   * Es idempotente.

DO $$
DECLARE
  t text;
  p record;
  aitickets_tables text[] := ARRAY[
    'attendees', 'category_tags', 'newsletter', 'organizations', 'venues', 'users',
    'events', 'event_tickets', 'event_locations', 'event_orders', 'event_faqs',
    'event_tags', 'event_withdrawals', 'questions', 'event_dates', 'event_visits',
    'event_attendees', 'social_accounts', 'social_posts', 'ad_account_connections',
    'ad_campaigns', 'notification_log'
  ];
BEGIN
  FOREACH t IN ARRAY aitickets_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'Tabla public.% no existe, se omite', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Quitar todas las políticas existentes (incluida la de UPDATE de users sin WITH CHECK,
    -- que permitía a un usuario cambiarse organization_id/role con su JWT).
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
    END LOOP;

    -- Sin políticas + RLS activo = anon/authenticated no ven nada. Además revocar privilegios.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- Datos personales innecesarios (Ley 21.719): la IP en claro no se usa, basta el hash.
UPDATE public.event_visits SET ip_raw = NULL WHERE ip_raw IS NOT NULL;

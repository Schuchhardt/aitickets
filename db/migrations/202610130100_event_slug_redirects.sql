-- Redirects de slugs antiguos de eventos. Idempotente.
--
-- Al cambiar el slug de un evento publicado o que ya tiene registrados (órdenes pagadas, entradas o invitados), el slug
-- anterior se guarda aquí: /eventos/<old_slug> (y /o/<sitio>/eventos/<old_slug>, /qr/<old_slug>) redirige con
-- 301 al slug actual del evento. Se guarda event_id (no el slug nuevo), así una cadena de cambios
-- (a -> b -> c) sigue apuntando al slug vigente sin saltos intermedios.
-- Lo escribe src/lib/eventSlug.ts (API de productores: update_event con slug).
-- RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_event_slug_redirects (
  old_slug text PRIMARY KEY CHECK (old_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(old_slug) <= 120),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aitickets_event_slug_redirects_event_idx
  ON public.aitickets_event_slug_redirects (event_id);

ALTER TABLE public.aitickets_event_slug_redirects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_slug_redirects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_slug_redirects TO service_role;

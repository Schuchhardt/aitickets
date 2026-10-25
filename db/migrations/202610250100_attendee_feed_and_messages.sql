-- Muro de asistentes y mensajes de asistentes a la productora. Idempotente.
--
-- 1) aitickets_event_feed_posts: quien tiene una entrada vigente reacciona al evento con un emoji y, si quiere, deja
--    un mensaje corto. Una publicación por persona (email) y evento: reaccionar de nuevo la actualiza. Se ve en la
--    página de la orden (/order/<id>) y de la entrada (/ticket/<id>), solo para quienes van al evento. La escribe
--    /api/orders/feed con el id de la orden (quien tiene el link de la orden ya ve sus entradas, igual que en
--    /api/reviews/verify). status 'visible' | 'hidden' (la ocultó la productora desde el panel).
--
-- 2) aitickets_attendee_messages: mensajes de un asistente a la productora desde la página de su orden
--    (/api/orders/message). Se guardan primero y luego se envían por correo al equipo de la productora con
--    Reply-To = asistente; delivered_at / mail_error registran el envío y read_at lo marca el panel.
--
-- 3) Índice por event_orders.buyer_email para "Mis entradas" (/mis-entradas: las órdenes de un asistente en todos
--    los eventos, con la sesión de asistente de netlify/lib/buyer-session.mjs). Los emails se guardan en minúsculas.
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_event_feed_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.event_orders(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  display_name text CHECK (display_name IS NULL OR char_length(display_name) <= 80),
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  message text CHECK (message IS NULL OR char_length(message) <= 280),
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Una publicación por persona y evento: también es el on_conflict del upsert.
CREATE UNIQUE INDEX IF NOT EXISTS aitickets_event_feed_posts_event_email_idx
  ON public.aitickets_event_feed_posts (event_id, email);
CREATE INDEX IF NOT EXISTS aitickets_event_feed_posts_event_created_idx
  ON public.aitickets_event_feed_posts (event_id, status, created_at DESC);

ALTER TABLE public.aitickets_event_feed_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_feed_posts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_feed_posts TO service_role;

COMMENT ON TABLE public.aitickets_event_feed_posts IS
  'Muro de asistentes: reacción (emoji) y mensaje corto de quien tiene entrada, uno por email y evento. Solo service role.';

CREATE TABLE IF NOT EXISTS public.aitickets_attendee_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.event_orders(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  name text CHECK (name IS NULL OR char_length(name) <= 160),
  message text NOT NULL CHECK (char_length(message) BETWEEN 2 AND 2000),
  delivered_at timestamptz,
  mail_error text CHECK (mail_error IS NULL OR char_length(mail_error) <= 500),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aitickets_attendee_messages_event_idx
  ON public.aitickets_attendee_messages (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_attendee_messages_org_idx
  ON public.aitickets_attendee_messages (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_attendee_messages_order_idx
  ON public.aitickets_attendee_messages (order_id, created_at DESC);

ALTER TABLE public.aitickets_attendee_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_attendee_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_attendee_messages TO service_role;

COMMENT ON TABLE public.aitickets_attendee_messages IS
  'Mensajes de asistentes a la productora desde la página de su orden. Solo service role.';

CREATE INDEX IF NOT EXISTS aitickets_event_orders_buyer_email_idx
  ON public.event_orders (buyer_email, created_at DESC);

-- Suscripciones Web Push del panel de productores (PWA). Una fila por navegador (endpoint), atada al usuario y a su
-- organización. Solo la usa el backend con service role: RLS activado y sin permisos para anon/authenticated.
CREATE TABLE IF NOT EXISTS public.aitickets_push_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text
);

CREATE INDEX IF NOT EXISTS aitickets_push_subscriptions_org_idx ON public.aitickets_push_subscriptions (organization_id);
CREATE INDEX IF NOT EXISTS aitickets_push_subscriptions_user_idx ON public.aitickets_push_subscriptions (user_id);

ALTER TABLE public.aitickets_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_push_subscriptions FROM PUBLIC, anon, authenticated;

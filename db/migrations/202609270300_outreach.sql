-- WP5: outreach autónomo (descubrimiento de productores, enriquecimiento, envíos, respuestas, supresión).
-- Idempotente. Solo crea objetos public.aitickets_* (proyecto Supabase compartido).
-- Todas las tablas: RLS activado SIN políticas + REVOKE ALL a anon/authenticated => solo la service role.
-- La lista de supresión nunca se borra (Ley 19.496 art. 28 B, CAN-SPAM).

-- 1. Fuentes de leads (interruptor por fuente + cursor de paginación + último resultado)
CREATE TABLE IF NOT EXISTS public.aitickets_lead_sources (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor jsonb,
  last_run_at timestamptz,
  last_result jsonb
);
ALTER TABLE public.aitickets_lead_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_lead_sources FROM PUBLIC, anon, authenticated;

INSERT INTO public.aitickets_lead_sources (key, enabled) VALUES
  ('chilecultura', true),
  ('inbound_form', true),
  ('csv_import', true),
  ('referral', true),
  ('places', false),
  ('websearch', false),
  ('ticketing', false)
ON CONFLICT (key) DO NOTHING;

-- 2. Leads (una organización por dominio registrable; los dominios de correo gratuito se guardan NULL)
CREATE TABLE IF NOT EXISTS public.aitickets_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name text,
  domain text UNIQUE,
  website text,
  country char(2) NOT NULL DEFAULT 'CL',
  city text,
  categories text[],
  email text,
  email_type text CHECK (email_type IS NULL OR email_type IN ('role', 'personal')),
  email_source_url text,
  email_found_at timestamptz,
  place_id text,
  current_ticketing text,
  upcoming_event jsonb,
  source text,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  score int,
  score_reasons jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'enriched', 'queued', 'contacted', 'replied', 'interested',
    'converted', 'lost', 'suppressed', 'invalid'
  )),
  invalid_reason text,
  sequence_step int NOT NULL DEFAULT 0,
  next_action_at timestamptz,
  last_contacted_at timestamptz,
  enrich_attempts int NOT NULL DEFAULT 0,
  consent_at timestamptz,
  lawful_basis text NOT NULL DEFAULT 'legitimate_interest_b2b',
  organization_id bigint REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_leads_domain_lower CHECK (domain IS NULL OR domain = lower(domain))
);
CREATE UNIQUE INDEX IF NOT EXISTS aitickets_leads_email_lower_uidx
  ON public.aitickets_leads (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS aitickets_leads_status_next_idx
  ON public.aitickets_leads (status, next_action_at);
CREATE INDEX IF NOT EXISTS aitickets_leads_organization_idx
  ON public.aitickets_leads (organization_id) WHERE organization_id IS NOT NULL;
ALTER TABLE public.aitickets_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_leads FROM PUBLIC, anon, authenticated;

-- 3. Mensajes (salientes y entrantes)
CREATE TABLE IF NOT EXISTS public.aitickets_outreach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.aitickets_leads(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  step int,
  provider text,
  provider_message_id text,
  thread_id text,
  mailbox text,
  subject text,
  body_text text,
  -- 'sending' = borrador reclamado por /api/outreach/approve mientras se envía (evita envíos dobles).
  status text NOT NULL CHECK (status IN ('draft', 'sending', 'scheduled', 'sent', 'failed', 'received', 'approved', 'rejected')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  ai_intent text,
  ai_confidence numeric,
  ai_payload jsonb,
  auto_sent boolean NOT NULL DEFAULT false,
  approved_by text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aitickets_outreach_messages_lead_idx
  ON public.aitickets_outreach_messages (lead_id, created_at);
CREATE INDEX IF NOT EXISTS aitickets_outreach_messages_status_idx
  ON public.aitickets_outreach_messages (direction, status, sent_at);
CREATE INDEX IF NOT EXISTS aitickets_outreach_messages_provider_idx
  ON public.aitickets_outreach_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
ALTER TABLE public.aitickets_outreach_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_outreach_messages FROM PUBLIC, anon, authenticated;

-- 4. Eventos (enviado, rebote, queja, baja, respuesta, auto-pausa). provider_event_id UNIQUE = idempotencia de webhooks.
CREATE TABLE IF NOT EXISTS public.aitickets_outreach_events (
  id bigserial PRIMARY KEY,
  lead_id uuid REFERENCES public.aitickets_leads(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.aitickets_outreach_messages(id) ON DELETE SET NULL,
  type text NOT NULL,
  provider_event_id text UNIQUE,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aitickets_outreach_events_type_idx
  ON public.aitickets_outreach_events (type, created_at);
ALTER TABLE public.aitickets_outreach_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_outreach_events FROM PUBLIC, anon, authenticated;

-- 5. Supresiones (por email o por dominio; nunca por dominio de correo gratuito, lo controla la app)
CREATE TABLE IF NOT EXISTS public.aitickets_suppressions (
  id bigserial PRIMARY KEY,
  email text,
  domain text,
  reason text NOT NULL CHECK (reason IN (
    'unsubscribe', 'complaint', 'hard_bounce', 'not_interested', 'manual', 'customer', 'bot_optout'
  )),
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_suppressions_target CHECK (email IS NOT NULL OR domain IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS aitickets_suppressions_target_uidx
  ON public.aitickets_suppressions (lower(coalesce(email, '')), lower(coalesce(domain, '')));
CREATE INDEX IF NOT EXISTS aitickets_suppressions_domain_idx
  ON public.aitickets_suppressions (lower(domain)) WHERE domain IS NOT NULL;
ALTER TABLE public.aitickets_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_suppressions FROM PUBLIC, anon, authenticated;

-- Secuencias implícitas de los bigserial: Supabase otorga por defecto ALL sobre secuencias nuevas de public
-- a anon/authenticated. Se revocan explícitamente; solo la service role las usa.
REVOKE ALL ON SEQUENCE public.aitickets_outreach_events_id_seq, public.aitickets_suppressions_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.aitickets_outreach_events_id_seq, public.aitickets_suppressions_id_seq TO service_role;

-- 6. Estado (pausa + contadores diarios)
CREATE TABLE IF NOT EXISTS public.aitickets_outreach_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitickets_outreach_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_outreach_state FROM PUBLIC, anon, authenticated;

INSERT INTO public.aitickets_outreach_state (key, value)
VALUES ('paused', '{"paused": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 7. Tomar un lote de leads con acción vencida. SKIP LOCKED evita que dos corridas simultáneas tomen el
--    mismo lead, y el "lease" (next_action_at + 30 min) evita que una corrida posterior lo re-tome
--    mientras la primera todavía está enviando.
CREATE OR REPLACE FUNCTION public.aitickets_claim_outreach_batch(p_limit int)
RETURNS SETOF public.aitickets_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT l.id
    FROM public.aitickets_leads l
    WHERE l.status IN ('enriched', 'contacted')
      AND l.email IS NOT NULL
      AND l.next_action_at IS NOT NULL
      AND l.next_action_at <= now()
    ORDER BY l.sequence_step ASC, l.score DESC NULLS LAST, l.next_action_at ASC
    LIMIT greatest(0, least(coalesce(p_limit, 0), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.aitickets_leads t
     SET next_action_at = now() + interval '30 minutes',
         updated_at = now()
    FROM due
   WHERE t.id = due.id
  RETURNING t.*;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_claim_outreach_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_claim_outreach_batch(int) TO service_role;

-- 8. Contador atómico (envíos del día, tokens de Claude del día, etc.). Devuelve el valor nuevo.
CREATE OR REPLACE FUNCTION public.aitickets_outreach_bump_counter(p_key text, p_delta bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  INSERT INTO public.aitickets_outreach_state AS s (key, value, updated_at)
  VALUES (p_key, jsonb_build_object('count', coalesce(p_delta, 0)), now())
  ON CONFLICT (key) DO UPDATE
    SET value = jsonb_build_object('count', coalesce((s.value->>'count')::bigint, 0) + coalesce(p_delta, 0)),
        updated_at = now()
  RETURNING (value->>'count')::bigint INTO v_total;
  RETURN v_total;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_outreach_bump_counter(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_outreach_bump_counter(text, bigint) TO service_role;

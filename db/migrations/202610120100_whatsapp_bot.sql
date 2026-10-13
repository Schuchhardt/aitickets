-- Bot de WhatsApp (Kapso): soporte a asistentes y ventas a productores.
--
-- 1. aitickets_wa_conversations: una fila por conversación de Kapso (conversation.id). Guarda la identidad
--    de WhatsApp (teléfono y/o BSUID), la pausa del bot cuando una persona del equipo responde desde el
--    Inbox de Kapso (bot_paused_until) y un candado para que solo una ejecución responda a la vez (lock_until).
-- 2. aitickets_wa_messages: historial (entrantes del cliente, respuestas del bot y respuestas humanas).
--    wamid es único: los reintentos del webhook de Kapso no duplican mensajes.
-- 3. aitickets_wa_claim_conversation / aitickets_wa_release_conversation: candado atómico por conversación.
-- 4. aitickets_wa_orders_by_phone: órdenes PAGADAS cuyo buyer_phone coincide (últimos 9 dígitos) con el
--    número de WhatsApp que escribe. WhatsApp ya verificó que la persona controla ese número.
-- 5. Fuente de leads 'whatsapp' (productores que piden que los contacten por el bot).
-- RLS activado SIN políticas + REVOKE ALL a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_wa_conversations (
  id text PRIMARY KEY,
  phone_number_id text NOT NULL,
  wa_phone text,
  bsuid text,
  contact_name text,
  bot_paused_until timestamptz,
  paused_reason text,
  lock_until timestamptz,
  lead_id uuid REFERENCES public.aitickets_leads(id) ON DELETE SET NULL,
  last_inbound_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitickets_wa_conversations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_wa_conversations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_wa_conversations TO service_role;

CREATE TABLE IF NOT EXISTS public.aitickets_wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL REFERENCES public.aitickets_wa_conversations(id) ON DELETE CASCADE,
  wamid text,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  author text NOT NULL CHECK (author IN ('customer', 'bot', 'human')),
  body text NOT NULL DEFAULT '',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aitickets_wa_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_wa_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_wa_messages TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS aitickets_wa_messages_wamid_key
  ON public.aitickets_wa_messages (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS aitickets_wa_messages_conversation_idx
  ON public.aitickets_wa_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS aitickets_wa_messages_pending_idx
  ON public.aitickets_wa_messages (conversation_id) WHERE direction = 'in' AND processed_at IS NULL;

-- Toma el candado de la conversación por p_seconds si está libre o vencido. true = lo tomó.
CREATE OR REPLACE FUNCTION public.aitickets_wa_claim_conversation(p_id text, p_seconds int)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.aitickets_wa_conversations
     SET lock_until = now() + make_interval(secs => greatest(coalesce(p_seconds, 60), 1))
   WHERE id = p_id AND (lock_until IS NULL OR lock_until < now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_wa_claim_conversation(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_wa_claim_conversation(text, int) TO service_role;

CREATE OR REPLACE FUNCTION public.aitickets_wa_release_conversation(p_id text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.aitickets_wa_conversations SET lock_until = NULL WHERE id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_wa_release_conversation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_wa_release_conversation(text) TO service_role;

-- Órdenes pagadas (más recientes primero) cuyo teléfono termina en los mismos 9 dígitos que p_phone.
-- Exige al menos 8 dígitos para no hacer coincidir números cortos o vacíos.
CREATE OR REPLACE FUNCTION public.aitickets_wa_orders_by_phone(p_phone text, p_limit int DEFAULT 10)
RETURNS TABLE (
  id uuid,
  event_id bigint,
  created_at timestamptz,
  ticket_qty int,
  buyer_email text,
  buyer_first_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
BEGIN
  IF length(v_digits) < 8 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT o.id, o.event_id::bigint, o.created_at, o.ticket_qty::int, o.buyer_email::text, o.buyer_first_name::text
      FROM public.event_orders o
     WHERE o.status = 'paid'
       AND o.buyer_phone IS NOT NULL
       AND right(regexp_replace(o.buyer_phone, '\D', '', 'g'), 9) = v_digits
     ORDER BY o.created_at DESC
     LIMIT least(greatest(coalesce(p_limit, 10), 1), 20);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_wa_orders_by_phone(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_wa_orders_by_phone(text, int) TO service_role;

INSERT INTO public.aitickets_lead_sources (key, enabled) VALUES ('whatsapp', true)
ON CONFLICT (key) DO NOTHING;

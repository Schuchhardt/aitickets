-- Links privados de promotor / RRPP: cada promotor ve sus números en el celular, sin cuenta. Idempotente.
--
-- Las ventas ya se atribuyen por ?ref= (event_orders.ref, lo guarda purchase-tickets). Este link le muestra al
-- promotor SOLO sus ventas (órdenes pagadas con su ref): entradas y monto por evento y función, y su link para
-- compartir. Nunca datos de compradores. Página: /promotor/<token> (src/pages/promotor/[token].astro); se crean y
-- revocan desde el panel del evento (/api/events/promoter-links) o el asistente de IA (create_promoter_link).
--
-- public.aitickets_promoter_links: una fila por link.
--   organization_id  productora dueña
--   event_id         NULL = todos los eventos de la productora (un RRPP de todas las noches); si no, solo ese evento
--   ref              código de seguimiento del promotor (el ?ref= de su link; minúsculas, [a-z0-9_.-])
--   name             nombre del promotor (lo que ve en su página)
--   token_hash       sha256 del token del link (el token solo se entrega al crearlo, igual que aitickets_checkin_links)
--   revoked_at       revocado (deja de funcionar de inmediato)
--   last_opened_at / open_count  uso del link
-- RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_promoter_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint REFERENCES public.events(id) ON DELETE CASCADE,
  ref text NOT NULL CHECK (ref ~ '^[a-z0-9_.-]{1,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  last_opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  created_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT aitickets_promoter_links_token_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS aitickets_promoter_links_org_idx ON public.aitickets_promoter_links (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_promoter_links_event_idx ON public.aitickets_promoter_links (event_id) WHERE event_id IS NOT NULL;

-- Las ventas de un promotor se leen por (event_id, ref) en órdenes pagadas
CREATE INDEX IF NOT EXISTS aitickets_event_orders_ref_idx ON public.event_orders (event_id, ref) WHERE ref IS NOT NULL;

COMMENT ON TABLE public.aitickets_promoter_links IS
  'Links privados de promotor (/promotor/<token>): sus ventas por ?ref=, sin datos de compradores. src/lib/promoterLinks.ts.';

ALTER TABLE public.aitickets_promoter_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_promoter_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_promoter_links TO service_role;

-- Códigos de descuento (pedido del dueño, oct 2026). Idempotente.
--
-- public.aitickets_discount_codes: códigos por organización, opcionalmente limitados a un evento
-- (event_id NULL = todos los eventos de la organización). code se guarda en MAYÚSCULAS ([A-Z0-9_-]{3,30})
-- y es único por organización. kind 'percent' (value 1-100) o 'fixed' (value CLP entero > 0).
-- No hay contador de usos: los usos se CALCULAN desde event_orders (igual que el stock), así una orden
-- vencida o fallida libera su uso sola:
--   uso = orden con discount_code_id = código y status 'paid' | 'processing' | 'review', o 'pending'
--         con la reserva vigente (COALESCE(hold_expires_at, created_at + 15 min) > now()).
--
-- event_orders gana:
--   discount_code_id  código aplicado (NULL sin descuento)
--   discount_amount   descuento en CLP sobre el subtotal de entradas (0 sin descuento)
--   discount_code     copia del texto del código (para correo, orden y CSV sin joins)
-- event_orders.amount sigue siendo lo que recibe el productor: el subtotal YA descontado. El monto
-- esperado del pago no cambia: amount + ticket_fee + service_fee_tax.
--
-- aitickets_reserve_order_v2: igual que aitickets_reserve_order (202609290100) pero, si recibe un código,
-- bloquea FOR UPDATE su fila, revalida vigencia, max_uses y per_buyer_limit (por buyer_email) con el
-- bloqueo tomado y recién entonces reserva la orden (misma transacción). Dos compras simultáneas con el
-- último uso quedan serializadas. Errores (SQLSTATE P0001):
--   'DISCOUNT_INVALID'       el código no existe, está inactivo o no aplica a este evento
--   'DISCOUNT_NOT_STARTED'   todavía no empieza su vigencia
--   'DISCOUNT_EXPIRED'       su vigencia terminó
--   'DISCOUNT_EXHAUSTED'     se alcanzó max_uses
--   'DISCOUNT_BUYER_LIMIT'   el comprador alcanzó per_buyer_limit
--   + los de aitickets_reserve_order (SOLD_OUT:<id>, TICKET_UNAVAILABLE:<id>, INVALID_LINES).
--
-- Todo: RLS sin políticas, REVOKE a anon/authenticated, funciones SECURITY DEFINER con search_path fijo
-- y EXECUTE solo para service_role.

CREATE TABLE IF NOT EXISTS public.aitickets_discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint REFERENCES public.events(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,30}$'),
  kind text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value numeric NOT NULL,
  max_uses int CHECK (max_uses IS NULL OR max_uses > 0),
  uses int NOT NULL DEFAULT 0,
  per_buyer_limit int CHECK (per_buyer_limit IS NULL OR per_buyer_limit > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_discount_codes_org_code_key UNIQUE (organization_id, code),
  CONSTRAINT aitickets_discount_codes_value_check CHECK (
    (kind = 'percent' AND value >= 1 AND value <= 100)
    OR (kind = 'fixed' AND value > 0 AND value = trunc(value))
  ),
  CONSTRAINT aitickets_discount_codes_window_check CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

COMMENT ON COLUMN public.aitickets_discount_codes.uses IS
  'Sin uso: los usos se calculan desde event_orders (aitickets_discount_code_usage).';

CREATE INDEX IF NOT EXISTS aitickets_discount_codes_event_idx
  ON public.aitickets_discount_codes (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE public.aitickets_discount_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_discount_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_discount_codes TO service_role;

ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS discount_code_id uuid
  REFERENCES public.aitickets_discount_codes(id) ON DELETE SET NULL;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS discount_amount bigint DEFAULT 0;
ALTER TABLE public.event_orders ADD COLUMN IF NOT EXISTS discount_code text;

COMMENT ON COLUMN public.event_orders.discount_amount IS
  'Descuento (CLP) sobre el subtotal de entradas. amount ya viene descontado.';

CREATE INDEX IF NOT EXISTS event_orders_discount_code_idx
  ON public.event_orders (discount_code_id) WHERE discount_code_id IS NOT NULL;

-- Usos vigentes de un código (total y del comprador p_email, sin distinguir mayúsculas).
CREATE OR REPLACE FUNCTION public.aitickets_discount_code_usage(p_code_id uuid, p_email text)
RETURNS TABLE (uses int, buyer_uses int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int AS uses,
         count(*) FILTER (
           WHERE p_email IS NOT NULL AND lower(o.buyer_email) = lower(trim(p_email))
         )::int AS buyer_uses
    FROM public.event_orders o
   WHERE o.discount_code_id = p_code_id
     AND (
       o.status IN ('paid', 'processing', 'review')
       OR (o.status = 'pending' AND COALESCE(o.hold_expires_at, o.created_at + interval '15 minutes') > now())
     );
$$;

REVOKE ALL ON FUNCTION public.aitickets_discount_code_usage(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aitickets_discount_code_usage(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_discount_code_usage(uuid, text) TO service_role;

-- Métricas por código para el dashboard: usos vigentes, órdenes pagadas, descuento otorgado y
-- ventas de entradas (ya descontadas) de las órdenes pagadas.
CREATE OR REPLACE FUNCTION public.aitickets_discount_code_stats(p_code_ids uuid[])
RETURNS TABLE (code_id uuid, uses int, paid_orders int, discount_total bigint, revenue bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.discount_code_id AS code_id,
         count(*) FILTER (
           WHERE o.status IN ('paid', 'processing', 'review')
              OR (o.status = 'pending' AND COALESCE(o.hold_expires_at, o.created_at + interval '15 minutes') > now())
         )::int AS uses,
         count(*) FILTER (WHERE o.status = 'paid')::int AS paid_orders,
         COALESCE(sum(o.discount_amount) FILTER (WHERE o.status = 'paid'), 0)::bigint AS discount_total,
         COALESCE(sum(o.amount) FILTER (WHERE o.status = 'paid'), 0)::bigint AS revenue
    FROM public.event_orders o
   WHERE o.discount_code_id = ANY (COALESCE(p_code_ids, ARRAY[]::uuid[]))
   GROUP BY o.discount_code_id;
$$;

REVOKE ALL ON FUNCTION public.aitickets_discount_code_stats(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aitickets_discount_code_stats(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_discount_code_stats(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.aitickets_reserve_order_v2(
  p_event_id bigint,
  p_lines jsonb,
  p_order jsonb,
  p_hold_minutes int,
  p_discount_code_id uuid,
  p_discount_amount bigint
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code public.aitickets_discount_codes%ROWTYPE;
  v_event_org bigint;
  v_uses int;
  v_buyer_uses int;
  v_amount bigint := COALESCE(p_discount_amount, 0);
  v_order_id uuid;
BEGIN
  IF p_discount_code_id IS NULL THEN
    RETURN public.aitickets_reserve_order(p_event_id, p_lines, p_order, p_hold_minutes);
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'DISCOUNT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueo del código ANTES que los tipos de entrada (orden fijo: código -> entradas).
  SELECT * INTO v_code
    FROM public.aitickets_discount_codes c
   WHERE c.id = p_discount_code_id
     FOR UPDATE;
  IF NOT FOUND OR NOT v_code.active THEN
    RAISE EXCEPTION 'DISCOUNT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT e.organization_id INTO v_event_org FROM public.events e WHERE e.id = p_event_id;
  IF v_event_org IS NULL
     OR v_code.organization_id <> v_event_org
     OR (v_code.event_id IS NOT NULL AND v_code.event_id <> p_event_id) THEN
    RAISE EXCEPTION 'DISCOUNT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF v_code.starts_at IS NOT NULL AND v_code.starts_at > now() THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_STARTED' USING ERRCODE = 'P0001';
  END IF;
  IF v_code.ends_at IS NOT NULL AND v_code.ends_at <= now() THEN
    RAISE EXCEPTION 'DISCOUNT_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  -- Recuento con el bloqueo tomado (READ COMMITTED: ve las órdenes ya confirmadas por otros).
  SELECT u.uses, u.buyer_uses INTO v_uses, v_buyer_uses
    FROM public.aitickets_discount_code_usage(p_discount_code_id, p_order->>'buyer_email') u;
  IF v_code.max_uses IS NOT NULL AND COALESCE(v_uses, 0) >= v_code.max_uses THEN
    RAISE EXCEPTION 'DISCOUNT_EXHAUSTED' USING ERRCODE = 'P0001';
  END IF;
  IF v_code.per_buyer_limit IS NOT NULL AND COALESCE(v_buyer_uses, 0) >= v_code.per_buyer_limit THEN
    RAISE EXCEPTION 'DISCOUNT_BUYER_LIMIT' USING ERRCODE = 'P0001';
  END IF;

  v_order_id := public.aitickets_reserve_order(p_event_id, p_lines, p_order, p_hold_minutes);

  UPDATE public.event_orders
     SET discount_code_id = v_code.id,
         discount_amount = v_amount,
         discount_code = v_code.code
   WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.aitickets_reserve_order_v2(bigint, jsonb, jsonb, int, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aitickets_reserve_order_v2(bigint, jsonb, jsonb, int, uuid, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_reserve_order_v2(bigint, jsonb, jsonb, int, uuid, bigint) TO service_role;

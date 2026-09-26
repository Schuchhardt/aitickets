-- Agente C/F3 (dashboard): datos bancarios para pagos a productores y atribución del registro.
-- Idempotente. Solo toca objetos de AI Tickets (public.organizations, public.event_tags,
-- public.organization_payout_accounts).

-- 1. Datos para transferir el saldo al productor (Configuración > Datos para pagos).
--    Tabla separada de organizations: los datos bancarios son sensibles y el proyecto Supabase es
--    compartido. RLS activado SIN políticas + REVOKE a anon/authenticated => solo la service role
--    (servidor de AI Tickets, que autoriza por organization_id y rol admin/producer) puede leer/escribir.
CREATE TABLE IF NOT EXISTS public.organization_payout_accounts (
  organization_id bigint NOT NULL,
  legal_name text,
  legal_rut text,
  bank_name text,
  bank_account_type text,
  bank_account_number text,
  bank_account_holder text,
  bank_account_rut text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by bigint,
  CONSTRAINT organization_payout_accounts_pkey PRIMARY KEY (organization_id),
  CONSTRAINT organization_payout_accounts_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_payout_accounts_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.organization_payout_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_payout_accounts FROM anon, authenticated;

-- 2. Atribución del registro del productor (canal de adquisición).
--    Nota: no son datos sensibles (utm/ref/referrer de la landing), por eso quedan en organizations.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signup_utm_source text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signup_utm_medium text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signup_utm_campaign text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signup_ref text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS signup_referrer text;

-- 3. Índice para leer/reemplazar la categoría de un evento (event_tags por event_id)
CREATE INDEX IF NOT EXISTS idx_event_tags_event_id ON public.event_tags(event_id);

-- Liberación condicionada de fondos, riesgo por evento, documentos del evento y reclamos/contracargos. Idempotente.
--
-- 1) events: nivel de riesgo (src/lib/eventRisk.ts) y reserva por riesgo que aplica el ledger
--    (src/lib/producer-api/ledger.ts): risk_score 0-100, risk_level low|medium|high, risk_signals (detalle),
--    reserve_pct 0-100 (% de lo vendido retenido hasta 60 días después de cada función), requires_documents
--    (el productor debe subir autorización, permiso del lugar y póliza), is_massive (evento masivo, Ley 21.659,
--    lo marca el productor o AI Tickets) y permit_status none|pending|approved|rejected (estado de la autorización,
--    se recalcula desde aitickets_event_documents y lo muestra la página pública).
--    risk_locked: AI Tickets fijó el riesgo/reserva a mano; el recálculo automático no lo pisa.
--    held_attested_at/by: el productor acreditó que el evento se realizó (abonos y órdenes de varias funciones).
-- 2) event_dates.held_attested_at/by/note: el productor acreditó que la función se realizó (reemplaza el mínimo de
--    check-ins para liberar lo vendido).
-- 3) aitickets_event_documents: documentos que sube el productor (bucket privado aitickets-event-documents).
-- 4) aitickets_disputes: reclamos y contracargos por orden. Uno 'open' retiene lo vendido de su función o evento.
--
-- Tablas nuevas: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS risk_score integer;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS risk_level text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS risk_signals jsonb;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS risk_computed_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS risk_locked boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS reserve_pct integer NOT NULL DEFAULT 0;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS requires_documents boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_massive boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS permit_status text NOT NULL DEFAULT 'none';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS held_attested_at timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS held_attested_by bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_risk_level_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_risk_level_check CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_reserve_pct_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_reserve_pct_check CHECK (reserve_pct BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_permit_status_check') THEN
    ALTER TABLE public.events ADD CONSTRAINT events_permit_status_check CHECK (permit_status IN ('none', 'pending', 'approved', 'rejected'));
  END IF;
END
$$;

COMMENT ON COLUMN public.events.reserve_pct IS
  'Reserva por riesgo: % de lo vendido que se retiene hasta 60 días después de cada función (ledger.ts). Lo calcula eventRisk.ts salvo risk_locked.';
COMMENT ON COLUMN public.events.permit_status IS
  'Autorización del evento: none | pending (documentos en revisión) | approved | rejected. Se recalcula desde aitickets_event_documents.';
COMMENT ON COLUMN public.events.is_massive IS 'Evento masivo (Ley 21.659): exige autorización de la Delegación Presidencial.';

ALTER TABLE public.event_dates ADD COLUMN IF NOT EXISTS held_attested_at timestamptz;
ALTER TABLE public.event_dates ADD COLUMN IF NOT EXISTS held_attested_by bigint;
ALTER TABLE public.event_dates ADD COLUMN IF NOT EXISTS held_attested_note text;

COMMENT ON COLUMN public.event_dates.held_attested_at IS
  'El productor acreditó que la función se realizó: reemplaza el mínimo de check-ins para liberar lo vendido.';

CREATE TABLE IF NOT EXISTS public.aitickets_event_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('delegacion_presidencial', 'venue_permit', 'rc_insurance', 'other')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  storage_path text NOT NULL CHECK (char_length(storage_path) <= 500),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  mime_type text,
  size_bytes integer,
  uploaded_by bigint,
  reviewed_at timestamptz,
  reviewed_by text,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aitickets_event_documents_event_idx ON public.aitickets_event_documents (event_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_event_documents_pending_idx ON public.aitickets_event_documents (status, created_at) WHERE status = 'pending';

ALTER TABLE public.aitickets_event_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_documents TO service_role;

COMMENT ON TABLE public.aitickets_event_documents IS
  'Documentos del evento (autorización Delegación Presidencial, permiso del lugar, póliza RC). Archivo en el bucket privado aitickets-event-documents. Solo service role.';

CREATE TABLE IF NOT EXISTS public.aitickets_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id bigint REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_date_id bigint,
  order_id uuid REFERENCES public.event_orders(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'chargeback' CHECK (kind IN ('chargeback', 'complaint', 'sernac', 'other')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'closed')),
  amount integer,
  source text CHECK (source IS NULL OR char_length(source) <= 80),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS aitickets_disputes_event_idx ON public.aitickets_disputes (event_id, status);
CREATE INDEX IF NOT EXISTS aitickets_disputes_created_idx ON public.aitickets_disputes (created_at DESC);

ALTER TABLE public.aitickets_disputes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_disputes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_disputes TO service_role;

COMMENT ON TABLE public.aitickets_disputes IS
  'Reclamos y contracargos por orden. status open retiene lo vendido de la función (o del evento si event_date_id es NULL). Solo service role.';

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) -- lint:allow bucket propio de AI Tickets (aitickets-*), privado, solo si no existe
  VALUES ('aitickets-event-documents', 'aitickets-event-documents', false, 15728640, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_column OR insufficient_privilege THEN
    RAISE NOTICE 'No se pudo crear el bucket aitickets-event-documents (%): créalo a mano (privado)', SQLERRM;
END
$$;

-- 5) Devolución directa desde admin (Términos para compradores §7, productores §9 bis): las cancelaciones que hace
--    AI Tickets sin autorización del productor quedan con requested_via = 'admin' en aitickets_refunds y
--    channel = 'admin' en la bitácora (aitickets_api_audit).
ALTER TABLE public.aitickets_refunds DROP CONSTRAINT IF EXISTS aitickets_refunds_requested_via_check;
ALTER TABLE public.aitickets_refunds
  ADD CONSTRAINT aitickets_refunds_requested_via_check CHECK (requested_via IN ('dashboard', 'mcp', 'rest', 'admin'));
ALTER TABLE public.aitickets_api_audit DROP CONSTRAINT IF EXISTS aitickets_api_audit_channel_check;
ALTER TABLE public.aitickets_api_audit
  ADD CONSTRAINT aitickets_api_audit_channel_check CHECK (channel IN ('mcp', 'rest', 'dashboard', 'admin'));

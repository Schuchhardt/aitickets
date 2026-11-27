-- Panoramas (/panoramas): los eventos externos (aitickets_external_events, 202611200100) pasan a tener una página
-- pública con su detalle y el link a la ticketera, y quienes fueron dejan su comentario con un comprobante de
-- asistencia (pantallazo de la entrada, PDF o correo). El comentario se publica SOLO cuando el admin lo valida desde el
-- MCP de administración (moderate_panorama_reviews). Spec: docs/specs/panoramas.md.
-- Idempotente. Solo toca objetos de AI Tickets.

-- ---------------------------------------------------------------------------
-- Datos públicos del evento externo
-- ---------------------------------------------------------------------------
-- description: resumen propio (2 a 4 frases, no copiado de la fuente) que se muestra en /panoramas.
-- image_url: afiche oficial (https). Sin imagen, la página usa un fondo por categoría.
-- public_status: auto = se publica si tiene una función próxima; featured = destacado arriba; hidden = nunca se muestra.
ALTER TABLE public.aitickets_external_events ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.aitickets_external_events ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.aitickets_external_events ADD COLUMN IF NOT EXISTS public_status text NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  ALTER TABLE public.aitickets_external_events
    ADD CONSTRAINT aitickets_external_events_public_status_check CHECK (public_status IN ('auto', 'featured', 'hidden'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.aitickets_external_events
    ADD CONSTRAINT aitickets_external_events_description_check CHECK (description IS NULL OR char_length(description) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE public.aitickets_external_events
    ADD CONSTRAINT aitickets_external_events_image_url_check CHECK (image_url IS NULL OR image_url ~ '^https://');
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

COMMENT ON COLUMN public.aitickets_external_events.public_status IS
  'Visibilidad en /panoramas: auto (si tiene función próxima), featured (destacado) o hidden (oculto).';

-- ---------------------------------------------------------------------------
-- Comentarios de asistentes ("¿Fuiste?") con comprobante, validados por el admin
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aitickets_panorama_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.aitickets_external_events(id) ON DELETE CASCADE,
  -- Función a la que fue (opcional; si el evento tiene una sola, esa)
  event_date_id bigint REFERENCES public.aitickets_external_event_dates(id) ON DELETE SET NULL,
  rating smallint NOT NULL,
  comment text NOT NULL,
  -- Cómo quiere aparecer (nombre o apodo). NULL = "Asistente verificado"
  display_name text,
  -- Nunca se publica: sirve para una sola opinión por persona y evento y para contactarla si hace falta
  email text NOT NULL,
  -- Comprobante en el bucket PRIVADO aitickets-panorama-proofs (solo URL firmada desde el MCP de admin)
  proof_path text,
  -- image | pdf | email
  proof_kind text,
  proof_content_type text,
  proof_bytes integer,
  -- Mismo archivo en dos opiniones = señal de fraude (el MCP lo marca)
  proof_sha256 text,
  -- pending (recién llegado) → approved (visible) | rejected; hidden = se bajó después de aprobado
  status text NOT NULL DEFAULT 'pending',
  -- Texto que se publica si el admin lo corrigió (p. ej. para quitar datos personales). NULL = comment
  public_comment text,
  -- Interno: por qué se rechazó o qué se revisó
  moderation_note text,
  moderated_at timestamptz,
  -- Fecha en que se borró el comprobante (minimización de datos)
  proof_deleted_at timestamptz,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aitickets_panorama_reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT aitickets_panorama_reviews_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'hidden')),
  CONSTRAINT aitickets_panorama_reviews_comment_check CHECK (char_length(comment) BETWEEN 1 AND 1500),
  CONSTRAINT aitickets_panorama_reviews_public_comment_check CHECK (public_comment IS NULL OR char_length(public_comment) <= 1500),
  CONSTRAINT aitickets_panorama_reviews_display_name_check CHECK (display_name IS NULL OR char_length(display_name) <= 60),
  CONSTRAINT aitickets_panorama_reviews_proof_kind_check CHECK (proof_kind IS NULL OR proof_kind IN ('image', 'pdf', 'email')),
  CONSTRAINT aitickets_panorama_reviews_proof_bytes_check CHECK (proof_bytes IS NULL OR proof_bytes > 0)
);

-- Una opinión por persona y evento (una rechazada se puede reenviar: se actualiza la misma fila)
CREATE UNIQUE INDEX IF NOT EXISTS aitickets_panorama_reviews_event_email_key
  ON public.aitickets_panorama_reviews (event_id, lower(email));
CREATE INDEX IF NOT EXISTS aitickets_panorama_reviews_status_created_idx
  ON public.aitickets_panorama_reviews (status, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_panorama_reviews_event_status_idx
  ON public.aitickets_panorama_reviews (event_id, status);
CREATE INDEX IF NOT EXISTS aitickets_panorama_reviews_proof_sha256_idx
  ON public.aitickets_panorama_reviews (proof_sha256) WHERE proof_sha256 IS NOT NULL;

ALTER TABLE public.aitickets_panorama_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_panorama_reviews FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bucket privado de comprobantes (5 MB, el tope de una función de Netlify; imagen, PDF o correo .eml). Solo se lee con
-- URL firmada de 15 min.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) -- lint:allow bucket propio de AI Tickets (aitickets-*), privado, solo si no existe
  VALUES (
    'aitickets-panorama-proofs',
    'aitickets-panorama-proofs',
    false,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'message/rfc822']
  )
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_column OR insufficient_privilege THEN
    RAISE NOTICE 'No se pudo crear el bucket aitickets-panorama-proofs (%): créalo a mano (privado)', SQLERRM;
END
$$;

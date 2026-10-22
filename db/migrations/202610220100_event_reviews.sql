-- Reseñas y calificaciones de eventos, fotos de los asistentes e invitación al próximo evento. Idempotente.
--
-- 1) events.review_settings (jsonb, NULL = valores por defecto; netlify/lib/reviews.mjs normalizeReviewSettings):
--      { "enabled": true,                               -- correo "¿Cómo estuvo?" 24 h después de cada función
--        "reward": { "value": 10, "valid_days": 60 },   -- % de descuento por calificar (null = sin premio)
--        "moderate_photos": false }                     -- true: las fotos esperan aprobación del productor
--
-- 2) aitickets_event_reviews: una reseña por persona (email) y evento. La escribe /api/reviews con un token de
--    reseña firmado (netlify/lib/review-token.mjs): llega en el correo de 24 h, se pide por correo desde la página
--    del evento o se obtiene con la orden/entrada. rating 1-5; public_comment se muestra en la página del evento
--    (si public_status = 'visible'); private_comment solo lo ve la productora. reward_code_id: código de descuento
--    (aitickets_discount_codes) entregado como premio por calificar, si la productora lo configuró.
--
-- 3) aitickets_event_review_photos: galería compartida de los asistentes (al final de la página del evento ya
--    terminado). status 'visible' | 'pending' (moderación previa) | 'hidden' (la ocultó la productora). Imágenes
--    del bucket público "Events" (carpeta event-attendee-photos/), optimizadas por src/lib/imageStorage.ts.
--
-- 4) aitickets_org_email_optouts: personas que pidieron no recibir más invitaciones de una productora (enlace de
--    baja de cada invitación, Ley 19.496 art. 28 B). Se respeta en cada envío de invitaciones.
--
-- 5) aitickets_scheduled_messages admite kind 'invitation': invitación masiva a los asistentes de un evento
--    (event_id) para un evento próximo de la misma productora (target_event_id), con audiencias nuevas
--    'checked_in' (ingresaron), 'reviewers' (calificaron) y 'promoters' (calificaron con 4 o 5). La entrega la
--    background function send-scheduled-messages-background (netlify/lib/scheduled-messages.mjs).
--
-- 6) aitickets_discount_codes.source: 'producer' (los crea la productora) | 'review_reward' (premio por calificar,
--    uno por reseña, un solo uso). Los premios no aparecen en la lista de códigos del panel/API ni cuentan para el
--    máximo de códigos por organización; se resumen en la sección de reseñas.
--
-- Deduplicación de correos en notification_log (sin tabla nueva): type 'review_request' (event_id = evento
-- reseñado) y 'next_event_invite' (event_id = evento al que se invita).
--
-- Todo: RLS sin políticas y REVOKE a anon/authenticated => solo la service role.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS review_settings jsonb;

COMMENT ON COLUMN public.events.review_settings IS
  'Reseñas: {enabled, reward: {value, valid_days} | null, moderate_photos}. NULL = valores por defecto.';

ALTER TABLE public.aitickets_discount_codes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'producer' CHECK (source IN ('producer', 'review_reward'));

COMMENT ON COLUMN public.aitickets_discount_codes.source IS
  'producer = creado por la productora; review_reward = premio por calificar un evento (uno por reseña).';

-- ---------------------------------------------------------------------------
-- Reseñas
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.aitickets_event_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  attendee_id bigint REFERENCES public.attendees(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  display_name text CHECK (display_name IS NULL OR char_length(display_name) <= 80),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  public_comment text CHECK (public_comment IS NULL OR char_length(public_comment) <= 1000),
  private_comment text CHECK (private_comment IS NULL OR char_length(private_comment) <= 2000),
  public_status text NOT NULL DEFAULT 'visible' CHECK (public_status IN ('visible', 'hidden')),
  verified_via text NOT NULL CHECK (verified_via IN ('email_link', 'order', 'ticket')),
  reward_code_id uuid REFERENCES public.aitickets_discount_codes(id) ON DELETE SET NULL,
  reward_code text CHECK (reward_code IS NULL OR char_length(reward_code) <= 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Una reseña por persona y evento (calificar de nuevo la actualiza): también es el on_conflict del upsert.
CREATE UNIQUE INDEX IF NOT EXISTS aitickets_event_reviews_event_email_idx
  ON public.aitickets_event_reviews (event_id, email);
CREATE INDEX IF NOT EXISTS aitickets_event_reviews_event_created_idx
  ON public.aitickets_event_reviews (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aitickets_event_reviews_org_idx
  ON public.aitickets_event_reviews (organization_id, created_at DESC);

ALTER TABLE public.aitickets_event_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_reviews TO service_role;

COMMENT ON TABLE public.aitickets_event_reviews IS
  'Reseñas de asistentes (1-5 estrellas, comentario público y privado para la productora). Solo service role.';

-- ---------------------------------------------------------------------------
-- Fotos de los asistentes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.aitickets_event_review_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id bigint NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  display_name text CHECK (display_name IS NULL OR char_length(display_name) <= 80),
  url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 1000),
  thumb_url text CHECK (thumb_url IS NULL OR (thumb_url ~ '^https://' AND char_length(thumb_url) <= 1000)),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'pending', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aitickets_event_review_photos_event_idx
  ON public.aitickets_event_review_photos (event_id, status, created_at);
CREATE INDEX IF NOT EXISTS aitickets_event_review_photos_event_email_idx
  ON public.aitickets_event_review_photos (event_id, email);

ALTER TABLE public.aitickets_event_review_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_event_review_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_event_review_photos TO service_role;

COMMENT ON TABLE public.aitickets_event_review_photos IS
  'Galería compartida: fotos que suben los asistentes de un evento terminado. Solo service role.';

-- ---------------------------------------------------------------------------
-- Bajas de invitaciones por productora
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.aitickets_org_email_optouts (
  organization_id bigint NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  source text NOT NULL DEFAULT 'unsubscribe_link' CHECK (source IN ('unsubscribe_link', 'one_click', 'producer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, email)
);

ALTER TABLE public.aitickets_org_email_optouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_org_email_optouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_org_email_optouts TO service_role;

COMMENT ON TABLE public.aitickets_org_email_optouts IS
  'Emails que no quieren más invitaciones de una productora (enlace de baja). Solo service role.';

-- ---------------------------------------------------------------------------
-- Invitaciones masivas en la cola de mensajes del productor
-- ---------------------------------------------------------------------------

ALTER TABLE public.aitickets_scheduled_messages
  ADD COLUMN IF NOT EXISTS target_event_id bigint REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE public.aitickets_scheduled_messages DROP CONSTRAINT IF EXISTS aitickets_scheduled_messages_kind_check;
ALTER TABLE public.aitickets_scheduled_messages
  ADD CONSTRAINT aitickets_scheduled_messages_kind_check CHECK (kind IN ('message', 'reminder', 'invitation'));

ALTER TABLE public.aitickets_scheduled_messages DROP CONSTRAINT IF EXISTS aitickets_scheduled_messages_audience_check;
ALTER TABLE public.aitickets_scheduled_messages
  ADD CONSTRAINT aitickets_scheduled_messages_audience_check
  CHECK (audience IN ('all', 'not_checked_in', 'checked_in', 'reviewers', 'promoters'));

ALTER TABLE public.aitickets_scheduled_messages DROP CONSTRAINT IF EXISTS aitickets_scheduled_messages_invitation_target_check;
ALTER TABLE public.aitickets_scheduled_messages
  ADD CONSTRAINT aitickets_scheduled_messages_invitation_target_check
  CHECK (kind <> 'invitation' OR target_event_id IS NOT NULL);

COMMENT ON COLUMN public.aitickets_scheduled_messages.target_event_id IS
  'kind = invitation: evento al que se invita a los asistentes de event_id.';

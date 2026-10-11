-- Invitados por WhatsApp y links de escáner.
--
-- 1. aitickets_guests.status 'link_ready': send_invitations con WhatsApp solo PREPARA el link wa.me (AI Tickets no
--    envía WhatsApp). El invitado queda 'link_ready' hasta que el productor confirma el envío
--    (mark_guests_invited) y pasa a 'invited'.
-- 2. aitickets_checkin_links.last_opened_at: abrir el escáner ya no mueve last_used_at (que queda como el
--    último escaneo).

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.aitickets_guests'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%' AND pg_get_constraintdef(oid) LIKE '%invited%'
       AND pg_get_constraintdef(oid) NOT LIKE '%link_ready%'
  LOOP
    EXECUTE format('ALTER TABLE public.aitickets_guests DROP CONSTRAINT %I', c.conname); -- lint:allow restricción de estado de aitickets_guests
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.aitickets_guests'::regclass AND conname = 'aitickets_guests_status_v2_check') THEN
    ALTER TABLE public.aitickets_guests ADD CONSTRAINT aitickets_guests_status_v2_check
      CHECK (status IN ('pending', 'link_ready', 'invited', 'removed'));
  END IF;
END $$;

ALTER TABLE public.aitickets_checkin_links ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;

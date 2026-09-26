-- WP7: aceptación de términos del productor y verificación de correo de la organización.
-- Idempotente. Solo toca public.organizations (tabla de AI Tickets).
--
-- terms_version / terms_accepted_at: versión de /terminos-productores aceptada al registrarse.
-- email_verified_at: el registrante confirmó su correo con el enlace firmado (EMAIL_VERIFY_SECRET).
--   /api/auth/login rechaza el ingreso mientras sea NULL y los sitios (aitickets_sites) solo se
--   muestran cuando está definido.
--
-- Las organizaciones existentes se crearon con email_confirm:true (sin verificación): se marcan como
-- verificadas SOLO cuando la columna se crea en esta migración, para que una re-ejecución nunca
-- verifique cuentas nuevas que están pendientes.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS terms_version text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE public.organizations ADD COLUMN email_verified_at timestamptz;
    UPDATE public.organizations SET email_verified_at = coalesce(created_at, now());
  END IF;
END $$;

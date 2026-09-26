-- Sitios (WP4) — endurecimiento. Idempotente. Solo toca tablas de AI Tickets.
--
-- 1) organizations.email_verified_for: dirección que la organización PROBÓ controlar (enlace firmado de
--    /organizadores/verificar). organizations.email se puede editar libremente desde el dashboard, así
--    que el formulario de contacto del sitio y los avisos de dominio solo escriben a contact_email
--    (confirmado por enlace) o a esta columna, nunca a organizations.email sin verificar.
--    Backfill SOLO cuando la columna se crea aquí: las organizaciones ya verificadas (incluidas las
--    heredadas que 202609270400 marcó como verificadas) quedan con su correo actual.
--
-- 2) aitickets_sites.domain_verification ya es jsonb: removeSiteDomain solo quita el alias de Netlify
--    si domain_verification.attached_at está definido (lo agregó AI Tickets). No requiere DDL.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'email_verified_for'
  ) THEN
    ALTER TABLE public.organizations ADD COLUMN email_verified_for text;
    UPDATE public.organizations
       SET email_verified_for = lower(trim(email))
     WHERE email_verified_at IS NOT NULL
       AND email IS NOT NULL
       AND trim(email) <> '';
  END IF;
END $$;

-- Registro en dos pasos: correo (o Google) primero y, después de verificarlo, el nombre de la productora.
-- Idempotente. Solo toca public.organizations (tabla de AI Tickets).
--
-- onboarding_pending = true: la organización se creó con un nombre provisorio y el panel pide el nombre
-- real (/organizadores/bienvenida) antes de seguir. Las organizaciones existentes quedan en false.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS onboarding_pending boolean NOT NULL DEFAULT false;

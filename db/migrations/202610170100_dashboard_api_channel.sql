-- Bitácora de la API de productores: el panel (/dashboard) ahora ejecuta herramientas con la sesión del
-- usuario (p. ej. "Solicitar retiro"), así que la columna channel acepta también 'dashboard'.
ALTER TABLE public.aitickets_api_audit DROP CONSTRAINT IF EXISTS aitickets_api_audit_channel_check;
ALTER TABLE public.aitickets_api_audit
  ADD CONSTRAINT aitickets_api_audit_channel_check CHECK (channel IN ('mcp', 'rest', 'dashboard'));

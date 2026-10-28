-- Herramientas que el productor agregó al detalle del evento desde "Más herramientas". Idempotente.
--
-- Por defecto cada módulo se muestra según el perfil del evento (su categoría) y sus condiciones; esta columna guarda
-- los que se agregaron aparte: ["<id del módulo>", ...]. NULL = solo los del tipo de evento. Código:
-- src/lib/eventModules.ts y /api/events/modules.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS panel_modules jsonb;

COMMENT ON COLUMN public.events.panel_modules IS
  'Herramientas agregadas al panel del evento: [id, ...] (src/lib/eventModules.ts). NULL = solo las del tipo de evento.';

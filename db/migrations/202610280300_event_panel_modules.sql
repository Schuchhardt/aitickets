-- Módulos del detalle del evento en el panel que el productor activó o apagó a mano ("Más herramientas"). Idempotente.
--
-- Por defecto cada módulo se muestra según el perfil del evento (su categoría) y sus condiciones; esta columna guarda
-- solo las excepciones: {"<id del módulo>": true|false}. NULL = todo por defecto. Código: src/lib/eventModules.ts y
-- /api/events/modules.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS panel_modules jsonb;

COMMENT ON COLUMN public.events.panel_modules IS
  'Módulos del panel activados o apagados a mano: {id: boolean} (src/lib/eventModules.ts). NULL = por defecto según la categoría.';

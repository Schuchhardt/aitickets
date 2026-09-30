-- Lugares (venues) por organización.
--
-- venues es compartida por todas las organizaciones y no tenía dueño: los formularios de crear/editar
-- evento listaban los lugares de otras productoras y la API aceptaba cualquier venueId. Se agrega
-- venues.organization_id (nullable). Los lugares nuevos se crean con la organización del productor.
--
-- Backfill: un lugar usado (vía event_locations) por eventos de UNA sola organización pasa a ser de
-- esa organización. Los usados por varias organizaciones, o por ninguna, quedan en NULL: la app los
-- sigue mostrando a cada organización que ya los usa en sus eventos (y a ninguna otra).
--
-- Expand-only e idempotente. El código tolera que la columna no exista (deploy previews).

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS organization_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venues_organization_id_fkey' AND conrelid = 'public.venues'::regclass
  ) THEN
    ALTER TABLE public.venues
      ADD CONSTRAINT venues_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS venues_organization_id_idx ON public.venues (organization_id);

UPDATE public.venues v
SET organization_id = owner.organization_id
FROM (
  SELECT el.venue_id, min(e.organization_id) AS organization_id
  FROM public.event_locations el
  JOIN public.events e ON e.id = el.event_id
  WHERE e.organization_id IS NOT NULL
  GROUP BY el.venue_id
  HAVING count(DISTINCT e.organization_id) = 1
) owner
WHERE v.id = owner.venue_id
  AND v.organization_id IS NULL;

COMMENT ON COLUMN public.venues.organization_id IS
  'Organización dueña del lugar (NULL = legado/compartido; visible solo para organizaciones que lo usan en sus eventos).';

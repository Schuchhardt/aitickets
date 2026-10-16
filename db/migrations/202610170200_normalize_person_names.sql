-- Nombres de personas siempre normalizados: "  jaVier  " => "Javier", "o'brien" => "O'Brien",
-- "maría de los ángeles" => "María de los Ángeles". El código ya normaliza al escribir
-- (normalizePersonName en netlify/lib/buyer-name.mjs, con la MISMA regla); estos triggers son el respaldo para
-- cualquier otro camino de escritura, y el UPDATE final normaliza los registros que ya existían.
-- Tablas: attendees (first_name, last_name), event_orders (buyer_first_name, buyer_last_name) y
-- aitickets_guests (name).

-- Regla: recorta, colapsa espacios, cada palabra en minúscula con mayúscula inicial en cada tramo alfanumérico
-- (initcap), y los conectores de/del/la/las/los/y en minúscula salvo la primera palabra. p_continuation = true
-- (apellidos) los deja en minúscula también al inicio ("de la fuente" => "de la Fuente"). NULL sigue NULL.
CREATE OR REPLACE FUNCTION public.aitickets_normalize_person_name(p_name text, p_continuation boolean DEFAULT false)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_name IS NULL THEN NULL ELSE coalesce((
    SELECT string_agg(
      CASE
        WHEN (u.ord > 1 OR p_continuation) AND lower(u.w) IN ('de', 'del', 'la', 'las', 'los', 'y') THEN lower(u.w)
        ELSE initcap(lower(u.w))
      END, ' ' ORDER BY u.ord)
    FROM unnest(string_to_array(btrim(regexp_replace(normalize(p_name, NFC), '\s+', ' ', 'g')), ' ')) WITH ORDINALITY AS u(w, ord)
    WHERE u.w <> ''
  ), '') END
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_normalize_person_name(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_normalize_person_name(text, boolean) TO service_role;

-- attendees
CREATE OR REPLACE FUNCTION public.aitickets_attendees_normalize_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.first_name := aitickets_normalize_person_name(NEW.first_name);
  NEW.last_name := aitickets_normalize_person_name(NEW.last_name, true);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_attendees_normalize_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_attendees_normalize_names() TO service_role;

DROP TRIGGER IF EXISTS aitickets_attendees_normalize_names ON public.attendees;
CREATE TRIGGER aitickets_attendees_normalize_names
  BEFORE INSERT OR UPDATE OF first_name, last_name ON public.attendees
  FOR EACH ROW EXECUTE FUNCTION public.aitickets_attendees_normalize_names();

-- event_orders (solo cuando cambian los nombres: la orden se actualiza seguido por el estado del pago)
CREATE OR REPLACE FUNCTION public.aitickets_event_orders_normalize_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.buyer_first_name := aitickets_normalize_person_name(NEW.buyer_first_name);
  NEW.buyer_last_name := aitickets_normalize_person_name(NEW.buyer_last_name, true);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_event_orders_normalize_names() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_event_orders_normalize_names() TO service_role;

DROP TRIGGER IF EXISTS aitickets_event_orders_normalize_names ON public.event_orders;
CREATE TRIGGER aitickets_event_orders_normalize_names
  BEFORE INSERT OR UPDATE OF buyer_first_name, buyer_last_name ON public.event_orders
  FOR EACH ROW EXECUTE FUNCTION public.aitickets_event_orders_normalize_names();

-- aitickets_guests (name es NOT NULL con largo 1..150: si queda vacío se deja como venía y lo rechaza el CHECK)
CREATE OR REPLACE FUNCTION public.aitickets_guests_normalize_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := coalesce(nullif(aitickets_normalize_person_name(NEW.name), ''), NEW.name);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.aitickets_guests_normalize_name() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_guests_normalize_name() TO service_role;

DROP TRIGGER IF EXISTS aitickets_guests_normalize_name ON public.aitickets_guests;
CREATE TRIGGER aitickets_guests_normalize_name
  BEFORE INSERT OR UPDATE OF name ON public.aitickets_guests
  FOR EACH ROW EXECUTE FUNCTION public.aitickets_guests_normalize_name();

-- Registros existentes (solo las filas que cambian)
UPDATE public.attendees
SET first_name = aitickets_normalize_person_name(first_name),
    last_name = aitickets_normalize_person_name(last_name, true)
WHERE first_name IS DISTINCT FROM aitickets_normalize_person_name(first_name)
   OR last_name IS DISTINCT FROM aitickets_normalize_person_name(last_name, true);

UPDATE public.event_orders
SET buyer_first_name = aitickets_normalize_person_name(buyer_first_name),
    buyer_last_name = aitickets_normalize_person_name(buyer_last_name, true)
WHERE buyer_first_name IS DISTINCT FROM aitickets_normalize_person_name(buyer_first_name)
   OR buyer_last_name IS DISTINCT FROM aitickets_normalize_person_name(buyer_last_name, true);

UPDATE public.aitickets_guests
SET name = aitickets_normalize_person_name(name)
WHERE aitickets_normalize_person_name(name) <> ''
  AND name IS DISTINCT FROM aitickets_normalize_person_name(name);

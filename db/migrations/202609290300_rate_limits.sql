-- Límites de tasa DURABLES (compartidos entre instancias serverless). Idempotente.
-- Solo crea public.aitickets_rate_limits y public.aitickets_rate_limit_hit (proyecto Supabase compartido).
--
-- Ventana fija: cada (bucket, key_hash) cuenta los intentos de la ventana actual de p_window_seconds.
-- key_hash es el sha256 (hex) de la clave (IP, email, IP+sitio): nunca se guarda la IP ni el email en claro.
-- Lo usa netlify/lib/rate-limit.mjs (rateLimit), que falla ABIERTO si la función no existe o da error
-- (queda el límite en memoria de cada instancia como respaldo).
-- RLS activado SIN políticas + REVOKE ALL a anon/authenticated => solo la service role.

CREATE TABLE IF NOT EXISTS public.aitickets_rate_limits (
  bucket text NOT NULL,
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key_hash, window_start)
);
ALTER TABLE public.aitickets_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aitickets_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aitickets_rate_limits TO service_role;

-- Para la limpieza de ventanas viejas
CREATE INDEX IF NOT EXISTS aitickets_rate_limits_window_idx
  ON public.aitickets_rate_limits (window_start);

-- Registra un intento y devuelve true si está permitido (count <= p_max en la ventana actual).
-- Atómico: INSERT ... ON CONFLICT DO UPDATE bloquea la fila, así que dos llamadas simultáneas nunca
-- leen el mismo contador. De vez en cuando (~1% de las llamadas) borra las ventanas de más de 1 día.
CREATE OR REPLACE FUNCTION public.aitickets_rate_limit_hit(
  p_bucket text,
  p_key_hash text,
  p_window_seconds int,
  p_max int
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_seconds int := greatest(coalesce(p_window_seconds, 60), 1);
  v_window_start timestamptz;
  v_count int;
BEGIN
  IF p_bucket IS NULL OR p_bucket = '' OR p_key_hash IS NULL OR p_key_hash = '' THEN
    RAISE EXCEPTION 'aitickets_rate_limit_hit: bucket y key_hash son obligatorios';
  END IF;
  IF length(p_bucket) > 64 OR length(p_key_hash) > 128 THEN
    RAISE EXCEPTION 'aitickets_rate_limit_hit: bucket o key_hash demasiado largos';
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch FROM clock_timestamp()) / v_window_seconds) * v_window_seconds);

  INSERT INTO public.aitickets_rate_limits AS rl (bucket, key_hash, window_start, count)
  VALUES (p_bucket, p_key_hash, v_window_start, 1)
  ON CONFLICT (bucket, key_hash, window_start)
  DO UPDATE SET count = rl.count + 1
  RETURNING rl.count INTO v_count;

  IF random() < 0.01 THEN
    DELETE FROM public.aitickets_rate_limits WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN v_count <= greatest(coalesce(p_max, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.aitickets_rate_limit_hit(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aitickets_rate_limit_hit(text, text, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aitickets_rate_limit_hit(text, text, int, int) TO service_role;

-- Bucket privado para los comprobantes de transferencia de los retiros (upload_payout_receipt / get_payout_receipt
-- del MCP de admin). El código lo usaba desde el ciclo de pagos (#84) pero ninguna migración lo creaba, así que
-- subir un comprobante fallaba con "Bucket not found". Privado: solo se lee con URL firmada de 15 min.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) -- lint:allow bucket propio de AI Tickets (aitickets-*), privado, solo si no existe
  VALUES ('aitickets-payout-receipts', 'aitickets-payout-receipts', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png'])
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR undefined_column OR insufficient_privilege THEN
    RAISE NOTICE 'No se pudo crear el bucket aitickets-payout-receipts (%): créalo a mano (privado)', SQLERRM;
END
$$;

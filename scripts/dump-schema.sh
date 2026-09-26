#!/usr/bin/env bash
# Regenera un snapshot del esquema de las tablas de AI Tickets desde la base REAL (solo lectura).
#
#   SUPABASE_DB_URL=postgresql://... scripts/dump-schema.sh [archivo_salida]
#   (o: set -a; source .env; set +a; scripts/dump-schema.sh)
#
# - Usa SUPABASE_DB_URL o, si no está, DATABASE_URL. Un host directo db.<ref>.supabase.co (solo IPv6)
#   se reescribe al session pooler (puerto 5432, usuario postgres.<ref>) con scripts/migrate.mjs.
#   Rechaza el transaction pooler (6543).
# - pg_dump --schema-only: no lee datos ni escribe nada en la base.
# - El proyecto de Supabase es COMPARTIDO: solo se vuelcan las tablas de AI Tickets (lista de
#   db/migrations/20260926_Z_lockdown_rls.sql + organization_payout_accounts) y las aitickets_*.
# - Por defecto escribe db/schema.live.sql (NO pisa db/schema.sql, que es el snapshot de referencia
#   curado que usa la CI). Revisa el diff y copia a mano lo que corresponda.
set -euo pipefail

cd "$(dirname "$0")/.."

RAW_URL="${SUPABASE_DB_URL:-${DATABASE_URL:-}}"
if [[ -z "$RAW_URL" ]]; then
  echo "Falta SUPABASE_DB_URL (o DATABASE_URL)." >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "Falta pg_dump (instala el cliente de PostgreSQL, versión >= a la del servidor)." >&2
  exit 1
fi

OUT="${1:-db/schema.live.sql}"

DB_URL="$(RAW_URL="$RAW_URL" node --input-type=module -e "
  const m = await import('./scripts/migrate.mjs');
  const url = m.toSessionPoolerUrl(process.env.RAW_URL);
  m.assertSessionPoolerUrl(url);
  process.stdout.write(url);
")"

# Tablas de AI Tickets de la línea base: se leen de la migración Z para no duplicar la lista.
BASE_TABLES="$(sed -n "/aitickets_tables text\[\] := ARRAY\[/,/\];/p" db/migrations/20260926_Z_lockdown_rls.sql \
  | grep -o "'[a-z_]*'" | tr -d "'")"

ARGS=()
for t in $BASE_TABLES organization_payout_accounts; do
  ARGS+=(--table="public.${t}")
done
# Tablas y secuencias nuevas con prefijo aitickets_ (patrón de pg_dump)
ARGS+=(--table='public.aitickets_*')

if [[ -z "$BASE_TABLES" ]]; then
  echo "No se pudo leer la lista de tablas desde 20260926_Z_lockdown_rls.sql." >&2
  exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Volcando esquema (solo lectura) de $(echo "$BASE_TABLES" | wc -w | tr -d ' ') tablas base + aitickets_* ..." >&2
PGAPPNAME=aitickets-dump-schema PGSSLMODE="${PGSSLMODE:-require}" pg_dump \
  --schema-only --no-owner --no-privileges --no-comments \
  "${ARGS[@]}" \
  --dbname="$DB_URL" > "$TMP"

{
  echo "-- NO EJECUTAR EN PRODUCCIÓN: snapshot generado desde la base real con scripts/dump-schema.sh"
  echo "-- $(date -u +%Y-%m-%dT%H:%M:%SZ). La fuente de verdad es db/migrations."
  echo "-- Funciones aitickets_* no incluidas (pg_dump --table no las vuelca): ver db/migrations."
  echo
  cat "$TMP"
} > "$OUT"

echo "Listo: $OUT" >&2

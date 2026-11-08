#!/usr/bin/env bash
# Arma una base de AI Tickets desde el repo, igual que la CI: stubs de Supabase + db/schema.sql + organización 1 +
# todas las migraciones. NUNCA contra Supabase: solo una base desechable (postgres:15 de la CI o un contenedor local).
#
# Uso:  PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... SUPABASE_DB_URL=postgresql://... scripts/db-ci-setup.sh
#       scripts/db-ci-setup.sh --docker   levanta postgres:15 en el puerto 55433 (contenedor aitickets-ci-db) y lo usa
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--docker" ]]; then
  docker rm -f aitickets-ci-db >/dev/null 2>&1 || true
  docker run -d --name aitickets-ci-db -e POSTGRES_HOST_AUTH_METHOD=trust -p 55433:5432 postgres:15 >/dev/null
  export PGHOST=127.0.0.1 PGPORT=55433 PGUSER=postgres PGDATABASE=postgres
  export SUPABASE_DB_URL="postgresql://postgres@127.0.0.1:55433/postgres"
  for _ in $(seq 1 60); do pg_isready -q && break; sleep 1; done
  echo "postgres:15 listo en $SUPABASE_DB_URL"
fi

host="${PGHOST:-}"
case "$host" in
  ""|localhost|127.0.0.1|::1|/*) ;;
  *) echo "db-ci-setup: PGHOST=$host no es local; este script solo arma bases desechables" >&2; exit 1 ;;
esac

psql -v ON_ERROR_STOP=1 -q -f db/ci/stubs.sql
psql -v ON_ERROR_STOP=1 -q -f db/schema.sql
psql -v ON_ERROR_STOP=1 -q -c "INSERT INTO public.organizations (id, public_name) VALUES (1, 'AI Tickets')"
node scripts/migrate.mjs --no-baseline

# Migraciones de base de datos

El proyecto de Supabase es **compartido** con otras apps. Las migraciones de AI Tickets solo pueden
tocar objetos de AI Tickets y la fuente de verdad del esquema es esta carpeta. `db/schema.sql` es solo
referencia (y la base que carga la CI): **nunca** se ejecuta contra producción.

## Cómo se aplican

- En cada deploy de **producción** de Netlify, el plugin local `plugins/db-migrate` ejecuta
  `scripts/migrate.mjs` en `onPostBuild`: después del build y del bundling de funciones, antes del
  deploy. Si una migración falla, el build falla y el deploy no ocurre.
- Deploy previews y branch deploys **nunca** migran (log: `skip migrations: context deploy-preview`).
  Comparten la BD de producción, así que el código nuevo debe tolerar columnas/funciones que todavía no
  existen cuando sea barato hacerlo (capturar el error y degradar).
- Conexión: `SUPABASE_DB_URL` (scope *Builds*, contexto *Production*), la cadena del **Session pooler**
  de Supavisor, puerto **5432**, usuario `postgres.<ref>`. El puerto 6543 (transaction pooler) se
  rechaza. Si se usa el host directo `db.<ref>.supabase.co` (solo IPv6) el runner lo reescribe al pooler
  `aws-0-sa-east-1.pooler.supabase.com:5432`.
- Un advisory lock (`pg_try_advisory_lock(hashtext('aitickets:migrations'))`, reintentos hasta 60 s)
  evita dos migraciones simultáneas.
- Cada archivo corre en su propia transacción con `lock_timeout = 5s` y `statement_timeout = 120s`.
  Si la primera línea es `-- migrate:no-transaction` corre fuera de transacción (p. ej.
  `CREATE INDEX CONCURRENTLY`); úsalo solo cuando sea imprescindible y deja el archivo idempotente.
- El ledger es propio: `public.aitickets_schema_migrations(filename, checksum, applied_at, duration_ms,
  applied_by)`, con RLS activado y sin permisos para `anon`/`authenticated`. No se usa el historial de la
  Supabase CLI (lo comparten otras apps).

Variables del plugin: `MIGRATE_ON_BUILD=false` lo desactiva; `ALLOW_MISSING_DB_URL=true` (solo para el
primer deploy, antes de configurar `SUPABASE_DB_URL`) avisa en vez de fallar.

## Convención de nombres

`YYYYMMDDHHMM_<slug>.sql`. El runner solo toma archivos que cumplen `/^\d{8,12}_.+\.sql$/` y los aplica
en **orden lexicográfico**. Nombres reservados para evitar choques entre paquetes:

| Prefijo        | Dueño | Contenido                                   |
| -------------- | ----- | ------------------------------------------- |
| `20260926_*`   | —     | Línea base (ver abajo). Inmutables.         |
| `202609270100` | WP2   | Proveedor de pago en `event_orders`         |
| `202609270110` | WP2   | Funciones de reserva atómica de stock       |
| `202609270200` | WP3   | Sitios de productores                       |
| `202609270250` | WP4   | (si hace falta) dominios/banners            |
| `202609270300` | WP5   | Outreach                                    |
| `202609270400` | WP7   | Términos de productores y verificación      |
| `202609270500` | WP4   | Sitios: correo verificado de la organización (`email_verified_for`) |
| `202609270600+`| lead  | Siguientes                                  |

## Reglas

1. **Expand/contract.** Una migración debe ser compatible con el código que está desplegado en ese
   momento (el deploy ocurre después de migrar y los previews usan la misma BD). Nunca `DROP` ni
   `RENAME` en el mismo deploy que deja de usar el objeto: primero se despliega el código que ya no lo
   usa, y la eliminación va en una migración posterior.
2. **Un archivo aplicado es inmutable.** Si cambia su checksum (sha256, CRLF normalizado) el deploy
   falla con `migración ya aplicada fue editada; crea una nueva`. Para corregir algo, crea otro archivo.
3. **Idempotente**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`,
   `DROP ... IF EXISTS`, bloques `DO` con chequeos en `pg_constraint`, etc.
4. **Solo objetos de AI Tickets.** Tablas y funciones nuevas con prefijo `aitickets_`. Tablas nuevas:
   `ENABLE ROW LEVEL SECURITY`, sin políticas y `REVOKE ALL ... FROM anon, authenticated` (explícito:
   no basta con `PUBLIC`, Supabase otorga permisos por defecto directamente a esos roles). Funciones:
   `SECURITY DEFINER`, `SET search_path = public`, `REVOKE EXECUTE ... FROM PUBLIC, anon,
   authenticated` y `GRANT EXECUTE ... TO service_role`.
5. La CI (`.github/workflows/ci.yml`) verifica:
   - `npm run db:lint` (`scripts/lint-migrations.mjs`): falla con `DROP`/`ALTER`/`TRUNCATE` fuera de la
     allowlist (tablas de AI Tickets de `20260926_Z_lockdown_rls.sql`, `organization_payout_accounts`
     y `aitickets_*`), con referencias a `auth.`/`storage.`/`extensions.` que no sean una FK, y con
     tablas/funciones nuevas sin prefijo `aitickets_`. Para SQL dinámico revisado a mano, agrega
     `-- lint:allow <motivo>` en esa línea.
   - Que todas las migraciones se aplican sobre `postgres:15` + `db/ci/stubs.sql` + `db/schema.sql`, y
     que una segunda pasada aplica 0.
   - `db/ci/assert-grants.sql`: `anon`/`authenticated` sin privilegios sobre tablas ni funciones de
     `public`, RLS activo en todas las tablas y `SECURITY DEFINER` siempre con `search_path`.

## Rollback de código: estados nuevos de `event_orders.status`

`event_orders.status` es `text` sin enum ni CHECK, así que los estados nuevos no necesitan migración y
volver a un deploy anterior (instant rollback de Netlify) no rompe la base. El código nuevo escribe dos
valores que el código de `main` anterior a `feat/autonomy` no conoce:

- `expired`: lo escribe `expire-pending-orders` cuando vence la reserva de una orden `pending`.
- `refunded`: reservado para reembolsos totales (con las entradas anuladas con
  `event_attendees.status = 'cancelled'`). Hoy ningún código lo escribe automáticamente; puede haber
  órdenes históricas con este estado.

El código anterior **ignora** esos estados y los trata como no pagados: todas sus lecturas de ventas,
ingresos, CSV, reenvío de correo y dashboards filtran `status = 'paid'` (`.eq('status','paid')` o
`=== 'paid'`), el conteo de stock solo suma entradas no anuladas y órdenes `pending`/`processing`, y
`confirm-ticket` rechaza entradas que no estén `active`. Un estado desconocido nunca cuenta como venta ni
emite entradas. Regla para cambios futuros: todo código que decida "pagada" debe comparar con `'paid'`
explícitamente (nunca "distinto de failed/cancelled"), y los estados nuevos se documentan aquí.

**Salvedad (pago tardío tras un rollback).** El webhook de Flow de `main` solo reclama
`pending/failed/rejected/cancelled`; el código nuevo además reclama `expired`. Si se vuelve a `main` y
llega tarde un pago de Flow de una orden ya marcada `expired`, `main` responde 503 en cada reintento sin
marcarla pagada ni en `review` y sin avisar por Slack (el comprador pagó y no tiene entradas).
**Runbook de rollback** (ejecutar justo después de volver al código anterior, en el SQL editor de
Supabase; es idempotente y conserva el significado "no pagada, stock liberado"):

```sql
UPDATE public.event_orders SET status = 'cancelled' WHERE status = 'expired';
-- Revisar a mano órdenes con pago registrado que quedaron sin cumplir:
SELECT id, event_id, status, payment_provider, payment_external_id, created_at
FROM public.event_orders
WHERE status IN ('cancelled', 'review', 'refunded') AND total_payment IS NOT NULL
ORDER BY created_at DESC LIMIT 50;
```

`refunded` no necesita acción: sus entradas ya están anuladas. Al volver a desplegar el código nuevo no hay que deshacer nada (`cancelled` también es
reclamable por un pago tardío).

## Línea base

Las migraciones `20260926_A0/B/C/D/Z` se aplicaron a mano antes de que existiera el runner. Con el ledger
vacío, el runner las registra como `applied_by = 'baseline'` **sin ejecutarlas**, solo si pasan estas
comprobaciones de solo lectura:

- existe `organization_payout_accounts`;
- existen `event_tickets.event_date_id` y `event_orders.processing_started_at`;
- no hay políticas en `pg_policies` para `users`, `organizations` ni `events`;
- `events` tiene RLS activo.

Si alguna falla, aborta con la explicación (Z borra políticas de tablas con nombres genéricos en un
proyecto compartido, así que nunca se re-ejecuta automáticamente). En una BD vacía (CI o local) usa
`--no-baseline` para ejecutarlas todas.

## Uso local

Node no carga `.env` solo; pásalo explícitamente:

```sh
node --env-file=.env scripts/migrate.mjs --status             # solo lectura: aplicadas/pendientes
node --env-file=.env scripts/migrate.mjs --dry-run            # todo en una transacción + ROLLBACK
npm run db:lint                                               # lint de las migraciones
```

`npm run db:status`, `npm run db:migrate` y `npm run db:baseline` son equivalentes (leen
`SUPABASE_DB_URL` o `DATABASE_URL` del entorno). `--status --fail-on-pending` sale con código 2 si queda
algo pendiente. Aplicar migraciones en producción desde local no es el flujo normal: deja que lo haga el
deploy.

Para probar en una BD desechable:

```sh
createdb aitickets_test
psql -d aitickets_test -f db/ci/stubs.sql -f db/schema.sql
SUPABASE_DB_URL=postgresql://postgres@localhost:5432/aitickets_test node scripts/migrate.mjs --no-baseline
psql -d aitickets_test -f db/ci/assert-grants.sql
```

## Historial: migraciones del 2026-09-26 (aplicadas a mano)

0. `20260926_A0_urgent_policies.sql`: elimina la política de UPDATE de `users` sin `WITH CHECK` y las de
   escritura de `organizations`.
1. `20260926_B_orders.sql`: columnas nuevas en `event_orders` (atribución, datos del comprador, control
   del email) más índices.
2. `20260926_C_dashboard.sql`: tabla `organization_payout_accounts` (RLS sin políticas) y atribución de
   registro en `organizations`.
3. `20260926_D_functions.sql`: `event_tickets.event_date_id` (entradas por función).
4. `20260926_Z_lockdown_rls.sql`: RLS sin políticas y `REVOKE` a `anon`/`authenticated` en todas las
   tablas de AI Tickets; limpia `event_visits.ip_raw`.

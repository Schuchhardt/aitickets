#!/usr/bin/env node
// Runner de migraciones de AI Tickets.
//
// Aplica db/migrations/YYYYMMDDHHMM_<slug>.sql en orden lexicográfico, una transacción por archivo,
// con ledger propio (public.aitickets_schema_migrations) y advisory lock. Lo usa el plugin de build
// plugins/db-migrate (solo CONTEXT=production) y la CI (postgres desechable).
//
// El proyecto de Supabase es COMPARTIDO con otras apps: nunca se usa el historial de la Supabase CLI
// (supabase_migrations) y las migraciones solo pueden tocar objetos de AI Tickets.
//
// Uso:
//   node --env-file=.env scripts/migrate.mjs            aplica las pendientes
//   node --env-file=.env scripts/migrate.mjs --status   solo lectura: aplicadas/pendientes
//   node scripts/migrate.mjs --dry-run                  todo en una transacción y ROLLBACK
//   node scripts/migrate.mjs --no-baseline              ejecuta también 20260926_* (CI con BD vacía)
//   node scripts/migrate.mjs --baseline-only            solo registra la línea base, no ejecuta nada
//   node scripts/migrate.mjs --status --fail-on-pending sale con código 2 si queda algo pendiente
//
// Conexión: SUPABASE_DB_URL ?? DATABASE_URL. Debe ser el session pooler de Supavisor (puerto 5432).
// El host directo db.<ref>.supabase.co es solo IPv6 y se reescribe al pooler. El puerto 6543
// (transaction pooler) se rechaza: rompe advisory locks y transacciones multi-sentencia.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATION_FILE_RE = /^\d{8,12}_.+\.sql$/;
export const LEDGER_TABLE = 'public.aitickets_schema_migrations';
export const LOCK_KEY = 'aitickets:migrations';
export const NO_TRANSACTION_MARKER = '-- migrate:no-transaction';
export const DEFAULT_POOLER_HOST = 'aws-0-sa-east-1.pooler.supabase.com';

// Migraciones ya aplicadas a mano en producción antes de que existiera el runner.
// Con el ledger vacío se registran como 'baseline' sin ejecutarse (ver sanity checks).
export const BASELINE_FILES = [
  '20260926_A0_urgent_policies.sql',
  '20260926_B_orders.sql',
  '20260926_C_dashboard.sql',
  '20260926_D_functions.sql',
  '20260926_Z_lockdown_rls.sql'
];

const LOCK_RETRY_MS = 2000;
const LOCK_MAX_WAIT_MS = 60000;

// ---------------------------------------------------------------------------
// Helpers puros (testeados por tests/unit)
// ---------------------------------------------------------------------------

/** Archivos de migración de `dir` que cumplen la convención, en orden lexicográfico. */
export function listMigrationFiles(dir = 'db/migrations') {
  return readdirSync(dir)
    .filter((name) => MIGRATION_FILE_RE.test(name))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** sha256 hex del contenido, normalizando CRLF -> LF (un checkout en Windows no cambia el checksum). */
export function checksumOf(text) {
  return createHash('sha256').update(String(text).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** Lanza si la URL no es utilizable por el runner (vacía, no postgres, o transaction pooler 6543). */
export function assertSessionPoolerUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error(
      'Falta SUPABASE_DB_URL (o DATABASE_URL). Usa la cadena del Session pooler de Supabase ' +
        '(Dashboard > Connect > Session pooler, puerto 5432).'
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('SUPABASE_DB_URL no es una URL válida (postgresql://usuario:clave@host:5432/postgres).');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error(`SUPABASE_DB_URL debe empezar con postgresql:// (recibido ${parsed.protocol}//).`);
  }
  if (parsed.port === '6543') {
    throw new Error(
      'SUPABASE_DB_URL apunta al puerto 6543 (transaction pooler), que no soporta advisory locks ni ' +
        'transacciones de migración. Usa el Session pooler (puerto 5432).'
    );
  }
  return url;
}

/**
 * Si la URL es la conexión directa db.<ref>.supabase.co (solo IPv6, inalcanzable desde Netlify y
 * muchas redes), la reescribe al session pooler con usuario postgres.<ref>. Otras URLs no cambian.
 */
export function toSessionPoolerUrl(url, poolerHost = process.env.SUPABASE_POOLER_HOST || DEFAULT_POOLER_HOST) {
  const parsed = new URL(url);
  const match = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname);
  if (!match) return url;
  const ref = match[1];
  parsed.hostname = poolerHost;
  parsed.port = '5432';
  if (!parsed.username || decodeURIComponent(parsed.username) === 'postgres') {
    parsed.username = `postgres.${ref}`;
  }
  return parsed.toString();
}

/** URL sin contraseña, para logs. */
export function redactUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(url inválida)';
  }
}

/** true si el primer contenido del archivo es el marcador '-- migrate:no-transaction'. */
export function isNoTransaction(sql) {
  const firstLine = String(sql).replace(/^﻿/, '').split(/\r?\n/, 1)[0].trim().toLowerCase();
  return firstLine === NO_TRANSACTION_MARKER;
}

/** Convierte la posición (1-based, en caracteres) de un error de Postgres a línea/columna. */
export function positionToLineCol(sql, position) {
  const pos = Number(position);
  if (!Number.isFinite(pos) || pos < 1) return null;
  const before = String(sql).slice(0, pos - 1);
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Config de pg.Client a partir de la URL, con SSL controlado por nosotros (no por sslmode). */
export function clientConfigFromUrl(url, env = process.env) {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode');
  const host = parsed.hostname;
  const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || env.MIGRATE_DB_SSL === 'false';
  let ssl;
  if (sslmode === 'disable' || isLocal) {
    ssl = false;
  } else if (env.SUPABASE_DB_CA) {
    ssl = { ca: env.SUPABASE_DB_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  } else {
    ssl = { rejectUnauthorized: false };
  }
  return {
    host,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username || 'postgres'),
    password: decodeURIComponent(parsed.password || ''),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'postgres'),
    ssl,
    application_name: 'aitickets-migrator',
    connectionTimeoutMillis: 15000
  };
}

function defaultAppliedBy(env = process.env) {
  if (env.MIGRATE_APPLIED_BY) return env.MIGRATE_APPLIED_BY;
  if (env.CONTEXT) {
    const ref = env.COMMIT_REF ? `@${env.COMMIT_REF.slice(0, 7)}` : '';
    return `netlify:${env.CONTEXT}${ref}`;
  }
  if (env.GITHUB_ACTIONS) return `ci:${env.GITHUB_SHA ? env.GITHUB_SHA.slice(0, 7) : 'github'}`;
  let user = 'unknown';
  try {
    user = userInfo().username;
  } catch {
    /* sin usuario del SO */
  }
  return `cli:${user}@${hostname()}`;
}

function formatPgError(file, sql, err) {
  const parts = [`Migración ${file} falló: ${err.message}`];
  const loc = err.position ? positionToLineCol(sql, err.position) : null;
  if (loc) parts.push(`  posición ${err.position} (línea ${loc.line}, columna ${loc.column})`);
  if (err.code) parts.push(`  código SQLSTATE ${err.code}`);
  if (err.detail) parts.push(`  detalle: ${err.detail}`);
  if (err.hint) parts.push(`  sugerencia: ${err.hint}`);
  if (err.where) parts.push(`  contexto: ${err.where}`);
  const wrapped = new Error(parts.join('\n'));
  wrapped.cause = err;
  wrapped.file = file;
  return wrapped;
}

// ---------------------------------------------------------------------------
// Acceso a la BD
// ---------------------------------------------------------------------------

async function ledgerExists(client) {
  const { rows } = await client.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [LEDGER_TABLE]);
  return rows[0].exists;
}

async function ensureLedger(client) {
  if (await ledgerExists(client)) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.aitickets_schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL DEFAULT 0,
      applied_by text
    );
    ALTER TABLE public.aitickets_schema_migrations ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.aitickets_schema_migrations FROM PUBLIC;
    DO $$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE ALL ON TABLE public.aitickets_schema_migrations FROM %I', r);
        END IF;
      END LOOP;
    END $$;
  `);
}

async function readLedger(client) {
  if (!(await ledgerExists(client))) return new Map();
  const { rows } = await client.query(
    `SELECT filename, checksum, applied_at, duration_ms, applied_by
       FROM public.aitickets_schema_migrations ORDER BY filename`
  );
  return new Map(rows.map((r) => [r.filename, r]));
}

async function acquireLock(client, log, maxWaitMs = LOCK_MAX_WAIT_MS) {
  const started = Date.now();
  for (;;) {
    const { rows } = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [LOCK_KEY]);
    if (rows[0].ok) return;
    if (Date.now() - started >= maxWaitMs) {
      throw new Error(
        `No se pudo tomar el advisory lock '${LOCK_KEY}' en ${Math.round(maxWaitMs / 1000)} s: ` +
          'otro proceso está migrando. Reintenta el deploy cuando termine.'
      );
    }
    log(`lock '${LOCK_KEY}' ocupado; reintentando en ${LOCK_RETRY_MS / 1000} s...`);
    await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
  }
}

async function releaseLock(client) {
  try {
    await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [LOCK_KEY]);
  } catch {
    /* la conexión se cierra igual y el lock de sesión se libera */
  }
}

/**
 * Comprobaciones de solo lectura antes de registrar la línea base: confirman que A0/B/C/D/Z ya están
 * aplicadas. Z elimina TODAS las políticas de tablas con nombres genéricos (users, organizations,
 * events) en un proyecto compartido, así que nunca se re-ejecuta automáticamente.
 */
export async function baselineChecks(client) {
  const { rows } = await client.query(`
    SELECT
      to_regclass('public.organization_payout_accounts') IS NOT NULL AS payout_accounts,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'event_tickets'
                 AND column_name = 'event_date_id') AS tickets_event_date_id,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'event_orders'
                 AND column_name = 'processing_started_at') AS orders_processing_started_at,
      (SELECT count(*)::int FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('users', 'organizations', 'events')) AS policy_count,
      COALESCE((SELECT c.relrowsecurity FROM pg_class c
                 WHERE c.oid = to_regclass('public.events')), false) AS events_rls
  `);
  const r = rows[0];
  const failures = [];
  if (!r.payout_accounts) failures.push('no existe public.organization_payout_accounts (migración C)');
  if (!r.tickets_event_date_id) failures.push('no existe event_tickets.event_date_id (migración D)');
  if (!r.orders_processing_started_at) failures.push('no existe event_orders.processing_started_at (migración B)');
  if (r.policy_count > 0) {
    failures.push(`hay ${r.policy_count} políticas RLS en users/organizations/events (A0/Z no aplicadas)`);
  }
  if (!r.events_rls) failures.push('public.events no tiene RLS activo (migración Z)');
  return { ok: failures.length === 0, failures };
}

async function applyFile(client, { file, sql, checksum, appliedBy, dryRun }) {
  const started = Date.now();
  const noTx = isNoTransaction(sql);
  if (noTx) {
    if (dryRun) return { skipped: true, durationMs: 0, noTx };
    await client.query(`SET lock_timeout = '5s'; SET statement_timeout = '120s'`);
    try {
      await client.query(sql);
    } catch (err) {
      throw formatPgError(file, sql, err);
    } finally {
      await client.query(`RESET lock_timeout; RESET statement_timeout`).catch(() => {});
    }
    const durationMs = Date.now() - started;
    await client.query(
      `INSERT INTO public.aitickets_schema_migrations (filename, checksum, duration_ms, applied_by)
       VALUES ($1, $2, $3, $4)`,
      [file, checksum, durationMs, appliedBy]
    );
    return { skipped: false, durationMs, noTx };
  }

  if (!dryRun) await client.query('BEGIN');
  // En dry-run todo corre dentro de la transacción externa; un savepoint por archivo aísla el error.
  if (dryRun) await client.query('SAVEPOINT migrate_file');
  try {
    await client.query(`SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '120s'`);
    await client.query(sql);
    const durationMs = Date.now() - started;
    await client.query(
      `INSERT INTO public.aitickets_schema_migrations (filename, checksum, duration_ms, applied_by)
       VALUES ($1, $2, $3, $4)`,
      [file, checksum, durationMs, appliedBy]
    );
    if (dryRun) await client.query('RELEASE SAVEPOINT migrate_file');
    else await client.query('COMMIT');
    return { skipped: false, durationMs, noTx };
  } catch (err) {
    await client.query(dryRun ? 'ROLLBACK TO SAVEPOINT migrate_file' : 'ROLLBACK').catch(() => {});
    throw formatPgError(file, sql, err);
  }
}

// ---------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------

/**
 * Aplica las migraciones pendientes.
 * @returns {Promise<{applied:string[], baselined:string[], pending:string[], skipped:string[], dryRun:boolean}>}
 */
export async function runMigrations({
  databaseUrl,
  dir = 'db/migrations',
  log = console.log,
  baseline = true,
  dryRun = false,
  baselineOnly = false,
  appliedBy = defaultAppliedBy(),
  lockMaxWaitMs = LOCK_MAX_WAIT_MS
} = {}) {
  assertSessionPoolerUrl(databaseUrl);
  const url = toSessionPoolerUrl(databaseUrl);
  assertSessionPoolerUrl(url);
  if (url !== databaseUrl) log(`host directo de Supabase reescrito al session pooler: ${redactUrl(url)}`);

  const absDir = resolve(dir);
  const files = listMigrationFiles(absDir).map((file) => {
    const sql = readFileSync(join(absDir, file), 'utf8');
    return { file, sql, checksum: checksumOf(sql) };
  });

  const { default: pg } = await import('pg');
  const client = new pg.Client(clientConfigFromUrl(url));
  client.on('notice', (msg) => log(`  NOTICE: ${msg.message}`));
  await client.connect();

  const result = { applied: [], baselined: [], pending: [], skipped: [], dryRun };
  let locked = false;
  try {
    await acquireLock(client, log, lockMaxWaitMs);
    locked = true;

    if (dryRun) await client.query('BEGIN');
    await ensureLedger(client);
    const ledger = await readLedger(client);

    // Archivos aplicados que cambiaron: nunca se re-ejecutan ni se "arreglan" solos.
    const mismatched = files.filter((f) => ledger.has(f.file) && ledger.get(f.file).checksum !== f.checksum);
    if (mismatched.length) {
      throw new Error(
        `migración ya aplicada fue editada; crea una nueva: ${mismatched.map((f) => f.file).join(', ')}`
      );
    }
    const onDisk = new Set(files.map((f) => f.file));
    for (const name of ledger.keys()) {
      if (!onDisk.has(name)) log(`aviso: ${name} está en el ledger pero no en ${dir}`);
    }

    // Línea base: solo con el ledger vacío.
    if (ledger.size === 0 && baseline) {
      const baselineFiles = files.filter((f) => BASELINE_FILES.includes(f.file));
      if (baselineFiles.length) {
        const checks = await baselineChecks(client);
        if (!checks.ok) {
          throw new Error(
            'No se puede registrar la línea base: la BD no parece tener aplicadas las migraciones 20260926_*.\n' +
              checks.failures.map((f) => `  - ${f}`).join('\n') +
              '\nNo se re-ejecuta Z automáticamente (borra políticas en un proyecto compartido). Revisa el ' +
              'estado de la BD a mano; en una BD vacía (CI/local) usa --no-baseline.'
          );
        }
        for (const f of baselineFiles) {
          await client.query(
            `INSERT INTO public.aitickets_schema_migrations (filename, checksum, duration_ms, applied_by)
             VALUES ($1, $2, 0, 'baseline') ON CONFLICT (filename) DO NOTHING`,
            [f.file, f.checksum]
          );
          ledger.set(f.file, { filename: f.file, checksum: f.checksum, applied_by: 'baseline' });
          result.baselined.push(f.file);
        }
        log(`línea base registrada (sin ejecutar): ${result.baselined.join(', ')}`);
      }
    }

    const pending = files.filter((f) => !ledger.has(f.file));
    result.pending = pending.map((f) => f.file);
    const lastApplied = [...ledger.keys()].filter((name) => onDisk.has(name)).sort().pop();
    for (const f of pending) {
      if (lastApplied && f.file < lastApplied) {
        log(`aviso: ${f.file} es anterior a la última aplicada (${lastApplied}); se aplica igual`);
      }
    }

    if (baselineOnly) {
      log(pending.length ? `--baseline-only: ${pending.length} pendiente(s) sin aplicar` : '--baseline-only: nada pendiente');
    } else if (!pending.length) {
      log('migraciones al día: 0 pendientes');
    } else {
      for (const f of pending) {
        log(`aplicando ${f.file}...`);
        const r = await applyFile(client, { ...f, appliedBy, dryRun });
        if (r.skipped) {
          log(`  omitida en dry-run (${NO_TRANSACTION_MARKER})`);
          result.skipped.push(f.file);
        } else {
          log(`  ok (${r.durationMs} ms${r.noTx ? ', sin transacción' : ''})`);
          result.applied.push(f.file);
        }
      }
      log(`${dryRun ? '[dry-run] ' : ''}${result.applied.length} migración(es) aplicada(s)`);
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      log('[dry-run] ROLLBACK: no se guardó ningún cambio');
    } else if (result.applied.length) {
      // PostgREST cachea el esquema: sin recarga, las columnas/funciones nuevas fallan vía API
      // ("column ... does not exist") hasta que otro DDL dispare la recarga.
      try {
        await client.query("NOTIFY pgrst, 'reload schema'");
        log('esquema de PostgREST recargado (NOTIFY pgrst)');
      } catch (e) {
        log(`aviso: no se pudo recargar el esquema de PostgREST: ${e?.message || e}`);
      }
    }
    return result;
  } catch (err) {
    if (dryRun) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (locked) await releaseLock(client);
    await client.end().catch(() => {});
  }
}

/** Estado de solo lectura: no crea el ledger ni toma el lock. */
export async function migrationStatus({ databaseUrl, dir = 'db/migrations' } = {}) {
  assertSessionPoolerUrl(databaseUrl);
  const url = toSessionPoolerUrl(databaseUrl);
  assertSessionPoolerUrl(url);
  const absDir = resolve(dir);
  const files = listMigrationFiles(absDir).map((file) => ({
    file,
    checksum: checksumOf(readFileSync(join(absDir, file), 'utf8'))
  }));

  const { default: pg } = await import('pg');
  const client = new pg.Client(clientConfigFromUrl(url));
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const hasLedger = await ledgerExists(client);
    const ledger = await readLedger(client);
    const rows = files.map((f) => {
      const row = ledger.get(f.file);
      if (!row) return { file: f.file, state: 'pending' };
      return {
        file: f.file,
        state: row.checksum === f.checksum ? 'applied' : 'modified',
        applied_at: row.applied_at,
        applied_by: row.applied_by
      };
    });
    const onDisk = new Set(files.map((f) => f.file));
    const orphans = [...ledger.keys()].filter((name) => !onDisk.has(name));
    return { hasLedger, rows, orphans };
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv) {
  const args = new Set(argv);
  const known = ['--status', '--dry-run', '--no-baseline', '--baseline-only', '--fail-on-pending', '--help', '-h'];
  const unknown = argv.filter((a) => !known.includes(a) && !a.startsWith('--dir='));
  if (args.has('--help') || args.has('-h') || unknown.length) {
    if (unknown.length) console.error(`Opción desconocida: ${unknown.join(' ')}`);
    console.log(
      'Uso: node [--env-file=.env] scripts/migrate.mjs [--status [--fail-on-pending]] [--dry-run] ' +
        '[--no-baseline] [--baseline-only] [--dir=db/migrations]'
    );
    return unknown.length ? 1 : 0;
  }
  const dirArg = argv.find((a) => a.startsWith('--dir='));
  const dir = dirArg ? dirArg.slice('--dir='.length) : 'db/migrations';
  const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  try {
    assertSessionPoolerUrl(databaseUrl);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error('Ejemplo local: node --env-file=.env scripts/migrate.mjs --status');
    return 1;
  }

  if (args.has('--status')) {
    const { hasLedger, rows, orphans } = await migrationStatus({ databaseUrl, dir });
    if (!hasLedger) console.log('(no existe public.aitickets_schema_migrations: todo aparece pendiente)');
    for (const r of rows) {
      const when = r.applied_at ? new Date(r.applied_at).toISOString() : '';
      console.log(`${r.state.padEnd(8)} ${r.file}${when ? `  ${when}  ${r.applied_by || ''}` : ''}`);
    }
    for (const o of orphans) console.log(`orphan   ${o}  (en el ledger, no en disco)`);
    const pending = rows.filter((r) => r.state === 'pending').length;
    const modified = rows.filter((r) => r.state === 'modified').length;
    console.log(`${rows.length - pending - modified} aplicadas, ${pending} pendientes, ${modified} modificadas`);
    if (modified) {
      console.error('Error: migración ya aplicada fue editada; crea una nueva');
      return 1;
    }
    if (pending && args.has('--fail-on-pending')) return 2;
    return 0;
  }

  await runMigrations({
    databaseUrl,
    dir,
    baseline: !args.has('--no-baseline'),
    dryRun: args.has('--dry-run'),
    baselineOnly: args.has('--baseline-only')
  });
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  );
}

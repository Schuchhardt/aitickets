#!/usr/bin/env node
// Backfill de app_metadata.app = 'aitickets' para identidades de Auth creadas antes del contrato R5.
//
// El proyecto de Supabase es COMPARTIDO con otras apps. AI Tickets solo puede banear o cambiar el
// correo de usuarios de Auth marcados con app_metadata.app === 'aitickets'. Los registros antiguos
// no tienen esa marca; este script la agrega a los que son inequívocamente de AI Tickets:
//   - tienen fila en public.users (auth_user_id no nulo), y
//   - el correo del usuario de Auth coincide (sin distinguir mayúsculas) con el de public.users, y
//   - app_metadata.app no existe (si existe con otro valor, pertenece a otra app: se omite y se reporta), y
//   - el usuario de Auth se creó a lo más MAX_CREATION_GAP_MS antes/después que la fila de public.users.
//     /api/auth/register puede vincular una identidad PREEXISTENTE (p. ej. de otra app del proyecto que no
//     marca app_metadata) a una fila nueva de public.users si la contraseña coincide; esas identidades son
//     anteriores a la fila y se reportan como skip_preexisting_identity para revisión manual.
//
// Solo toca app_metadata (fusionando con las claves existentes). Nunca modifica user_metadata,
// email, contraseña ni baneos.
//
// Uso:
//   node --env-file=.env scripts/backfill-app-metadata.mjs            simulación (por defecto)
//   node --env-file=.env scripts/backfill-app-metadata.mjs --apply    aplica los cambios
//
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Runbook: docs/runbooks/backfill-app-metadata.md

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_NAME = 'aitickets';
export const PAGE_SIZE = 500;
export const DEFAULT_RATE_PER_SEC = 5;
/** Diferencia máxima entre auth.users.created_at y public.users.created_at para considerarlos un mismo registro. */
export const MAX_CREATION_GAP_MS = 10 * 60 * 1000;

/** Acciones posibles para cada fila. */
export const ACTIONS = Object.freeze({
  TAG: 'tag', // se agregará app_metadata.app = 'aitickets'
  ALREADY: 'already_tagged', // ya tiene app = 'aitickets'
  OTHER_APP: 'skip_other_app', // app_metadata.app de otra app
  EMAIL_MISMATCH: 'skip_email_mismatch', // correos distintos: no es inequívocamente nuestro
  NO_EMAIL: 'skip_no_email', // falta el correo en Auth o en public.users
  AUTH_MISSING: 'skip_auth_missing', // auth_user_id apunta a un usuario de Auth inexistente
  DUPLICATE: 'skip_duplicate', // otra fila de public.users ya cubrió este auth_user_id
  PREEXISTING: 'skip_preexisting_identity', // Auth y public.users no se crearon juntos: posible identidad de otra app
  ERROR: 'error',
});

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Decisión pura para una fila de public.users y su usuario de Auth.
 * @param {{ email?: string | null, created_at?: string | null }} dbUser
 * @param {{ email?: string | null, created_at?: string | null, app_metadata?: Record<string, unknown> | null } | null | undefined} authUser
 * @returns {{ action: string, reason?: string, appMetadata?: Record<string, unknown> }}
 */
export function decideBackfill(dbUser, authUser) {
  if (!authUser) return { action: ACTIONS.AUTH_MISSING };
  const meta = authUser.app_metadata && typeof authUser.app_metadata === 'object' ? authUser.app_metadata : {};
  const app = meta.app;
  const hasApp = app !== undefined && app !== null && app !== '';
  if (hasApp) {
    if (app === APP_NAME) return { action: ACTIONS.ALREADY };
    return { action: ACTIONS.OTHER_APP, reason: `app=${String(app)}` };
  }
  const authEmail = normalizeEmail(authUser.email);
  const dbEmail = normalizeEmail(dbUser?.email);
  if (!authEmail || !dbEmail) return { action: ACTIONS.NO_EMAIL };
  if (authEmail !== dbEmail) return { action: ACTIONS.EMAIL_MISMATCH };
  const authCreated = Date.parse(authUser.created_at ?? '');
  const dbCreated = Date.parse(dbUser?.created_at ?? '');
  if (!Number.isFinite(authCreated) || !Number.isFinite(dbCreated)) {
    return { action: ACTIONS.PREEXISTING, reason: 'sin fecha de creación' };
  }
  const gapMs = dbCreated - authCreated;
  if (Math.abs(gapMs) > MAX_CREATION_GAP_MS) {
    const minutes = Math.round(gapMs / 60000);
    return {
      action: ACTIONS.PREEXISTING,
      reason: `Auth creado ${Math.abs(minutes)} min ${gapMs > 0 ? 'antes' : 'después'} que public.users`,
    };
  }
  return { action: ACTIONS.TAG, appMetadata: { ...meta, app: APP_NAME } };
}

/** Enmascara un correo como s***@dominio (nunca imprime el local-part completo). */
export function maskEmail(email) {
  const e = typeof email === 'string' ? email.trim() : '';
  const at = e.lastIndexOf('@');
  if (at <= 0) return e ? '***' : '(sin correo)';
  return `${e[0]}***${e.slice(at)}`;
}

export function parseArgs(argv) {
  const args = new Set(argv);
  const unknown = argv.filter((a) => a !== '--apply' && a !== '--help' && a !== '-h');
  return { apply: args.has('--apply'), help: args.has('--help') || args.has('-h'), unknown };
}

/** Limitador simple: garantiza al menos 1000/ratePerSec ms entre llamadas. */
export function createRateLimiter(ratePerSec = DEFAULT_RATE_PER_SEC, { now = Date.now, sleep } = {}) {
  const interval = Math.ceil(1000 / ratePerSec);
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let next = 0;
  return async function throttle() {
    const t = now();
    const delay = Math.max(0, next - t);
    next = Math.max(t, next) + interval;
    if (delay > 0) await wait(delay);
  };
}

export function formatTable(rows) {
  const headers = ['users.id', 'email', 'acción', 'detalle'];
  const data = rows.map((r) => [String(r.id), r.maskedEmail, r.action, r.reason || '']);
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((d) => d[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...data.map(line)].join('\n');
}

async function fetchAllDbUsers(supabase) {
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, auth_user_id, created_at')
      .not('auth_user_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`No se pudo leer public.users: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return out;
}

async function main(argv) {
  const { apply, help, unknown } = parseArgs(argv);
  if (help) {
    console.log('Uso: node --env-file=.env scripts/backfill-app-metadata.mjs [--apply]');
    return 0;
  }
  if (unknown.length) {
    console.error(`Argumentos desconocidos: ${unknown.join(' ')}`);
    return 1;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY');
    return 1;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const throttle = createRateLimiter(DEFAULT_RATE_PER_SEC);

  console.log(apply ? 'Modo APLICAR: se escribirá app_metadata.' : 'Modo SIMULACIÓN (sin cambios). Usa --apply para aplicar.');
  const dbUsers = await fetchAllDbUsers(supabase);
  console.log(`${dbUsers.length} filas de public.users con auth_user_id.\n`);

  const seen = new Set();
  const rows = [];
  for (const u of dbUsers) {
    const row = { id: u.id, maskedEmail: maskEmail(u.email), action: '', reason: '' };
    rows.push(row);
    if (seen.has(u.auth_user_id)) {
      row.action = ACTIONS.DUPLICATE;
      continue;
    }
    seen.add(u.auth_user_id);

    try {
      await throttle();
      const { data, error } = await supabase.auth.admin.getUserById(u.auth_user_id);
      if (error && error.status !== 404) throw new Error(error.message);
      const decision = decideBackfill(u, error ? null : data?.user);
      row.action = decision.action;
      row.reason = decision.reason || '';

      if (decision.action === ACTIONS.TAG) {
        if (!apply) {
          row.reason = 'simulación';
          continue;
        }
        await throttle();
        // Solo app_metadata, fusionado con las claves existentes (provider, providers, etc.).
        const { error: upErr } = await supabase.auth.admin.updateUserById(u.auth_user_id, {
          app_metadata: decision.appMetadata,
        });
        if (upErr) throw new Error(upErr.message);
        row.reason = 'aplicado';
      }
    } catch (err) {
      row.action = ACTIONS.ERROR;
      row.reason = String(err?.message || err).slice(0, 120);
    }
  }

  console.log(formatTable(rows));
  const counts = rows.reduce((acc, r) => ((acc[r.action] = (acc[r.action] || 0) + 1), acc), {});
  console.log('\nResumen:');
  for (const [action, n] of Object.entries(counts).sort()) console.log(`  ${action}: ${n}`);
  const others = rows.filter((r) => r.action === ACTIONS.OTHER_APP);
  if (others.length) {
    console.log(`\n${others.length} identidades pertenecen a otra app y se omitieron (revisar manualmente).`);
  }
  const preexisting = rows.filter((r) => r.action === ACTIONS.PREEXISTING);
  if (preexisting.length) {
    console.log(
      `\n${preexisting.length} identidades de Auth no se crearon junto con su fila de public.users (posible identidad de otra app vinculada al registrarse): no se marcaron, revisar manualmente.`
    );
  }
  return counts[ACTIONS.ERROR] ? 1 : 0;
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

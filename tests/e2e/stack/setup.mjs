#!/usr/bin/env node
// Levanta y prepara el stack local de Supabase para los e2e con base real (playwright.stack.config.ts):
//   1. Genera los secretos del stack (contraseña de la base y secreto JWT) o reutiliza los de .stack.env: ninguno queda
//      escrito en el repo.
//   2. Descarga las imágenes una por una con reintentos (los registros públicos limitan las descargas anónimas desde la
//      CI: "toomanyrequests") y hace docker compose up (tests/e2e/stack/docker-compose.yml).
//   3. Aplica db/schema.sql + organización 1 + TODAS las migraciones con el mismo runner del deploy (scripts/migrate.mjs).
//      Así el e2e prueba exactamente lo que el repo crea, incluido el trigger on_auth_user_created de auth.users.
//   4. Firma las claves anon / service_role con el secreto JWT y escribe tests/e2e/stack/.stack.env.
//
// Uso:  node tests/e2e/stack/setup.mjs [--down]     (--down: baja el stack, borra sus datos y .stack.env)
// Requiere Docker. NUNCA toca producción: todo es local (127.0.0.1) y desechable.
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '../../../scripts/migrate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const COMPOSE = join(HERE, 'docker-compose.yml');
export const STACK_ENV_FILE = join(HERE, '.stack.env');
export const SUPABASE_URL = 'http://127.0.0.1:54321';
const DB_HOST = '127.0.0.1:54322';

function readStackEnv() {
  if (!existsSync(STACK_ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(STACK_ENV_FILE, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

/** Secretos del stack: los de .stack.env si ya existe (la base se inicializó con ellos) o nuevos. */
function stackSecrets() {
  const saved = readStackEnv();
  return {
    dbPassword: saved.E2E_DB_PASSWORD || randomBytes(18).toString('base64url'),
    jwtSecret: saved.E2E_JWT_SECRET || randomBytes(32).toString('base64url'),
  };
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
export function signJwt(payload, secret) {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const LONG_EXP = Math.floor(Date.UTC(2099, 0, 1) / 1000);

const dbUrl = (user, password) => `postgresql://${user}:${encodeURIComponent(password)}@${DB_HOST}/postgres`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function compose(secrets, args, opts = {}) {
  return execFileSync('docker', ['compose', '-f', COMPOSE, ...args], {
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    cwd: HERE,
    encoding: 'utf8',
    env: { ...process.env, E2E_DB_PASSWORD: secrets.dbPassword, E2E_JWT_SECRET: secrets.jwtSecret },
  });
}

/** Descarga las imágenes de a una, con reintentos y espera creciente (límite de descargas anónimas de los registros). */
async function pullImages(secrets) {
  const images = compose(secrets, ['config', '--images'], { capture: true }).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const image of images) {
    try {
      execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
      continue; // ya está (p. ej. restaurada de la caché de la CI)
    } catch {
      /* hay que descargarla */
    }
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync('docker', ['pull', '-q', image], { stdio: ['ignore', 'ignore', 'pipe'] });
        console.log(`imagen ${image} lista`);
        break;
      } catch (err) {
        const reason = String(err.stderr || err.message).trim().split('\n').pop();
        if (attempt >= 6) throw new Error(`No se pudo descargar ${image}: ${reason}`);
        const wait = 2 ** attempt * 1000;
        console.warn(`descarga de ${image} falló (${reason}); reintento ${attempt}/5 en ${wait / 1000}s`);
        await sleep(wait);
      }
    }
  }
  return images;
}

async function waitFor(name, fn, timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      if (await fn()) return;
    } catch (err) {
      last = err;
    }
    await sleep(1000);
  }
  throw new Error(`${name} no respondió a tiempo${last ? `: ${last.message}` : ''}`);
}

async function withClient(url, fn) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * La migración 202611080200 crea on_auth_user_created si falta (en producción ya existe). Si en el Postgres local el rol
 * postgres no pudiera crearlo, se crea con el superusuario para que el stack sea igual a producción.
 */
async function ensureAuthTrigger(adminUrl) {
  await withClient(adminUrl, async (c) => {
    const { rows } = await c.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND tgrelid = 'auth.users'::regclass`);
    if (!rows.length) {
      await c.query('CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()');
      console.log('trigger on_auth_user_created creado con supabase_admin (en producción ya existe)');
    }
  });
}

export async function setup() {
  const secrets = stackSecrets();
  const DB_URL = dbUrl('postgres', secrets.dbPassword);
  const ANON_KEY = signJwt({ iss: 'supabase-e2e', role: 'anon', exp: LONG_EXP }, secrets.jwtSecret);
  const SERVICE_ROLE_KEY = signJwt({ iss: 'supabase-e2e', role: 'service_role', exp: LONG_EXP }, secrets.jwtSecret);
  // Se guardan antes de levantar el stack: un setup repetido reutiliza los secretos con que se inicializó la base
  writeFileSync(STACK_ENV_FILE, `E2E_DB_PASSWORD=${secrets.dbPassword}\nE2E_JWT_SECRET=${secrets.jwtSecret}\n`);

  await pullImages(secrets);
  compose(secrets, ['up', '-d', '--wait']);
  await waitFor('Auth', async () => (await fetch(`${SUPABASE_URL}/auth/v1/health`)).ok);
  await waitFor('Postgres', () => withClient(DB_URL, async (c) => (await c.query('SELECT 1')).rowCount === 1));

  const fresh = await withClient(DB_URL, async (c) => !(await c.query(`SELECT to_regclass('public.organizations') AS t`)).rows[0].t);
  if (fresh) {
    await withClient(DB_URL, async (c) => {
      await c.query(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
      await c.query(`INSERT INTO public.organizations (id, public_name) VALUES (1, 'AI Tickets')`);
      await c.query(`SELECT setval(pg_get_serial_sequence('public.organizations', 'id'), 1)`);
    });
  }
  await runMigrations({ databaseUrl: DB_URL, dir: join(ROOT, 'db/migrations'), baseline: false, log: (m) => console.log(`[migrate] ${m}`) });
  await ensureAuthTrigger(dbUrl('supabase_admin', secrets.dbPassword));
  await withClient(DB_URL, (c) => c.query(`NOTIFY pgrst, 'reload schema'`));
  await waitFor('PostgREST', async () => (await fetch(`${SUPABASE_URL}/rest/v1/organizations?select=id&limit=1`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  })).ok);

  const env = {
    E2E_DB_PASSWORD: secrets.dbPassword,
    E2E_JWT_SECRET: secrets.jwtSecret,
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    E2E_STACK_DB_URL: DB_URL,
  };
  writeFileSync(STACK_ENV_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  console.log(`Stack listo: ${SUPABASE_URL} (base en ${DB_HOST}). Variables en ${STACK_ENV_FILE}`);
}

export function down() {
  compose(stackSecrets(), ['down', '-v', '--remove-orphans']);
  rmSync(STACK_ENV_FILE, { force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = process.argv.includes('--down') ? Promise.resolve().then(down) : setup();
  run.catch((err) => {
    console.error(`setup del stack e2e: ${err.message}`);
    process.exit(1);
  });
}

#!/usr/bin/env node
// Detector de drift de la base de AI Tickets.
//
// db/catalog.sql lista cada objeto de AI Tickets (tablas, columnas, constraints, índices, políticas, grants, triggers
// —incluido el de auth.users—, funciones y buckets) como pares (key, value). db/catalog.snapshot.tsv es ese catálogo
// para la base que arman db/schema.sql + db/migrations: un "lockfile" del esquema versionado en el repo.
//
//   * CI: arma la base (scripts/db-ci-setup.sh) y corre --check: si una migración cambia el esquema y nadie actualizó
//     el snapshot, falla (npm run db:snapshot lo regenera).
//   * Deploy de producción (plugins/db-migrate): después de migrar corre --check contra producción. Lo que aparece
//     ahí existe SOLO en la base (alguien lo creó a mano en el dashboard de Supabase) o le falta algo. Así nació el bug
//     de "agregar miembro": un trigger de auth.users que no estaba en el repo.
//
// Uso (SUPABASE_DB_URL o DATABASE_URL; solo lectura):
//   node scripts/db-drift.mjs --check [--warn] [--snapshot=db/catalog.snapshot.tsv]   (--warn: avisa y sale con 0)
//   node scripts/db-drift.mjs --write [--snapshot=...]   escribe el snapshot (solo desde una base armada con db-ci-setup)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertSessionPoolerUrl, clientConfigFromUrl, redactUrl, toSessionPoolerUrl } from './migrate.mjs';

export const CATALOG_SQL_PATH = 'db/catalog.sql';
export const SNAPSHOT_PATH = 'db/catalog.snapshot.tsv';
const HEADER =
  '# Catálogo de la base que arman db/schema.sql + db/migrations (db/catalog.sql). NO editar a mano:\n' +
  '# npm run db:snapshot lo regenera. scripts/db-drift.mjs --check compara una base real contra este archivo.\n';

const escape = (v) => String(v).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n');
const unescape = (v) => v.replace(/\\(\\|t|n)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\'));

/** Snapshot TSV (ordenado por key, con el mismo orden que Postgres en C) a partir de filas {key, value}. */
export function formatSnapshot(rows) {
  const sorted = [...rows].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return HEADER + sorted.map((r) => `${escape(r.key)}\t${escape(r.value)}`).join('\n') + '\n';
}

/** Map key → value desde el texto del snapshot. */
export function parseSnapshot(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) throw new Error(`Línea inválida en el snapshot: ${line.slice(0, 80)}`);
    map.set(unescape(line.slice(0, tab)), unescape(line.slice(tab + 1)));
  }
  return map;
}

/**
 * Diferencias entre lo esperado (snapshot del repo) y lo que hay en una base.
 * onlyInDb: existe en la base pero no en el repo (creado a mano). missingInDb: el repo lo crea y la base no lo tiene.
 * changed: existe en ambos con otra definición.
 */
export function diffCatalogs(expected, actual) {
  const onlyInDb = [];
  const missingInDb = [];
  const changed = [];
  for (const [key, value] of actual) {
    if (!expected.has(key)) onlyInDb.push({ key, value });
    else if (expected.get(key) !== value) changed.push({ key, expected: expected.get(key), actual: value });
  }
  for (const [key, value] of expected) if (!actual.has(key)) missingInDb.push({ key, value });
  return { onlyInDb, missingInDb, changed, total: onlyInDb.length + missingInDb.length + changed.length };
}

/** Texto legible de un diff (vacío si no hay diferencias). */
export function formatDiff(diff, { label = 'la base' } = {}) {
  if (!diff.total) return '';
  const out = [];
  if (diff.onlyInDb.length) {
    out.push(`Existe SOLO en ${label} (creado a mano: pásalo a una migración o bórralo):`);
    for (const d of diff.onlyInDb) out.push(`  + ${d.key}\n      ${d.value}`);
  }
  if (diff.missingInDb.length) {
    out.push(`Falta en ${label} (el repo lo crea: ¿migración sin aplicar o borrado a mano?):`);
    for (const d of diff.missingInDb) out.push(`  - ${d.key}\n      ${d.value}`);
  }
  if (diff.changed.length) {
    out.push(`Distinto en ${label}:`);
    for (const d of diff.changed) out.push(`  ~ ${d.key}\n      repo:  ${d.expected}\n      base:  ${d.actual}`);
  }
  return out.join('\n');
}

/** Lee el catálogo de una base (sesión de solo lectura). */
export async function readCatalog(databaseUrl, { catalogSql = readFileSync(resolve(CATALOG_SQL_PATH), 'utf8') } = {}) {
  assertSessionPoolerUrl(databaseUrl);
  const url = toSessionPoolerUrl(databaseUrl);
  const { default: pg } = await import('pg');
  const client = new pg.Client({ ...clientConfigFromUrl(url), application_name: 'aitickets-drift' });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const { rows } = await client.query(catalogSql);
    return rows.map((r) => ({ key: String(r.key), value: String(r.value) }));
  } finally {
    await client.end().catch(() => {});
  }
}

/** Compara la base con el snapshot. Devuelve { diff, report }. */
export async function checkDrift({ databaseUrl, snapshotPath = SNAPSHOT_PATH, label } = {}) {
  const expected = parseSnapshot(readFileSync(resolve(snapshotPath), 'utf8'));
  const rows = await readCatalog(databaseUrl);
  const actual = new Map(rows.map((r) => [r.key, r.value]));
  const diff = diffCatalogs(expected, actual);
  return { diff, report: formatDiff(diff, { label }) };
}

async function main(argv) {
  const check = argv.includes('--check');
  const write = argv.includes('--write');
  const warn = argv.includes('--warn');
  const snapArg = argv.find((a) => a.startsWith('--snapshot='));
  const snapshotPath = snapArg ? snapArg.slice('--snapshot='.length) : SNAPSHOT_PATH;
  const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (check === write) {
    console.log('Uso: node scripts/db-drift.mjs --check [--warn] | --write   [--snapshot=db/catalog.snapshot.tsv]');
    return 1;
  }
  try {
    if (write) {
      const rows = await readCatalog(databaseUrl);
      writeFileSync(resolve(snapshotPath), formatSnapshot(rows));
      console.log(`${rows.length} objetos escritos en ${snapshotPath} (desde ${redactUrl(databaseUrl)})`);
      return 0;
    }
    const { diff, report } = await checkDrift({ databaseUrl, snapshotPath });
    if (!diff.total) {
      console.log(`Sin drift: la base coincide con ${snapshotPath}`);
      return 0;
    }
    console.error(`Drift de la base (${diff.total} diferencia(s)) respecto de ${snapshotPath}:\n${report}`);
    console.error('\nSi el cambio es del repo (migración nueva), regenera el snapshot: npm run db:snapshot');
    return warn ? 0 : 1;
  } catch (err) {
    console.error(`db-drift: ${err.message}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

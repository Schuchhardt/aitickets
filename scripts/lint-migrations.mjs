#!/usr/bin/env node
// Lint de migraciones (CI). El proyecto de Supabase es COMPARTIDO con otras apps, así que una
// migración de AI Tickets solo puede modificar o borrar objetos propios.
//
// Falla si una migración nueva (no línea base):
//   * hace DROP / ALTER / TRUNCATE sobre algo fuera de la allowlist: tablas de AI Tickets que
//     lista 20260926_Z_lockdown_rls.sql, organization_payout_accounts y cualquier aitickets_*;
//   * hace ALTER/DROP de SCHEMA, ROLE, DATABASE, EXTENSION o ALTER DEFAULT PRIVILEGES;
//   * referencia auth.*, storage.* o extensions.* salvo en una FK (REFERENCES auth.users);
//   * crea una tabla o función sin el prefijo aitickets_;
//   * el nombre del archivo no cumple /^\d{8,12}_.+\.sql$/.
// Una línea con el comentario `-- lint:allow <motivo>` se excluye de las reglas de objetivo
// (para SQL dinámico revisado a mano). Los archivos de la línea base (20260926_*) ya fueron
// revisados y aplicados: no se lintean.
//
// Uso: node scripts/lint-migrations.mjs [dir]

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BASELINE_FILES, MIGRATION_FILE_RE } from './migrate.mjs';

export const AITICKETS_TABLES = [
  'attendees', 'category_tags', 'newsletter', 'organizations', 'venues', 'users',
  'events', 'event_tickets', 'event_locations', 'event_orders', 'event_faqs',
  'event_tags', 'event_withdrawals', 'questions', 'event_dates', 'event_visits',
  'event_attendees', 'social_accounts', 'social_posts', 'ad_account_connections',
  'ad_campaigns', 'notification_log', 'organization_payout_accounts'
];

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_%][\w$%]*)`;
const NAME = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;

function stripComments(sql) {
  // Reemplaza comentarios por espacios del mismo largo (conserva posiciones/líneas).
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

function normalizeName(raw) {
  const parts = raw.split('.').map((p) => p.trim().replace(/^"|"$/g, ''));
  if (parts.length === 1) return { schema: 'public', name: parts[0].toLowerCase() };
  return { schema: parts[0].toLowerCase(), name: parts[1].toLowerCase() };
}

export function isAllowedTable(rawName) {
  const { schema, name } = normalizeName(rawName);
  if (schema !== 'public') return false;
  return name.startsWith('aitickets_') || AITICKETS_TABLES.includes(name);
}

function isAitickets(rawName) {
  const { schema, name } = normalizeName(rawName);
  return schema === 'public' && name.startsWith('aitickets_');
}

function isAllowedIndex(rawName) {
  const { schema, name } = normalizeName(rawName);
  if (schema !== 'public') return false;
  return name.startsWith('aitickets_') || AITICKETS_TABLES.some((t) => name.includes(t));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Lintea el contenido de una migración. Devuelve [{line, message}].
 * @param {string} file nombre del archivo (para la regla de nombre)
 * @param {string} sql contenido
 */
export function lintMigration(file, sql) {
  const problems = [];
  if (!MIGRATION_FILE_RE.test(file)) {
    problems.push({ line: 0, message: `nombre inválido (debe ser YYYYMMDDHHMM_<slug>.sql)` });
  }
  const originalLines = sql.split('\n');
  const code = stripComments(sql);
  const allowed = (idx) => /--\s*lint:allow\b/.test(originalLines[lineOf(code, idx) - 1] || '');
  const report = (idx, message) => {
    if (!allowed(idx)) problems.push({ line: lineOf(code, idx), message });
  };
  const dynamic = (raw) => raw.includes('%');

  // ALTER TABLE
  for (const m of code.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${NAME}`, 'gi'))) {
    if (dynamic(m[1])) report(m.index, `ALTER TABLE dinámico (${m[1]}): revisa y marca con -- lint:allow`);
    else if (!isAllowedTable(m[1])) report(m.index, `ALTER TABLE ${m[1]} fuera de la allowlist de AI Tickets`);
  }

  // TRUNCATE
  for (const m of code.matchAll(new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?${NAME}`, 'gi'))) {
    if (dynamic(m[1]) || !isAitickets(m[1])) report(m.index, `TRUNCATE ${m[1]}: solo se permite sobre tablas aitickets_*`);
  }

  // Objetos globales: nunca.
  for (const m of code.matchAll(/\b(ALTER|DROP)\s+(SCHEMA|ROLE|USER|DATABASE|EXTENSION|PUBLICATION|SUBSCRIPTION|EVENT\s+TRIGGER)\b/gi)) {
    report(m.index, `${m[1].toUpperCase()} ${m[2].toUpperCase()} no está permitido en un proyecto compartido`);
  }
  for (const m of code.matchAll(/\bALTER\s+DEFAULT\s+PRIVILEGES\b/gi)) {
    report(m.index, 'ALTER DEFAULT PRIVILEGES no está permitido en un proyecto compartido');
  }

  // DROP/ALTER de objetos con tabla asociada (ON <tabla>)
  for (const m of code.matchAll(new RegExp(String.raw`\b(DROP|ALTER)\s+(POLICY|TRIGGER|RULE)\s+(?:IF\s+EXISTS\s+)?${IDENT}\s+ON\s+${NAME}`, 'gi'))) {
    const table = m[3];
    if (dynamic(table)) report(m.index, `${m[1]} ${m[2]} dinámico: revisa y marca con -- lint:allow`);
    else if (!isAllowedTable(table)) report(m.index, `${m[1]} ${m[2]} sobre ${table} fuera de la allowlist`);
  }

  // DROP TABLE/VIEW/...: solo aitickets_*
  for (const m of code.matchAll(new RegExp(String.raw`\bDROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TYPE|DOMAIN|SEQUENCE)\s+(?:IF\s+EXISTS\s+)?${NAME}`, 'gi'))) {
    if (dynamic(m[2]) || !isAitickets(m[2])) {
      report(m.index, `DROP ${m[1].toUpperCase()} ${m[2]}: solo se permite sobre objetos aitickets_*`);
    }
  }
  for (const m of code.matchAll(new RegExp(String.raw`\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?${NAME}`, 'gi'))) {
    if (dynamic(m[1]) || !isAllowedIndex(m[1])) report(m.index, `DROP INDEX ${m[1]} fuera de la allowlist`);
  }

  // ALTER FUNCTION/TYPE/...: solo aitickets_*
  for (const m of code.matchAll(new RegExp(String.raw`\bALTER\s+(FUNCTION|PROCEDURE|TYPE|DOMAIN|SEQUENCE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+EXISTS\s+)?${NAME}`, 'gi'))) {
    if (dynamic(m[2]) || !isAitickets(m[2])) {
      report(m.index, `ALTER ${m[1].toUpperCase()} ${m[2]}: solo se permite sobre objetos aitickets_*`);
    }
  }
  for (const m of code.matchAll(new RegExp(String.raw`\bALTER\s+INDEX\s+(?:IF\s+EXISTS\s+)?${NAME}`, 'gi'))) {
    if (dynamic(m[1]) || !isAllowedIndex(m[1])) report(m.index, `ALTER INDEX ${m[1]} fuera de la allowlist`);
  }

  // Esquemas de Supabase: solo FKs a auth.users.
  for (const m of code.matchAll(/\b(auth|storage|extensions)\s*\.\s*("?[A-Za-z_][\w$]*"?)/gi)) {
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    if (/\bREFERENCES\s+$/i.test(before)) continue;
    report(m.index, `referencia a ${m[1]}.${m[2]}: solo se permiten FKs (REFERENCES auth.users)`);
  }

  // Objetos nuevos con prefijo aitickets_
  for (const m of code.matchAll(new RegExp(String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}`, 'gi'))) {
    if (!isAitickets(m[1])) report(m.index, `CREATE TABLE ${m[1]}: las tablas nuevas deben llamarse public.aitickets_*`);
  }
  for (const m of code.matchAll(new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+${NAME}`, 'gi'))) {
    if (!isAitickets(m[2])) report(m.index, `CREATE ${m[1].toUpperCase()} ${m[2]}: las funciones nuevas deben llamarse public.aitickets_*`);
  }

  return problems.sort((a, b) => a.line - b.line);
}

/** Lintea todos los archivos de `dir` (salvo la línea base). Devuelve {file: problems[]}. */
export function lintMigrationsDir(dir = 'db/migrations') {
  const absDir = resolve(dir);
  const out = {};
  for (const file of readdirSync(absDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (BASELINE_FILES.includes(file)) continue;
    const problems = lintMigration(file, readFileSync(join(absDir, file), 'utf8'));
    if (problems.length) out[file] = problems;
  }
  return out;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const dir = process.argv[2] || 'db/migrations';
  const results = lintMigrationsDir(dir);
  const files = Object.keys(results);
  if (!files.length) {
    console.log(`lint de migraciones OK (${dir})`);
    process.exit(0);
  }
  for (const file of files) {
    for (const p of results[file]) console.error(`${file}:${p.line}: ${p.message}`);
  }
  console.error(`\n${files.length} archivo(s) con problemas. El proyecto Supabase es compartido: solo objetos de AI Tickets.`);
  process.exit(1);
}

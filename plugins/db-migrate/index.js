// Plugin local de Netlify: aplica db/migrations en los deploys de producción.
//
// Corre en onPostBuild: después del build de Astro y del bundling de funciones, antes del deploy.
// Si una migración falla, el build falla y el deploy no ocurre; si el build falla antes, la BD no se
// toca. Solo CONTEXT=production: los deploy previews y branch deploys comparten la BD de producción
// y son código no confiable, así que nunca migran (y SUPABASE_DB_URL solo existe en Production).
//
// Variables:
//   SUPABASE_DB_URL       Session pooler de Supavisor (puerto 5432). Scope Builds, contexto Production.
//   MIGRATE_ON_BUILD      'false' desactiva el plugin (por defecto activo en producción).
//   ALLOW_MISSING_DB_URL  'true' solo para el primer deploy antes de configurar SUPABASE_DB_URL: avisa
//                         en vez de fallar.

import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../scripts/migrate.mjs';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export const onPostBuild = async ({ utils }) => {
  const context = process.env.CONTEXT || 'unknown';

  if (context !== 'production') {
    console.log(`skip migrations: context ${context}`);
    return;
  }
  if (process.env.MIGRATE_ON_BUILD === 'false') {
    console.log('skip migrations: MIGRATE_ON_BUILD=false');
    return;
  }

  // Igual que scripts/migrate.mjs: acepta DATABASE_URL (si es el host directo IPv6 se reescribe al pooler).
  const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    const message =
      'Falta SUPABASE_DB_URL o DATABASE_URL (scope Builds, contexto Production): no se pueden aplicar las migraciones. ' +
      'Configúrala con la cadena del Session pooler de Supabase (puerto 5432).';
    if (process.env.ALLOW_MISSING_DB_URL === 'true') {
      console.warn(`[db-migrate] AVISO: ${message} Se continúa porque ALLOW_MISSING_DB_URL=true.`);
      utils.status?.show({ title: 'Migraciones omitidas', summary: 'Falta SUPABASE_DB_URL (ALLOW_MISSING_DB_URL=true).' });
      return;
    }
    utils.build.failBuild(`[db-migrate] ${message}`);
    return;
  }

  try {
    const result = await runMigrations({
      databaseUrl,
      dir: MIGRATIONS_DIR,
      log: (msg) => console.log(`[db-migrate] ${msg}`)
    });
    const summary =
      `${result.applied.length} aplicada(s)` +
      (result.baselined.length ? `, ${result.baselined.length} registrada(s) como línea base` : '');
    utils.status?.show({ title: 'Migraciones de BD', summary });
  } catch (error) {
    utils.build.failBuild(`[db-migrate] ${error.message}`, { error });
  }
};

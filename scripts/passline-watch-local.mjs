#!/usr/bin/env node
// Corre una vez, en local, el seguimiento de productores de Passline (misma librería que la función de Netlify).
// SOLO usa resultados de búsqueda (Firecrawl search); nunca visita passline.com. Ver docs/runbooks/passline-leads.md.
//
// Uso:
//   node --env-file=.env scripts/passline-watch-local.mjs --dry-run            simula: busca, extrae y enriquece
//                                                                             pero NO escribe en la BD; guarda el
//                                                                             plan en leads/dry-run-YYYY-MM-DD.json
//   node --env-file=.env scripts/passline-watch-local.mjs                      corre de verdad (escribe en la BD)
//   node --env-file=.env scripts/passline-watch-local.mjs --seed-json passline_rm.json [--dry-run]
//                                                                             carga eventos/leads desde el archivo
//                                                                             local (sin búsquedas ni Claude)
//   Opciones: --no-enrich (salta el enriquecimiento), --out <archivo.json> (destino del plan en dry-run)
//
// Variables: FIRECRAWL_API_KEY (salvo --seed-json), ANTHROPIC_API_KEY (opcional: sin ella solo heurística),
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (también en --dry-run: ahí solo se LEE la lista de supresión, los
// eventos conocidos y los leads existentes, para que el plan no traiga contactos suprimidos ni duplicados).
// LEADS_PASSLINE_ENABLED no aplica aquí: correr el script ya es la decisión explícita.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { formatSlackSummary, runPasslineWatch, seedEventsFromPasslineJson } from '../netlify/lib/leads/passline-watch.mjs'

export function parseArgs(argv) {
  const args = { dryRun: false, seedJson: null, enrich: true, out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--no-enrich') args.enrich = false
    else if (a === '--seed-json') args.seedJson = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--help' || a === '-h') args.help = true
    else throw new Error(`opción desconocida: ${a}`)
  }
  if (args.seedJson === undefined) throw new Error('--seed-json requiere un archivo')
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('node --env-file=.env scripts/passline-watch-local.mjs [--dry-run] [--seed-json passline_rm.json] [--no-enrich] [--out plan.json]')
    return
  }
  let seedEvents = null
  if (args.seedJson) {
    const raw = JSON.parse(readFileSync(resolve(args.seedJson), 'utf8'))
    seedEvents = seedEventsFromPasslineJson(Array.isArray(raw) ? raw : raw?.data || raw?.events || [])
    console.log(`Semilla: ${seedEvents.length} eventos desde ${args.seedJson}`)
  } else if (!process.env.FIRECRAWL_API_KEY) {
    throw new Error('Falta FIRECRAWL_API_KEY (o usa --seed-json)')
  }
  // dryRun controla las escrituras, no las lecturas: el cliente se crea siempre (lista de supresión).
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (también en --dry-run, para revisar la lista de supresión)')
  }
  const { getSupabaseAdmin } = await import('../netlify/lib/supabase.mjs')
  const supabase = getSupabaseAdmin()
  const summary = await runPasslineWatch({ supabase, dryRun: args.dryRun, seedEvents, enrich: args.enrich })
  console.log(formatSlackSummary(summary))
  if (args.dryRun) {
    const out = resolve(args.out || `leads/dry-run-${new Date().toISOString().slice(0, 10)}.json`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(summary.plan, null, 2))
    console.log(`\nDry-run: ${summary.plan.events.length} eventos y ${summary.plan.leads.length} leads (sin escribir en la BD).`)
    for (const l of summary.plan.leads.slice(0, 20)) {
      console.log(`  - [${l.lead_type}] ${l.org_name}${l.city ? ` (${l.city})` : ''} · ${l.events_on_passline} evento(s)${l.email ? ` · ${l.email}` : ''}${l.instagram ? ` · @${l.instagram}` : ''}`)
    }
    console.log(`Plan guardado en ${out} (exporta con: node scripts/export-leads.mjs --input ${out})`)
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Error:', err?.message || err)
    process.exit(1)
  })
}

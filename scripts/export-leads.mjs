#!/usr/bin/env node
// Exporta los leads de Passline a leads/leads-YYYY-MM-DD.csv (carpeta en .gitignore: contiene datos de contacto).
// Ordenados por prioridad (recencia + frecuencia + categoría ICP: stand-up/comedia/teatro primero).
//
// Uso:
//   node --env-file=.env scripts/export-leads.mjs                 desde la BD (source = passline_search)
//   node --env-file=.env scripts/export-leads.mjs --all           incluye suprimidos, inválidos y duplicados
//   node --env-file=.env scripts/export-leads.mjs --input leads/dry-run-2026-09-30.json   desde el plan de un dry-run
//   Opción: --out <archivo.csv>
//
// Siempre (salvo --all) se vuelve a revisar cada lead contra aitickets_suppressions y contra los demás leads
// (mismo dominio/correo ya en outreach): por eso también --input necesita la BD (solo lectura).
// Un plan de dry-run generado sin revisar la lista de supresión (suppressionChecked=false) nunca se exporta.
//
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildLeadsCsv, filterExportableLeads } from '../netlify/lib/leads/export.mjs'
import { SOURCE_KEY } from '../netlify/lib/leads/passline-watch.mjs'

const COLUMNS = 'id, name_key, domain, org_name, lead_type, city, categories, events_on_passline, last_passline_event, last_seen_event_at, website, instagram, email, email_source_url, whatsapp, contact_sources, status, notes'

export function parseArgs(argv) {
  const args = { input: null, out: null, all: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input') args.input = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--all') args.all = true
    else throw new Error(`opción desconocida: ${a}`)
  }
  return args
}

async function getDb() {
  const { fetchAllRows, getSupabaseAdmin } = await import('../netlify/lib/supabase.mjs')
  return { fetchAllRows, supabase: getSupabaseAdmin() }
}

/** Solo lecturas: supresiones y los demás leads con dominio o correo (para detectar duplicados). */
async function loadGuards({ fetchAllRows, supabase }) {
  const suppressions = await fetchAllRows(() => supabase.from('aitickets_suppressions').select('id, email, domain').order('id', { ascending: true }))
  const otherLeads = await fetchAllRows(() => supabase
    .from('aitickets_leads')
    .select('id, name_key, domain, email, status')
    .neq('status', 'invalid')
    .order('created_at', { ascending: true }))
  return { suppressions, otherLeads: otherLeads.filter((l) => l.domain || l.email) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let leads
  if (args.input) {
    const plan = JSON.parse(readFileSync(resolve(args.input), 'utf8'))
    if (!plan?.suppressionChecked) {
      throw new Error('el plan se generó sin revisar la lista de supresión; vuelve a correr el dry-run con SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
    }
    leads = plan.leads || []
  }
  const db = !args.input || !args.all ? await getDb() : null
  if (!args.input) {
    leads = await db.fetchAllRows(() => db.supabase.from('aitickets_leads').select(COLUMNS).eq('source', SOURCE_KEY).order('created_at', { ascending: true }))
  }
  if (!args.all) {
    const { leads: kept, skipped } = filterExportableLeads(leads, await loadGuards(db))
    if (skipped.length) console.log(`${skipped.length} leads omitidos (suprimidos, inválidos o ya en outreach).`)
    leads = kept
  }
  const out = resolve(args.out || `leads/leads-${new Date().toISOString().slice(0, 10)}.csv`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buildLeadsCsv(leads))
  console.log(`${leads.length} leads exportados a ${out}`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Error:', err?.message || err)
    process.exit(1)
  })
}

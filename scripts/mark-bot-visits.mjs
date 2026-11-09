#!/usr/bin/env node
// Marca retroactivamente las visitas de bots y de desarrollo en event_visits (is_bot = true, bot_reason), con las
// mismas reglas que la ingesta (netlify/lib/visit-bots.mjs). NO borra nada: la analítica las excluye.
//
// Uso:
//   node --env-file=.env scripts/mark-bot-visits.mjs                 dry run: cuántas se marcarían, por evento y razón
//   node --env-file=.env scripts/mark-bot-visits.mjs --event 134     solo ese evento (dry run)
//   node --env-file=.env scripts/mark-bot-visits.mjs --apply         marca (requiere la migración 202611090100)
//   --json                                                          salida en JSON (para revisar o guardar)
//
// Solo marca (nunca desmarca): una visita ya marcada a mano o por la ingesta queda como está.
import { createClient } from '@supabase/supabase-js'
import { botReason } from '../netlify/lib/visit-bots.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const apply = flag('apply')
const asJson = flag('json')
const eventId = opt('event') ? Number(opt('event')) : null
if (opt('event') && !Number.isSafeInteger(eventId)) {
  console.error('--event inválido')
  process.exit(1)
}

const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (usa --env-file=.env)')
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

const PAGE = 1000
async function hasIsBotColumn() {
  const { error } = await supabase.from('event_visits').select('is_bot').limit(1)
  if (!error) return true
  if (['42703', 'PGRST204'].includes(String(error.code))) return false
  throw error
}

const withColumn = await hasIsBotColumn()
if (apply && !withColumn) {
  console.error('event_visits.is_bot no existe todavía: aplica la migración 202611090100_event_visits_bots.sql antes de --apply.')
  process.exit(1)
}

// Recorre por id (estable aunque se marquen filas en el camino)
const cols = `id, event_id, user_agent, city, country, referrer, created_at${withColumn ? ', is_bot' : ''}`
const toMark = []
let scanned = 0
let lastId = 0
for (;;) {
  let q = supabase.from('event_visits').select(cols).gt('id', lastId).order('id', { ascending: true }).limit(PAGE)
  if (eventId) q = q.eq('event_id', eventId)
  const { data, error } = await q
  if (error) throw error
  if (!data.length) break
  for (const v of data) {
    scanned++
    if (v.is_bot) continue
    const reason = botReason(v)
    if (reason) toMark.push({ id: v.id, event_id: v.event_id, reason, city: v.city, country: v.country, ua: (v.user_agent || '').slice(0, 90) })
  }
  lastId = data[data.length - 1].id
  if (data.length < PAGE) break
}

// Resumen por evento
const byEvent = new Map()
for (const m of toMark) {
  const e = byEvent.get(m.event_id) || { event_id: m.event_id, total: 0, reasons: {} }
  e.total++
  e.reasons[m.reason] = (e.reasons[m.reason] || 0) + 1
  byEvent.set(m.event_id, e)
}
const ids = [...byEvent.keys()]
const names = new Map()
for (let i = 0; i < ids.length; i += 200) {
  const { data } = await supabase.from('events').select('id, name, organization_id').in('id', ids.slice(i, i + 200))
  for (const e of data || []) names.set(e.id, e)
}
const visitsPerEvent = new Map()
for (const id of ids) {
  const { count } = await supabase.from('event_visits').select('id', { count: 'exact', head: true }).eq('event_id', id)
  visitsPerEvent.set(id, count ?? null)
}
const rows = [...byEvent.values()]
  .map((e) => ({ ...e, name: names.get(e.event_id)?.name ?? null, organization_id: names.get(e.event_id)?.organization_id ?? null, visits: visitsPerEvent.get(e.event_id) }))
  .sort((a, b) => b.total - a.total)
const reasons = {}
for (const m of toMark) reasons[m.reason] = (reasons[m.reason] || 0) + 1

if (asJson) {
  console.log(JSON.stringify({ apply, scanned, to_mark: toMark.length, reasons, events: rows, samples: toMark.slice(0, 50) }, null, 2))
} else {
  console.log(`${apply ? 'APLICANDO' : 'DRY RUN'}: ${scanned} visitas revisadas${eventId ? ` (evento ${eventId})` : ''}, ${toMark.length} se marcan como bot.`)
  console.log('Por razón:', reasons)
  console.log('\nPor evento (marcadas / visitas totales):')
  for (const r of rows) {
    const pct = r.visits ? ` (${((100 * r.total) / r.visits).toFixed(1)}%)` : ''
    console.log(`  ${String(r.event_id).padStart(5)}  ${String(r.total).padStart(4)} / ${String(r.visits ?? '?').padEnd(5)}${pct.padEnd(9)} ${String(r.name ?? '').slice(0, 40).padEnd(40)}  ${Object.entries(r.reasons).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  }
}

if (apply && toMark.length) {
  let updated = 0
  const groups = new Map()
  for (const m of toMark) groups.set(m.reason, [...(groups.get(m.reason) || []), m.id])
  for (const [reason, list] of groups) {
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await supabase
        .from('event_visits')
        .update({ is_bot: true, bot_reason: reason })
        .in('id', list.slice(i, i + 200))
        .eq('is_bot', false)
        .select('id')
      if (error) throw error
      updated += data.length
    }
  }
  console.log(`\nMarcadas: ${updated}.`)
}

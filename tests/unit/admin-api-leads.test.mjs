// MCP de administración: leads para contacto manual (list_leads, get_lead, update_lead, add_suppression, export_leads).
// Ninguna envía mensajes. Supabase falso: sin red.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const sent = []
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../netlify/lib/mailer.mjs', async (orig) => ({ ...(await orig()), sendEmail: vi.fn(async (msg) => { sent.push(msg); return { id: 'x' } }) }))

const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')

const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const NEAR = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
const lead = (n, extra = {}) => ({
  id: id(n), name_key: `producer:p${n}`, org_name: `Productora ${n}`, lead_type: 'producer', domain: `p${n}.cl`, website: `https://p${n}.cl`, city: 'Valparaíso', categories: ['musica'],
  email: `hola@p${n}.cl`, instagram: null, whatsapp: null, source: 'passline_search', status: 'new', invalid_reason: null, manual_only: true, events_on_passline: 1,
  last_passline_event: null, contact_sources: [], notes: null, created_at: `2026-10-0${n}T00:00:00Z`, ...extra,
})

const actx = (keyKind = 'full') => ({ supabase: db, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp'), keyKind, fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const raw = (name, args, keyKind) => runAdminTool(getAdminTool(name), args, actx(keyKind))
const run = async (name, args, keyKind) => {
  const out = await raw(name, args, keyKind)
  expect(out.ok, JSON.stringify(out)).toBe(true)
  return out.result
}
const REASON = 'Pidió no recibir más, por correo, 05-11'
const confirmAndRun = async (name, args) => {
  const first = await run(name, args)
  expect(first.status).toBe('confirmation_required')
  return { first, second: await run(name, { ...args, confirmation_token: first.confirmation_token }) }
}
const row = (n) => db.tables.aitickets_leads.find((l) => l.id === id(n))

beforeEach(() => {
  sent.length = 0
  db = createFakeSupabase({
    tables: {
      aitickets_leads: [
        lead(1, { categories: ['stand_up'], events_on_passline: 3, last_passline_event: { title: 'Show', date: NEAR, url: 'https://x.cl/e', venue: 'Sala' } }),
        lead(2),
        lead(3, { email: null, domain: null, website: null, instagram: 'p3', city: 'Santiago' }),
        lead(4, { email: 'bloqueado@p4.cl' }),
        lead(5, { status: 'invalid', invalid_reason: `duplicate_of:${id(1)}` }),
        lead(6, { manual_only: false, source: 'chilecultura', status: 'contacted' }),
        lead(7, { status: 'converted', email: 'cliente@p7.cl' }),
        lead(8, { email: null, domain: null, website: null }),
      ],
      aitickets_suppressions: [{ id: 1, email: 'bloqueado@p4.cl', domain: null, reason: 'manual' }],
      aitickets_competitor_events: [{ id: 1, lead_id: id(1), platform: 'passline', title: 'Show', url: 'https://x.cl/e', last_seen_at: '2026-11-01T00:00:00Z', times_seen: 2 }],
      aitickets_admin_audit: [],
      aitickets_admin_confirmations: [],
      aitickets_admin_idempotency: [],
    },
    unique: { aitickets_admin_idempotency: [['tool', 'idem_key']] },
  })
})

describe('list_leads', () => {
  it('ordena por prioridad, cuenta por estado y dice por qué no escribirle', async () => {
    const r = await run('list_leads', {})
    expect(r.total).toBe(8)
    expect(r.leads[0].id).toBe(id(1))
    expect(r.counts_by_status).toMatchObject({ new: 5, invalid: 1, contacted: 1, converted: 1 })
    const byId = new Map(r.leads.map((l) => [l.id, l]))
    expect(byId.get(id(2))).toMatchObject({ contactable: true, blocked_reason: null })
    expect(byId.get(id(4))).toMatchObject({ contactable: false, blocked_reason: 'correo en lista de supresión' })
    expect(byId.get(id(5))).toMatchObject({ contactable: false, blocked_reason: 'estado invalid' })
    expect(byId.get(id(8))).toMatchObject({ contactable: false, blocked_reason: null })
  })

  it('filtra por estado, ciudad sin tildes, texto, prioridad y contactables, y pagina', async () => {
    expect((await run('list_leads', { city: 'valparaiso', status: ['contacted'] })).leads.map((l) => l.id)).toEqual([id(6)])
    expect((await run('list_leads', { query: 'HOLA@P2' })).leads.map((l) => l.id)).toEqual([id(2)])
    const contactable = await run('list_leads', { contactable_only: true })
    expect(contactable.leads.map((l) => l.id)).not.toContain(id(4))
    expect(contactable.leads.map((l) => l.id)).toContain(id(3))
    expect((await run('list_leads', { min_priority: 50 })).leads.map((l) => l.id)).toEqual([id(1)])
    const page = await run('list_leads', { limit: 2, offset: 1 })
    expect(page.leads).toHaveLength(2)
    expect(page.total).toBe(8)
  })

  it('funciona con la llave de solo lectura y no escribe', async () => {
    const before = JSON.stringify(db.tables.aitickets_leads)
    expect((await run('list_leads', {}, 'readonly')).total).toBe(8)
    expect(JSON.stringify(db.tables.aitickets_leads)).toBe(before)
  })

  it('falla si no puede leer las bajas: nunca muestra contactable sin revisarlas', async () => {
    const realFrom = db.from.bind(db)
    db.from = (t) => {
      if (t !== 'aitickets_suppressions') return realFrom(t)
      const chain = { select: () => chain, order: () => chain, range: async () => ({ data: null, error: { code: '500', message: 'caída' } }) }
      return chain
    }
    expect((await raw('list_leads', {})).ok).toBe(false)
  })
})

describe('get_lead', () => {
  it('trae las fuentes y los eventos, y 404 si no existe', async () => {
    const r = await run('get_lead', { lead_id: id(1) })
    expect(r.competitor_events).toHaveLength(1)
    expect(r.contact_sources).toEqual([])
    const missing = await raw('get_lead', { lead_id: id(99) })
    expect(missing).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('update_lead', () => {
  it('pide motivo, y contacted guarda la fecha y las notas se acumulan', async () => {
    expect((await raw('update_lead', { lead_id: id(2), status: 'contacted' })).ok).toBe(false)
    const r = await run('update_lead', { lead_id: id(2), status: 'contacted', add_note: 'Le escribí por Gmail', reason: 'Contacto manual, 05-11' })
    expect(r.status).toBe('contacted')
    expect(row(2).last_contacted_at).toBeTruthy()
    await run('update_lead', { lead_id: id(2), add_note: 'Respondió que lo ve el lunes', reason: 'Seguimiento, 05-11' })
    expect(row(2).notes.split('\n')).toHaveLength(2)
    expect(row(2).status).toBe('contacted')
    const audit = db.tables.aitickets_admin_audit.at(-1)
    expect(audit.target).toBe(`lead:${id(2)}`)
    expect(JSON.stringify(audit)).not.toContain('Respondió')
  })

  it('no acepta fijar suppressed ni estados del outreach, y exige algún cambio', async () => {
    expect((await raw('update_lead', { lead_id: id(2), status: 'suppressed', reason: REASON })).ok).toBe(false)
    expect((await raw('update_lead', { lead_id: id(2), status: 'queued', reason: REASON })).ok).toBe(false)
    expect(await raw('update_lead', { lead_id: id(2), reason: REASON })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('no revive un lead con baja ni un duplicado, y no pisa una secuencia automática', async () => {
    row(2).status = 'suppressed'
    expect(await raw('update_lead', { lead_id: id(2), status: 'new', reason: REASON })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await raw('update_lead', { lead_id: id(5), status: 'new', reason: REASON })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await raw('update_lead', { lead_id: id(6), status: 'lost', reason: REASON })).toMatchObject({ ok: false, code: 'conflict' })
    expect(row(6).status).toBe('contacted')
    await run('update_lead', { lead_id: id(6), add_note: 'Nota', reason: REASON })
    expect(row(6).notes).toContain('Nota')
  })

  it('avisa si se registra un contacto a alguien con baja', async () => {
    const r = await run('update_lead', { lead_id: id(4), status: 'contacted', reason: REASON })
    expect(r.warnings.join(' ')).toMatch(/supresión/)
  })

  it('invalid guarda el motivo y salir de invalid lo limpia', async () => {
    await run('update_lead', { lead_id: id(2), status: 'invalid', reason: REASON })
    expect(row(2).invalid_reason).toBe('manual')
    await run('update_lead', { lead_id: id(2), status: 'new', reason: REASON })
    expect(row(2).invalid_reason).toBeNull()
  })
})

describe('add_suppression', () => {
  it('pide confirmación antes de escribir y luego frena al lead', async () => {
    const args = { lead_id: id(2), suppression_reason: 'unsubscribe', reason: REASON }
    const first = await run('add_suppression', args)
    expect(first.status).toBe('confirmation_required')
    expect(first.summary).toContain('hola@p2.cl')
    expect(row(2).status).toBe('new')
    expect(db.tables.aitickets_suppressions).toHaveLength(1)
    const second = await run('add_suppression', { ...args, confirmation_token: first.confirmation_token })
    expect(second).toMatchObject({ email_suppressed: true, domain_suppressed: null, leads_stopped: 1 })
    expect(row(2).status).toBe('suppressed')
    expect(db.tables.aitickets_suppressions.at(-1)).toMatchObject({ email: 'hola@p2.cl', domain: null, reason: 'unsubscribe', source: 'admin_mcp' })
    expect(JSON.stringify(db.tables.aitickets_admin_audit)).not.toContain('hola@p2.cl')
    expect(sent).toHaveLength(0)
  })

  it('con include_domain registra también el dominio', async () => {
    const { second } = await confirmAndRun('add_suppression', { lead_id: id(2), include_domain: true, suppression_reason: 'not_interested', reason: REASON })
    expect(second.domain_suppressed).toBe('p2.cl')
    expect(db.tables.aitickets_suppressions.map((s) => s.domain)).toContain('p2.cl')
  })

  it('un lead sin correo ni dominio queda igual con baja y ya no se exporta', async () => {
    const { second } = await confirmAndRun('add_suppression', { lead_id: id(3), suppression_reason: 'unsubscribe', reason: REASON })
    expect(second).toMatchObject({ email_suppressed: false, domain_suppressed: null })
    expect(row(3).status).toBe('suppressed')
    expect(db.tables.aitickets_suppressions).toHaveLength(1)
    expect((await run('export_leads', {})).csv).not.toContain('Productora 3')
  })

  it('un dominio frena a todos sus leads menos a los clientes', async () => {
    db.tables.aitickets_leads.push(lead(9, { domain: 'compartido.cl', email: 'a@compartido.cl', name_key: 'p9' }), lead(10, { domain: 'compartido.cl', email: 'b@compartido.cl', status: 'converted', name_key: 'p10' }))
    const { first, second } = await confirmAndRun('add_suppression', { domain: 'compartido.cl', suppression_reason: 'manual', reason: REASON })
    expect(first.details.leads).toEqual(['Productora 9'])
    expect(second.leads_stopped).toBe(1)
    expect(row(9).status).toBe('suppressed')
    expect(row(10).status).toBe('converted')
  })

  it('rechaza dominios de correo gratuito, un cliente y objetivos ambiguos', async () => {
    expect(await raw('add_suppression', { domain: 'gmail.com', suppression_reason: 'manual', reason: REASON })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await raw('add_suppression', { lead_id: id(7), suppression_reason: 'manual', reason: REASON })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await raw('add_suppression', { lead_id: id(2), email: 'x@y.cl', suppression_reason: 'manual', reason: REASON })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await raw('add_suppression', { suppression_reason: 'manual', reason: REASON })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await raw('add_suppression', { email: 'no-es-correo', suppression_reason: 'manual', reason: REASON })).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('no se puede hacer con la llave de solo lectura', async () => {
    expect((await raw('add_suppression', { lead_id: id(2), suppression_reason: 'manual', reason: REASON }, 'readonly')).ok).toBe(false)
  })
})

describe('export_leads', () => {
  it('exporta solo contactables de la fuente, por prioridad', async () => {
    const r = await run('export_leads', {})
    const lines = r.csv.trim().split('\n')
    expect(lines[0]).toContain('prioridad,nombre')
    expect(lines[1]).toContain('Productora 1')
    expect(r.csv).not.toContain('bloqueado@p4.cl')
    expect(r.csv).not.toContain('Productora 5')
    expect(r.csv).not.toContain('Productora 6')
    expect(r.skipped).toBe(2)
    expect(r.truncated).toBe(false)
  })

  it('respeta el límite y lo avisa, neutraliza fórmulas y exige la llave completa', async () => {
    row(2).org_name = '=HYPERLINK("x")'
    const all = await run('export_leads', {})
    expect(all.csv).toContain(`"'=HYPERLINK`)
    const one = await run('export_leads', { limit: 1 })
    expect(one).toMatchObject({ exported: 1, truncated: true })
    expect(one.csv).toContain('Productora 1')
    expect((await raw('export_leads', {}, 'readonly')).ok).toBe(false)
  })
})

it('ninguna herramienta de leads envía correos', async () => {
  await run('list_leads', {})
  await run('update_lead', { lead_id: id(2), status: 'contacted', reason: REASON })
  await confirmAndRun('add_suppression', { lead_id: id(1), suppression_reason: 'manual', reason: REASON })
  await run('export_leads', {})
  expect(sent).toHaveLength(0)
})

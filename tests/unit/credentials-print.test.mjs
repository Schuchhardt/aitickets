// Credenciales con nombre para imprimir (PENDIENTES_pronto ítem 21): una por entrada vigente, en orden alfabético,
// con el titular de la entrada (o quien compró), la empresa si la orden la tiene, el tipo de entrada y el QR; filtro
// por función; el PDF del panel (/api/events/credentials) y sus permisos. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  getSessionContext: async () => session,
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

const lib = await import('../../src/lib/credentials.ts')
const holder = await import('../../src/lib/attendeeHolder.mjs')
const endpoint = await import('../../src/pages/api/events/credentials.ts')
const { resolveModules } = await import('../../src/lib/eventModules.ts')

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`
const person = (first_name, last_name, email) => ({ attendees: { first_name, last_name, email } })

function seed() {
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 10, organization_id: 7, name: 'Congreso RRHH' },
        { id: 20, organization_id: 8, name: 'Ajeno' },
      ],
      event_dates: [
        { id: 501, event_id: 10, date: '2026-12-03', start_time: '09:00:00' },
        { id: 502, event_id: 10, date: '2026-12-04', start_time: '09:00:00' },
      ],
      event_tickets: [
        { id: 1, event_id: 10, ticket_name: 'Pase completo', event_date_id: null },
        { id: 2, event_id: 10, ticket_name: 'Solo día 1', event_date_id: 501 },
        { id: 3, event_id: 10, ticket_name: 'Solo día 2', event_date_id: 502 },
      ],
      event_attendees: [
        { id: id(1), event_id: 10, event_ticket_id: 1, status: 'active', qr_code: 'QR-1', event_order_id: 'o1', holder_name: 'Zoe Ruiz', ...person('Pedro', 'Compras', 'p@x.cl') },
        { id: id(2), event_id: 10, event_ticket_id: 2, status: 'validated', qr_code: 'QR-2', event_order_id: 'o1', ...person('Pedro', 'Compras', 'p@x.cl') },
        { id: id(3), event_id: 10, event_ticket_id: 3, status: null, qr_code: 'QR-3', event_order_id: 'o2', event_orders: { buyer_first_name: 'Ana', buyer_last_name: 'Soto' }, ...person('A', 'S', 'a@x.cl') },
        // Anulada: no se imprime
        { id: id(4), event_id: 10, event_ticket_id: 2, status: 'cancelled', qr_code: 'QR-4', ...person('Luis', 'Vera', 'l@x.cl') },
      ],
      event_orders: [{ id: 'o1', company_name: 'Empresa Ejemplo SpA' }, { id: 'o2' }],
    },
  })
}

beforeEach(() => {
  seed()
  session = { dbUser: { id: 1, role: 'producer', organization_id: 7, name: 'Ana', email: 'a@p.cl' } }
})

const call = (query) => endpoint.GET({ url: new URL(`https://aitickets.test/api/events/credentials?${query}`), request: new Request('https://aitickets.test/api/events/credentials'), cookies: {} })
const pages = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length

describe('titular de la entrada', () => {
  it('el nombre y correo de la entrada mandan; si no, la orden; si no, el attendee', () => {
    expect(holder.ticketHolder({ holder_name: ' Zoe  Ruiz ', holder_email: 'ZOE@x.cl', ...person('Pedro', 'C', 'p@x.cl') })).toEqual({ name: 'Zoe Ruiz', email: 'zoe@x.cl' })
    expect(holder.ticketHolder({ event_orders: [{ buyer_first_name: 'Ana', buyer_last_name: 'Soto', buyer_email: 'ana@x.cl' }], ...person('A', 'S', 'viejo@x.cl') })).toEqual({ name: 'Ana Soto', email: 'ana@x.cl' })
    expect(holder.ticketHolder({ holder_name: null, holder_email: undefined, ...person('Pedro', 'Compras', 'P@x.cl') })).toEqual({ name: 'Pedro Compras', email: 'p@x.cl' })
    expect(holder.ticketHolder({})).toEqual({ name: '', email: '' })
  })

  it('la empresa de la orden, solo si la columna existe', async () => {
    expect(await holder.loadOrderCompanies(db, ['o1', 'o2', 'o1'])).toEqual(new Map([['o1', 'Empresa Ejemplo SpA']]))
    db.failOn('event_orders', 'select', { code: '42703', message: 'column event_orders.company_name does not exist' })
    expect(await holder.loadOrderCompanies(db, ['o1'])).toEqual(new Map())
  })
})

describe('credenciales', () => {
  it('una por entrada vigente, en orden alfabético, con empresa, tipo, función y QR', async () => {
    const cards = await lib.loadCredentials(db, 10)
    expect(cards.map((c) => [c.name, c.company, c.ticketType, c.functionLabel, c.qr])).toEqual([
      ['Ana Soto', null, 'Solo día 2', 'Vie 4 dic · 09:00', 'QR-3'],
      ['Pedro Compras', 'Empresa Ejemplo SpA', 'Solo día 1', 'Jue 3 dic · 09:00', 'QR-2'],
      ['Zoe Ruiz', 'Empresa Ejemplo SpA', 'Pase completo', 'Todas las funciones', 'QR-1'],
    ])
    expect(cards[0].code).toBe('00000000')
  })

  it('por función: las de esa función y los pases', async () => {
    expect((await lib.loadCredentials(db, 10, { functionId: 501 })).map((c) => c.name)).toEqual(['Pedro Compras', 'Zoe Ruiz'])
    expect(await lib.loadCredentials(db, 10, { functionId: 999 })).toBeNull()
  })

  it('el módulo va en la pestaña Puerta, sugerido para seminarios, cuando hay entradas', () => {
    const c = { profile: 'formacion', status: 'published', functionCount: 2, ticketTypeCount: 3, phase: 'before', waitlistCount: 0, hasAttendees: true, isMassive: false }
    const byId = (mods) => Object.fromEntries(mods.map((m) => [m.id, m]))
    expect(byId(resolveModules(c)).credentials).toMatchObject({ tab: 'puerta', enabled: true })
    expect(byId(resolveModules({ ...c, hasAttendees: false })).credentials).toBeUndefined()
  })
})

describe('/api/events/credentials', () => {
  it('descarga el PDF (4 por hoja)', async () => {
    const res = await call('event_id=10')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="credenciales-congreso-rrhh.pdf"')
    const pdf = Buffer.from(await res.arrayBuffer())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pages(pdf)).toBe(1)
  })

  it('pide sesión, permiso para ver asistentes y que el evento sea de la organización', async () => {
    expect((await call('event_id=20')).status).toBe(404)
    expect((await call('event_id=10&function_id=999')).status).toBe(404)
    session = { dbUser: { ...session.dbUser, role: 'validator' } }
    expect((await call('event_id=10')).status).toBe(403)
    session = null
    expect((await call('event_id=10')).status).toBe(401)
  })
})

// Certificados de asistencia (PENDIENTES_pronto ítem 20): quién lo recibe (solo quienes ingresaron, con mínimo de
// funciones en los pases), nombre del titular o de quien compró, fechas y horas, el PDF, el link firmado de cada
// asistente (/certificado/<token>) y el envío por correo con confirmación. Sin red ni BD: el correo se simula.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const sent = []
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../netlify/lib/mailer.mjs', async (orig) => ({
  ...(await orig()),
  sendEmail: async (msg) => {
    sent.push(msg)
    return { id: `m${sent.length}` }
  },
}))

const lib = await import('../../src/lib/certificates.ts')
const holder = await import('../../src/lib/attendeeHolder.mjs')
const token = await import('../../netlify/lib/certificate-token.mjs')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { certificateTools } = await import('../../src/lib/producer-api/tools/certificates.ts')
const publicEndpoint = await import('../../src/pages/certificado/[token].ts')
const { resolveModules } = await import('../../src/lib/eventModules.ts')

const tool = (name) => certificateTools.find((t) => t.name === name)
const id = (n) => `00000000-0000-4000-8000-00000000000${n}`
const buyer = (first_name, last_name, email) => ({ attendees: { first_name, last_name, email } })

function seed() {
  sent.length = 0
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Productora Sur', email: 'hola@sur.cl' }],
      events: [
        // Congreso de 2 días que ya terminó y uno que todavía no empieza
        { id: 10, organization_id: 7, name: 'Congreso RRHH', status: 'published', start_date: '2026-10-01T12:00:00Z', end_date: '2026-10-02T15:30:00Z' },
        { id: 11, organization_id: 7, name: 'Futuro', status: 'published', start_date: '2099-01-01T12:00:00Z', end_date: '2099-01-01T15:00:00Z' },
      ],
      event_dates: [
        { id: 501, event_id: 10, date: '2026-10-01', start_time: '09:00:00', end_time: '13:00:00' },
        { id: 502, event_id: 10, date: '2026-10-02', start_time: '09:00:00', end_time: '12:30:00' },
      ],
      event_tickets: [
        { id: 1, event_id: 10, ticket_name: 'Pase completo', event_date_id: null },
        { id: 2, event_id: 10, ticket_name: 'Solo día 1', event_date_id: 501 },
      ],
      event_attendees: [
        // Titular con nombre propio (ítem 19): manda sobre el comprador
        { id: id(1), event_id: 10, event_ticket_id: 1, status: 'validated', validated_at: '2026-10-01T12:05:00Z', holder_name: 'Carolina Muñoz', holder_email: 'Caro@X.cl', ...buyer('Pedro', 'Compras', 'pedro@x.cl') },
        // Sin titular: el nombre de la orden; fue solo al día 1
        { id: id(2), event_id: 10, event_ticket_id: 1, status: 'validated', validated_at: '2026-10-01T12:10:00Z', event_order_id: 'o2', event_orders: { buyer_first_name: 'Diego', buyer_last_name: 'Fuentes', buyer_email: 'diego@x.cl' }, ...buyer('D', 'F', 'viejo@x.cl') },
        { id: id(3), event_id: 10, event_ticket_id: 2, status: 'validated', validated_at: '2026-10-01T12:20:00Z', ...buyer('Rodrigo', 'Pérez', 'rodrigo@x.cl') },
        // No ingresó / anulada
        { id: id(4), event_id: 10, event_ticket_id: 2, status: 'active', ...buyer('Ana', 'Soto', 'ana@x.cl') },
        { id: id(5), event_id: 10, event_ticket_id: 1, status: 'cancelled', validated_at: '2026-10-01T12:00:00Z', ...buyer('Luis', 'Vera', 'luis@x.cl') },
        // Otra entrada del mismo correo (compró para dos): un solo correo con los dos certificados
        { id: id(6), event_id: 10, event_ticket_id: 2, status: 'validated', validated_at: '2026-10-01T12:11:00Z', event_order_id: 'o2', event_orders: { buyer_first_name: 'Diego', buyer_last_name: 'Fuentes', buyer_email: 'diego@x.cl' }, ...buyer('D', 'F', 'viejo@x.cl') },
      ],
      aitickets_attendee_checkins: [
        { id: 1, event_attendee_id: id(1), event_id: 10, event_date_id: 501, checked_in_at: '2026-10-01T12:05:00Z' },
        { id: 2, event_attendee_id: id(1), event_id: 10, event_date_id: 502, checked_in_at: '2026-10-02T12:01:00Z' },
        { id: 3, event_attendee_id: id(2), event_id: 10, event_date_id: 501, checked_in_at: '2026-10-01T12:10:00Z' },
      ],
      aitickets_certificate_sends: [],
      aitickets_api_audit: [],
      aitickets_api_confirmations: [],
      aitickets_api_idempotency: [],
    },
  })
}

beforeEach(() => {
  seed()
  vi.stubEnv('INTERNAL_API_SECRET', 'secreto-de-prueba-para-firmar-certificados')
})

const ctx = (over = {}) => ({
  supabase: db,
  actor: { keyId: null, userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'write', 'publish', 'attendees'], eventIds: null, ...over },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/events/certificates'),
  channel: 'dashboard',
})
const EVENT = { id: 10, name: 'Congreso RRHH', organization_id: 7, start_date: '2026-10-01T12:00:00Z' }
const pages = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length

describe('textos del certificado', () => {
  it('fechas', () => {
    expect(lib.datesText(['2026-12-03'])).toBe('el 3 de diciembre de 2026')
    expect(lib.datesText(['2026-12-04', '2026-12-03', '2026-12-03'])).toBe('los días 3 y 4 de diciembre de 2026')
    expect(lib.datesText(['2026-11-30', '2026-12-01', '2026-12-02'])).toBe('los días 30 de noviembre, 1 de diciembre y 2 de diciembre de 2026')
    expect(lib.datesText(['2026-12-31', '2027-01-01'])).toBe('los días 31 de diciembre de 2026 y 1 de enero de 2027')
  })
  it('horas: suma de las funciones; sin hora de término no se dicen', () => {
    expect(lib.sessionsHours([{ start_time: '09:00', end_time: '13:00' }, { start_time: '09:00:00', end_time: '12:30:00' }])).toBe(7.5)
    expect(lib.sessionsHours([{ start_time: '22:00', end_time: '01:00' }])).toBe(3)
    expect(lib.sessionsHours([{ start_time: '09:00', end_time: null }])).toBeNull()
    expect(lib.hoursLabel(7.5)).toBe('7,5 horas')
    expect(lib.hoursLabel(1)).toBe('1 hora')
  })
})

describe('quién recibe certificado', () => {
  it('solo quienes ingresaron, con el titular o quien compró, sus días y horas', async () => {
    const { rows } = await lib.loadCertificates(db, EVENT)
    expect(rows.map((r) => [r.name, r.email, r.sessions_attended, r.dates, r.hours, r.eligible])).toEqual([
      ['Carolina Muñoz', 'caro@x.cl', 2, ['2026-10-01', '2026-10-02'], 7.5, true],
      ['Diego Fuentes', 'diego@x.cl', 1, ['2026-10-01'], 4, true],
      ['Diego Fuentes', 'diego@x.cl', 1, ['2026-10-01'], 4, true],
      ['Rodrigo Pérez', 'rodrigo@x.cl', 1, ['2026-10-01'], 4, true],
    ])
  })

  it('con mínimo de días, el pase que fue un día queda fuera (la entrada de un día no)', async () => {
    const { rows } = await lib.loadCertificates(db, EVENT, { minSessions: 2 })
    expect(rows.filter((r) => !r.eligible).map((r) => [r.ticket_id, r.reason])).toEqual([[id(2), 'below_min_sessions']])
  })

  it('horas fijadas por el productor; sin la tabla de ingresos por función, cuenta el día en que se validó', async () => {
    db.failOn('aitickets_attendee_checkins', 'select', { code: '42P01', message: 'no existe' })
    const { rows } = await lib.loadCertificates(db, EVENT, { hours: 16 })
    expect(rows.find((r) => r.name === 'Carolina Muñoz')).toMatchObject({ sessions_attended: 1, dates: ['2026-10-01'], hours: 16 })
  })

  it('sin las columnas holder_* (aún sin migrar) repite la consulta sin ellas', async () => {
    db.failOn('event_attendees', 'select', { code: '42703', message: 'column event_attendees.holder_name does not exist' })
    const rows = await holder.loadEventTickets(db, 10, 'id, status')
    expect(rows).toHaveLength(6)
    expect(db.calls.filter((c) => c.table === 'event_attendees')).toHaveLength(2)
  })

  it('el PDF trae una página por certificado', async () => {
    const certs = await lib.loadCertificates(db, EVENT)
    const pdf = lib.renderCertificates(certs, certs.rows)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pages(pdf)).toBe(4)
  })
})

describe('link firmado del asistente', () => {
  it('firma y verifica; alterado o sin secreto no sirve', () => {
    const t = token.signCertificateToken({ ticketIds: [id(1), id(3)], minSessions: 2, hours: 7.5 })
    expect(token.verifyCertificateToken(t)).toEqual({ ticketIds: [id(1), id(3)], minSessions: 2, hours: 7.5 })
    expect(token.verifyCertificateToken(`${t}x`)).toBeNull()
    expect(token.verifyCertificateToken('basura')).toBeNull()
    vi.stubEnv('INTERNAL_API_SECRET', '')
    expect(token.signCertificateToken({ ticketIds: [id(1)] })).toBe('')
  })

  it('/certificado/<token> entrega el PDF de sus entradas, y nada si ya no corresponde', async () => {
    const ok = await publicEndpoint.GET({ params: { token: token.signCertificateToken({ ticketIds: [id(2), id(6)] }) } })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Type')).toBe('application/pdf')
    expect(pages(Buffer.from(await ok.arrayBuffer()))).toBe(2)
    // Con mínimo de 2 días, el pase de Diego no sale (su entrada de un día sí)
    const min2 = await publicEndpoint.GET({ params: { token: token.signCertificateToken({ ticketIds: [id(2), id(6)], minSessions: 2 }) } })
    expect(pages(Buffer.from(await min2.arrayBuffer()))).toBe(1)
    const notIn = await publicEndpoint.GET({ params: { token: token.signCertificateToken({ ticketIds: [id(4)] }) } })
    expect(notIn.status).toBe(404)
    expect((await publicEndpoint.GET({ params: { token: 'x.y' } })).status).toBe(404)
  })
})

describe('get_attendance_certificates / send_attendance_certificates', () => {
  it('lista los certificados con el link de cada uno', async () => {
    const res = await runTool(tool('get_attendance_certificates'), { event_id: 10, min_sessions: 2 }, ctx())
    expect(res.ok).toBe(true)
    expect(res.result.summary).toEqual({ checked_in: 4, eligible: 3, below_min_sessions: 1, missing_name: 0, without_email: 0, already_sent: 0 })
    expect(res.result.event_ended).toBe(true)
    expect(res.result.pdf_download_url).toBe('https://aitickets.test/api/events/certificates?event_id=10&format=pdf&min_sessions=2')
    const caro = res.result.certificates.find((c) => c.name === 'Carolina Muñoz')
    expect(caro).toMatchObject({ sessions_attended: 2, sessions_total: 2, hours: 7.5, emailed: false })
    expect(token.verifyCertificateToken(caro.certificate_url.split('/certificado/')[1])).toMatchObject({ ticketIds: [id(1)], minSessions: 2 })
    // Puerta no ve datos de asistentes
    expect(await runTool(tool('get_attendance_certificates'), { event_id: 10 }, ctx({ role: 'validator' }))).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('enviar pide confirmación, manda un correo por persona y no repite', async () => {
    const first = await runTool(tool('send_attendance_certificates'), { event_id: 10 }, ctx())
    expect(first.result.status).toBe('confirmation_required')
    expect(first.result.summary).toBe('Se enviará el certificado de asistencia de "Congreso RRHH" a 3 persona(s) (4 certificado(s)).')
    expect(sent).toHaveLength(0)

    const second = await runTool(tool('send_attendance_certificates'), { event_id: 10, confirmation_token: first.result.confirmation_token }, ctx())
    expect(second).toMatchObject({ ok: true, result: { sent: 3, failed: 0, certificates: 4, remaining: 0 } })
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toBe('Tu certificado de asistencia: Congreso RRHH')
    expect(sent[0].replyTo).toBe('hola@sur.cl')
    expect(sent[0].to).toEqual(['Carolina Muñoz <caro@x.cl>', 'Diego Fuentes <diego@x.cl>', 'Rodrigo Pérez <rodrigo@x.cl>'])
    expect(sent[0].html).toContain('%recipient.certificate_url%')
    const diego = sent[0].recipientVariables['diego@x.cl']
    expect(diego.name.text).toBe('Diego')
    expect(token.verifyCertificateToken(diego.certificate_url.text.split('/certificado/')[1]).ticketIds).toEqual([id(2), id(6)])
    expect(db.tables.aitickets_certificate_sends).toHaveLength(1)
    expect(db.tables.aitickets_certificate_sends[0]).toMatchObject({ event_id: 10, organization_id: 7, recipients_count: 3, created_by: 1 })

    const again = await runTool(tool('send_attendance_certificates'), { event_id: 10 }, ctx())
    expect(again).toMatchObject({ ok: false, code: 'conflict' })
    expect(again.message).toContain('ya se enviaron')
  })

  it('solo con el evento terminado, con el permiso de mensajes y con la tabla de envíos', async () => {
    expect(await runTool(tool('send_attendance_certificates'), { event_id: 11 }, ctx())).toMatchObject({ ok: false, code: 'conflict' })
    expect(await runTool(tool('send_attendance_certificates'), { event_id: 10 }, ctx({ role: 'finance' }))).toMatchObject({ ok: false, code: 'forbidden' })
    db.failOn('aitickets_certificate_sends', 'select', { code: '42P01', message: 'no existe' }, { once: false })
    expect(await runTool(tool('send_attendance_certificates'), { event_id: 10 }, ctx())).toMatchObject({ ok: false, code: 'unavailable' })
    expect((await runTool(tool('get_attendance_certificates'), { event_id: 10 }, ctx())).result.sends).toBeNull()
    expect(sent).toHaveLength(0)
  })

  it('el módulo del panel aparece para seminarios desde que el evento empieza', () => {
    const c = { profile: 'formacion', status: 'published', functionCount: 2, ticketTypeCount: 2, phase: 'after', waitlistCount: 0, hasAttendees: true, isMassive: false }
    const byId = (mods) => Object.fromEntries(mods.map((m) => [m.id, m]))
    expect(byId(resolveModules(c)).certificates).toMatchObject({ tab: 'despues', enabled: true })
    expect(byId(resolveModules({ ...c, phase: 'before' })).certificates).toBeUndefined()
    expect(byId(resolveModules({ ...c, profile: 'musica' })).certificates).toMatchObject({ enabled: false })
  })
})

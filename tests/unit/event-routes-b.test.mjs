// Rutas del panel de eventos con sesión + rol de gestión (getSessionContext + EVENT_MANAGER_ROLES + getOwnedEvent):
// /api/events/ai, community, courtesy, cover, documents, duplicate, faqs, function-settlement, invitations, modules,
// preview-links, reviews, upload-image y waitlist-list.
// Sesión REAL (cookie → db.auth.getUser → users → organización verificada) y getOwnedEvent REAL (organización +
// aitickets_event_staff); solo se simulan Supabase (en memoria), Storage, IA, correo y Slack.
// Por cada ruta: 401 sin sesión, 403 para finanzas/puerta/solo lectura, evento de otra organización → negado sin
// escribir, miembro limitado a otro evento → negado, y el camino feliz con lo que queda escrito.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const mocks = vi.hoisted(() => ({
  notifySlack: vi.fn(async () => {}),
  sendTicketsEmail: vi.fn(async () => ({ ok: true })),
  callInternalFunction: vi.fn(async () => ({ ok: true, status: 202, data: {} })),
  description: vi.fn(async () => '<p>Una noche inolvidable.</p>'),
  faqs: vi.fn(async () => [{ question: '¿Hay guardarropía?', answer: 'Sí.' }]),
  image: vi.fn(async () => 'https://proj.supabase.co/storage/v1/object/public/Events/ai/7-cover.png'),
}))
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/pages/api/_lib/server-utils', async (orig) => ({
  ...(await orig()),
  notifySlack: mocks.notifySlack,
  sendTicketsEmail: mocks.sendTicketsEmail,
  callInternalFunction: mocks.callInternalFunction,
}))
vi.mock('../../src/lib/aiText', async (orig) => ({
  ...(await orig()),
  isTextGenerationConfigured: () => true,
  generateEventDescription: mocks.description,
  generateEventFaqs: mocks.faqs,
}))
vi.mock('../../src/lib/marketing', async (orig) => ({ ...(await orig()), isImageGenerationConfigured: () => true, generateEventImage: mocks.image }))

const ai = await import('../../src/pages/api/events/ai.ts')
const community = await import('../../src/pages/api/events/community.ts')
const courtesy = await import('../../src/pages/api/events/courtesy.ts')
const cover = await import('../../src/pages/api/events/cover.ts')
const documents = await import('../../src/pages/api/events/documents.ts')
const duplicate = await import('../../src/pages/api/events/duplicate.ts')
const faqs = await import('../../src/pages/api/events/faqs.ts')
const settlement = await import('../../src/pages/api/events/function-settlement.ts')
const invitations = await import('../../src/pages/api/events/invitations.ts')
const modules = await import('../../src/pages/api/events/modules.ts')
const previewLinks = await import('../../src/pages/api/events/preview-links.ts')
const reviews = await import('../../src/pages/api/events/reviews.ts')
const uploadImage = await import('../../src/pages/api/events/upload-image.ts')
const waitlistList = await import('../../src/pages/api/events/waitlist-list.ts')
const { sha256Hex } = await import('../../src/lib/eventPreview.ts')

const DAY = 86400000
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const chileDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() + ms))
const FUTURE_DAY = chileDay(20 * DAY)

// ---------------------------------------------------------------------------
// Sesión real
// ---------------------------------------------------------------------------
const WHO = { producer: 1, admin: 2, editor: 3, finance: 4, validator: 5, viewer: 6, staff: 7 }
const ROLE_OF = { producer: 'producer', admin: 'admin', editor: 'editor', finance: 'finance', validator: 'validator', viewer: 'viewer', staff: 'editor' }
const MANAGERS = ['producer', 'admin', 'editor']
const NON_MANAGERS = ['finance', 'validator', 'viewer']
const tokens = new Map()
let tokenSeq = 0

function cookiesFor(who) {
  if (!who) return { get: () => undefined, set() {}, delete() {} }
  const token = `tok-${who}-${++tokenSeq}`
  tokens.set(token, `auth-${WHO[who]}`)
  return { get: (name) => (name === 'sb-access-token' ? { value: token } : undefined), set() {}, delete() {} }
}

async function hit(handler, who, { method = 'GET', path = '/api/x', query = {}, body, form } = {}) {
  const url = new URL(`https://aitickets.test${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  const init = { method }
  if (body !== undefined) Object.assign(init, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  if (form) init.body = form
  const res = await handler({ request: new Request(url, init), url, cookies: cookiesFor(who), locals: {}, redirect: (to, status = 302) => new Response(null, { status, headers: { Location: to } }) })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, res, body: json, text }
}

const writesTo = (table) => db.calls.filter((c) => c.table === table && ['insert', 'update', 'upsert', 'delete'].includes(c.op))
const noWrites = (...tables) => tables.forEach((t) => expect(writesTo(t), `escrituras en ${t}`).toHaveLength(0))

/**
 * fake-supabase no implementa .or() (lanza a propósito). duplicateEventAsDraft filtra event_tickets con
 * .or('status.is.null,status.neq.unavailable'): aquí se aplica ese filtro de verdad sobre el resultado (no se ignora).
 */
function withOrFilter(client) {
  const from = client.from
  const cond = (expr) => {
    const [col, op, ...rest] = expr.split('.')
    const value = rest.join('.')
    if (op === 'is' && value === 'null') return (r) => r[col] === null || r[col] === undefined
    if (op === 'eq') return (r) => String(r[col]) === value
    if (op === 'neq') return (r) => String(r[col]) !== value
    throw new Error(`withOrFilter: ${expr} no soportado`)
  }
  client.from = (table) => {
    const b = from(table)
    let keep = null
    b.or = (expr) => {
      const conds = expr.split(',').map(cond)
      keep = (r) => conds.some((c) => c(r))
      return b
    }
    const then = b.then
    b.then = (resolve, reject) => then((res) => resolve(keep && Array.isArray(res?.data) ? { ...res, data: res.data.filter(keep) } : res), reject)
    return b
  }
}

/** Mismo estado para varios roles y sin escrituras en `tables`. */
async function expectStatusFor(handler, roles, opts, status, tables = []) {
  for (const who of roles) {
    const out = await hit(handler, who, opts)
    expect(out.status, `${who} → ${JSON.stringify(opts.query || opts.body || {})}`).toBe(status)
  }
  noWrites(...tables)
}

const EVENTS = [
  { id: 10, organization_id: 7, name: 'Show pasado', slug: 'show-pasado', status: 'published', description: '<p>Rock</p>', image_url: 'https://img.test/10.jpg', start_date: '2026-10-01T23:00:00Z', end_date: '2026-10-02T02:00:00Z', cancelled_at: null, capacity: 300, accessibility: 'public', panel_modules: ['faq'] },
  { id: 11, organization_id: 7, name: 'Próximo show', slug: 'proximo', status: 'published', start_date: `${FUTURE_DAY}T23:00:00Z`, end_date: `${FUTURE_DAY}T23:59:00Z`, cancelled_at: null },
  { id: 20, organization_id: 8, name: 'Ajeno', slug: 'ajeno', status: 'published', start_date: `${FUTURE_DAY}T23:00:00Z`, end_date: `${FUTURE_DAY}T23:59:00Z`, cancelled_at: null, image_url: 'https://img.test/20.jpg' },
]

function seed(tables = {}) {
  const users = Object.entries(WHO).map(([who, uid]) => ({ id: uid, auth_user_id: `auth-${uid}`, name: who, email: `${who}@sur.cl`, organization_id: 7, role: ROLE_OF[who], active: true }))
  db = createFakeSupabase({
    tables: {
      organizations: [
        { id: 7, public_name: 'Productora Sur', email: 'hola@sur.cl', email_verified_at: '2026-01-01T00:00:00Z', terms_accepted_at: '2026-01-01T00:00:00Z' },
        { id: 8, public_name: 'Otra', email_verified_at: '2026-01-01T00:00:00Z', terms_accepted_at: '2026-01-01T00:00:00Z' },
      ],
      users,
      // staff (marketing) solo tiene acceso al evento 11
      aitickets_event_staff: [{ organization_id: 7, event_id: 11, user_id: 7 }],
      events: EVENTS.map((e) => ({ ...e })),
      event_dates: [
        { id: 501, event_id: 10, date: '2026-10-01', start_time: '20:00:00', end_time: '23:00:00' },
        { id: 511, event_id: 11, date: FUTURE_DAY, start_time: '20:00:00', end_time: '23:00:00' },
        { id: 520, event_id: 20, date: FUTURE_DAY, start_time: '20:00:00', end_time: null },
      ],
      aitickets_api_audit: [],
      ...tables,
    },
  })
  db.auth = {
    getUser: async (token) =>
      tokens.has(token) ? { data: { user: { id: tokens.get(token), email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } },
  }
}

beforeEach(() => {
  tokens.clear()
  for (const m of Object.values(mocks)) m.mockClear()
})

// ---------------------------------------------------------------------------
describe('/api/events/ai', () => {
  const post = (who, body) => hit(ai.POST, who, { method: 'POST', body })
  beforeEach(() => seed({ event_faqs: [{ id: 1, event_id: 10, question: '¿Hay estacionamiento?', answer: 'No.' }, { id: 9, event_id: 20, question: 'Ajena', answer: 'x' }] }))

  it('sin sesión 401; finanzas, puerta y solo lectura 403 sin llamar a la IA', async () => {
    expect((await post(null, { action: 'description', eventId: 10 })).status).toBe(401)
    await expectStatusFor(ai.POST, NON_MANAGERS, { method: 'POST', body: { action: 'cover', eventId: 10 } }, 403)
    expect(mocks.image).not.toHaveBeenCalled()
    expect(mocks.description).not.toHaveBeenCalled()
  })

  it('evento de otra organización o no asignado: 404 sin generar (ni gastar cupo)', async () => {
    for (const action of ['description', 'faqs', 'cover']) {
      expect((await post('producer', { action, eventId: 20 })).status).toBe(404)
      expect((await post('staff', { action, eventId: 10 })).status).toBe(404)
    }
    expect(mocks.description).not.toHaveBeenCalled()
    expect(mocks.faqs).not.toHaveBeenCalled()
    expect(mocks.image).not.toHaveBeenCalled()
  })

  it('feliz: descripción (con el borrador del formulario), FAQs sin repetir las existentes y portada en la organización', async () => {
    for (const who of MANAGERS) {
      const out = await post(who, { action: 'description', eventId: 10, guide: 'tono cercano', draft: { name: 'Show renovado' } })
      expect(out.status, who).toBe(200)
      expect(out.body.html).toBe('<p>Una noche inolvidable.</p>')
    }
    expect(mocks.description.mock.calls[0][0]).toContain('Show renovado')
    expect(mocks.description.mock.calls[0][1]).toBe('tono cercano')

    const f = await post('editor', { action: 'faqs', eventId: 10 })
    expect(f.status).toBe(200)
    expect(f.body.faqs).toEqual([{ question: '¿Hay guardarropía?', answer: 'Sí.' }])
    expect(mocks.faqs.mock.calls[0][1]).toEqual(['¿Hay estacionamiento?'])

    const c = await post('admin', { action: 'cover', eventId: 10, guide: 'más colorida' })
    expect(c.status).toBe(200)
    expect(c.body.url).toMatch(/^https:\/\//)
    expect(mocks.image).toHaveBeenCalledTimes(1)
    expect(mocks.image.mock.calls[0][1]).toBe(7) // se guarda en la carpeta de la organización de la sesión
    expect(mocks.image.mock.calls[0][2]).toMatchObject({ size: '1536x1024', referenceImages: [] })
    // Las FAQs y la portada exigen evento; acción desconocida: 400
    expect((await post('producer', { action: 'faqs' })).status).toBe(400)
    expect((await post('producer', { action: 'cover' })).status).toBe(400)
    expect((await post('producer', { action: 'otra', eventId: 10 })).status).toBe(400)
  })

  it('el miembro limitado sí genera para su evento', async () => {
    expect((await post('staff', { action: 'faqs', eventId: 11 })).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/community', () => {
  const MSG = { m10: uuid(1), m11: uuid(2), m20: uuid(9) }
  const POST_ID = { p10: uuid(11), p10b: uuid(12), p20: uuid(19) }
  beforeEach(() =>
    seed({
      aitickets_attendee_messages: [
        { id: MSG.m10, event_id: 10, name: 'Pía', email: 'pia@x.cl', message: '¿A qué hora abren?', delivered_at: '2026-10-01T10:00:00Z', read_at: null, created_at: '2026-10-01T10:00:00Z' },
        { id: MSG.m11, event_id: 11, name: 'Leo', email: 'leo@x.cl', message: 'Hola', read_at: null, created_at: '2026-10-01T11:00:00Z' },
        { id: MSG.m20, event_id: 20, name: 'Ajeno', email: 'aj@x.cl', message: 'Ajeno', read_at: null, created_at: '2026-10-01T12:00:00Z' },
      ],
      aitickets_event_feed_posts: [
        { id: POST_ID.p10, event_id: 10, display_name: 'Pía', email: 'pia@x.cl', emoji: '🔥', message: '¡Vamos!', status: 'visible', created_at: '2026-10-01T10:00:00Z' },
        { id: POST_ID.p10b, event_id: 10, display_name: 'Spam', email: 's@x.cl', emoji: '🎉', message: 'compra aquí', status: 'hidden', created_at: '2026-10-01T10:05:00Z' },
        { id: POST_ID.p20, event_id: 20, display_name: 'Ajeno', email: 'aj@x.cl', emoji: '🔥', message: 'x', status: 'visible', created_at: '2026-10-01T10:00:00Z' },
      ],
    }),
  )
  const post = (who, body) => hit(community.POST, who, { method: 'POST', body })

  it('GET: sin sesión 401; finanzas, puerta y solo lectura 403; otra organización y no asignado 404', async () => {
    expect((await hit(community.GET, null, { query: { eventId: 10 } })).status).toBe(401)
    await expectStatusFor(community.GET, NON_MANAGERS, { query: { eventId: 10 } }, 403)
    const foreign = await hit(community.GET, 'producer', { query: { eventId: 20 } })
    expect(foreign.status).toBe(404)
    expect(foreign.text).not.toContain('aj@x.cl')
    expect((await hit(community.GET, 'staff', { query: { eventId: 10 } })).status).toBe(404)
    expect((await hit(community.GET, 'staff', { query: { eventId: 11 } })).status).toBe(200)
  })

  it('GET feliz: mensajes, no leídos y muro del evento (con correos, solo para la productora)', async () => {
    for (const who of MANAGERS) {
      const out = await hit(community.GET, who, { query: { eventId: 10 } })
      expect(out.status, who).toBe(200)
      expect(out.body).toMatchObject({ unread: 1, total: 1 })
      expect(out.body.messages).toEqual([expect.objectContaining({ id: MSG.m10, email: 'pia@x.cl', delivered: true })])
      expect(out.body.posts.map((p) => p.id)).toEqual([POST_ID.p10, POST_ID.p10b])
    }
  })

  it('POST: roles sin gestión 403, otra organización y no asignado 404, sin escribir', async () => {
    await expectStatusFor(community.POST, NON_MANAGERS, { method: 'POST', body: { eventId: 10, action: 'message_read', id: MSG.m10, read: true } }, 403, ['aitickets_attendee_messages'])
    expect((await post(null, { eventId: 10, action: 'message_read', id: MSG.m10 })).status).toBe(401)
    expect((await post('producer', { eventId: 20, action: 'post_status', id: POST_ID.p20, status: 'hidden' })).status).toBe(404)
    expect((await post('staff', { eventId: 10, action: 'post_status', id: POST_ID.p10, status: 'hidden' })).status).toBe(404)
    noWrites('aitickets_attendee_messages', 'aitickets_event_feed_posts')
    expect(db.tables.aitickets_event_feed_posts.find((p) => p.id === POST_ID.p20).status).toBe('visible')
  })

  it('POST feliz: marca leído/no leído y oculta una publicación; un id de otro evento no se toca', async () => {
    expect((await post('editor', { eventId: 10, action: 'message_read', id: MSG.m10, read: true })).status).toBe(200)
    expect(db.tables.aitickets_attendee_messages.find((m) => m.id === MSG.m10).read_at).toEqual(expect.any(String))
    expect((await post('admin', { eventId: 10, action: 'message_read', id: MSG.m10, read: false })).status).toBe(200)
    expect(db.tables.aitickets_attendee_messages.find((m) => m.id === MSG.m10).read_at).toBeNull()
    expect((await post('producer', { eventId: 10, action: 'post_status', id: POST_ID.p10, status: 'hidden' })).status).toBe(200)
    expect(db.tables.aitickets_event_feed_posts.find((p) => p.id === POST_ID.p10).status).toBe('hidden')
    // Mensaje del evento 11 enviado con el eventId 10: el filtro por evento lo deja igual
    await post('producer', { eventId: 10, action: 'message_read', id: MSG.m11, read: true })
    expect(db.tables.aitickets_attendee_messages.find((m) => m.id === MSG.m11).read_at).toBeNull()
    expect((await post('producer', { eventId: 10, action: 'post_status', id: POST_ID.p10, status: 'borrado' })).status).toBe(400)
    expect((await post('producer', { eventId: 10, action: 'message_read', id: 'no-uuid' })).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/courtesy', () => {
  const post = (who, body) => hit(courtesy.POST, who, { method: 'POST', body })
  const BODY = { eventId: 10, ticketId: 'courtesy', quantity: 2, firstName: 'Ana', lastName: 'Pérez', email: 'Ana@X.cl' }
  beforeEach(() =>
    seed({
      event_tickets: [{ id: 5, event_id: 10, ticket_name: 'General', price: 5000, is_gift: false }, { id: 9, event_id: 20, ticket_name: 'Ajena', price: 5000, is_gift: false }],
      event_locations: [{ id: 'l10', event_id: 10, seat_map: null }],
      event_orders: [],
      event_attendees: [],
      attendees: [],
    }),
  )

  it('sin sesión 401; finanzas, puerta y solo lectura 403 sin emitir', async () => {
    expect((await post(null, BODY)).status).toBe(401)
    await expectStatusFor(courtesy.POST, NON_MANAGERS, { method: 'POST', body: BODY }, 403, ['event_orders', 'event_attendees', 'event_tickets'])
    expect(mocks.sendTicketsEmail).not.toHaveBeenCalled()
  })

  it('evento de otra organización o no asignado: 404 sin emitir; tipo de entrada de otro evento: 404', async () => {
    expect((await post('producer', { ...BODY, eventId: 20, ticketId: 9 })).status).toBe(404)
    expect((await post('staff', BODY)).status).toBe(404)
    expect((await post('producer', { ...BODY, ticketId: 9 })).status).toBe(404)
    noWrites('event_orders', 'event_attendees', 'event_tickets')
    expect(mocks.sendTicketsEmail).not.toHaveBeenCalled()
  })

  it('feliz: crea el tipo Cortesía la primera vez, emite la orden y las entradas y envía el correo', async () => {
    const out = await post('editor', BODY)
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ emailSent: true, seats: [], orderId: expect.anything() })
    expect(out.body.message).toContain('ana@x.cl')
    const gift = db.tables.event_tickets.find((t) => t.is_gift)
    expect(gift).toMatchObject({ event_id: 10, ticket_name: 'Cortesía', price: 0 })
    expect(db.tables.event_orders).toEqual([expect.objectContaining({ event_id: 10, amount: 0 })])
    expect(db.tables.event_attendees.filter((a) => a.event_id === 10)).toHaveLength(2)
    expect(mocks.sendTicketsEmail).toHaveBeenCalledWith(expect.any(URL), out.body.orderId)
    // Segunda emisión (otro rol, tipo existente): reutiliza el tipo Cortesía
    expect((await post('admin', { ...BODY, quantity: 1 })).status).toBe(200)
    expect(db.tables.event_tickets.filter((t) => t.is_gift)).toHaveLength(1)
  })

  it('validaciones: email, nombre y cantidad', async () => {
    expect((await post('producer', { ...BODY, email: 'x' })).status).toBe(400)
    expect((await post('producer', { ...BODY, firstName: '' })).status).toBe(400)
    expect((await post('producer', { ...BODY, quantity: 0 })).status).toBe(400)
    noWrites('event_orders')
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/cover', () => {
  const post = (who, body) => hit(cover.POST, who, { method: 'POST', body })
  beforeEach(() => seed())

  it('sin sesión 401; roles sin gestión 403; otra organización y no asignado 404; nada se escribe', async () => {
    expect((await post(null, { eventId: 10, imageUrl: 'https://img.test/n.jpg' })).status).toBe(401)
    await expectStatusFor(cover.POST, NON_MANAGERS, { method: 'POST', body: { eventId: 10, imageUrl: 'https://img.test/n.jpg' } }, 403)
    expect((await post('producer', { eventId: 20, imageUrl: 'https://img.test/n.jpg' })).status).toBe(404)
    expect((await post('staff', { eventId: 10, imageUrl: 'https://img.test/n.jpg' })).status).toBe(404)
    noWrites('events')
    expect(db.tables.events.find((e) => e.id === 20).image_url).toBe('https://img.test/20.jpg')
  })

  it('feliz: cambia la imagen y el ajuste por dispositivo; quitar la imagen limpia el ajuste', async () => {
    for (const who of MANAGERS) expect((await post(who, { eventId: 10, imageUrl: `https://img.test/${who}.jpg` })).status).toBe(200)
    expect(db.tables.events.find((e) => e.id === 10).image_url).toBe('https://img.test/editor.jpg')
    const settings = { desktop: { height: 600, position_y: 30, fit: 'cover' }, mobile: { height: 999, position_y: 10, fit: 'contain' } }
    expect((await post('producer', { eventId: 10, coverSettings: settings })).status).toBe(200)
    expect(db.tables.events.find((e) => e.id === 10).cover_settings).toEqual({ desktop: { height: 600, position_y: 30, fit: 'cover' }, mobile: { height: 560, position_y: 10, fit: 'contain' } })
    expect((await post('producer', { eventId: 10, imageUrl: null })).status).toBe(200)
    expect(db.tables.events.find((e) => e.id === 10)).toMatchObject({ image_url: null, cover_settings: null })
    expect((await post('producer', { eventId: 10, imageUrl: 'http://inseguro.test/a.jpg' })).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/documents', () => {
  const uploaded = new Map()
  const signedUploads = []
  beforeEach(() => {
    uploaded.clear()
    signedUploads.length = 0
    seed({
      aitickets_event_documents: [
        { id: uuid(41), event_id: 10, organization_id: 7, kind: 'venue_permit', status: 'approved', file_name: 'contrato.pdf', storage_path: '7/10/contrato.pdf', created_at: '2026-09-01' },
        { id: uuid(49), event_id: 20, organization_id: 8, kind: 'venue_permit', status: 'approved', file_name: 'ajeno.pdf', storage_path: '8/20/ajeno.pdf', created_at: '2026-09-01' },
      ],
    })
    db.storage = {
      from: () => ({
        createSignedUploadUrl: async (path) => {
          signedUploads.push(path)
          return { data: { signedUrl: `https://storage.test/upload/${path}` }, error: null }
        },
        list: async (folder, { search }) => ({ data: uploaded.has(`${folder}/${search}`) ? [{ name: search, metadata: uploaded.get(`${folder}/${search}`) }] : [], error: null }),
        createSignedUrl: async (path) => ({ data: { signedUrl: `https://storage.test/signed/${path}` }, error: null }),
      }),
    }
  })
  const post = (who, body) => hit(documents.POST, who, { method: 'POST', body })

  it('GET: sin sesión 401; roles sin gestión 403; otra organización y no asignado 404 (sin datos ajenos)', async () => {
    expect((await hit(documents.GET, null, { query: { eventId: 10 } })).status).toBe(401)
    await expectStatusFor(documents.GET, NON_MANAGERS, { query: { eventId: 10 } }, 403)
    const foreign = await hit(documents.GET, 'producer', { query: { eventId: 20 } })
    expect(foreign.status).toBe(404)
    expect(foreign.text).not.toContain('ajeno.pdf')
    expect((await hit(documents.GET, 'producer', { query: { eventId: 20, download: uuid(49) } })).status).toBe(404)
    expect((await hit(documents.GET, 'staff', { query: { eventId: 10 } })).status).toBe(404)
  })

  it('GET feliz: documentos, faltantes y descarga con URL firmada; un documento de otro evento no se descarga', async () => {
    const out = await hit(documents.GET, 'editor', { query: { eventId: 10 } })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ available: true, event: { is_massive: false } })
    expect(out.body.documents).toEqual([expect.objectContaining({ id: uuid(41), kind: 'venue_permit', status: 'approved' })])
    const dl = await hit(documents.GET, 'producer', { query: { eventId: 10, download: uuid(41) } })
    expect(dl.status).toBe(302)
    expect(dl.res.headers.get('Location')).toBe('https://storage.test/signed/7/10/contrato.pdf')
    expect((await hit(documents.GET, 'producer', { query: { eventId: 10, download: uuid(49) } })).status).toBe(404)
  })

  it('POST: roles sin gestión 403; otra organización y no asignado 404; sin escribir ni preparar subidas', async () => {
    const body = { eventId: 10, action: 'upload_url', kind: 'rc_insurance', contentType: 'application/pdf', size: 1000, fileName: 'poliza.pdf' }
    expect((await post(null, body)).status).toBe(401)
    await expectStatusFor(documents.POST, NON_MANAGERS, { method: 'POST', body }, 403)
    expect((await post('producer', { ...body, eventId: 20 })).status).toBe(404)
    expect((await post('staff', body)).status).toBe(404)
    expect((await post('producer', { eventId: 20, action: 'set_massive', is_massive: true })).status).toBe(404)
    expect(signedUploads).toHaveLength(0)
    noWrites('events', 'aitickets_event_documents')
  })

  it('POST feliz: URL de subida en la carpeta de la organización, confirmar registra el documento y marcar masivo', async () => {
    const up = await post('editor', { eventId: 10, action: 'upload_url', kind: 'rc_insurance', contentType: 'application/pdf', size: 1000, fileName: 'Póliza RC.pdf' })
    expect(up.status).toBe(200)
    expect(up.body.path).toMatch(/^7\/10\/\d+-[0-9a-f]{8}-Poliza-RC\.pdf$/)
    const [folder, name] = [up.body.path.slice(0, up.body.path.lastIndexOf('/')), up.body.path.slice(up.body.path.lastIndexOf('/') + 1)]
    uploaded.set(`${folder}/${name}`, { size: 1000, mimetype: 'application/pdf' })

    const confirmed = await post('editor', { eventId: 10, action: 'confirm', kind: 'rc_insurance', path: up.body.path, fileName: 'Póliza RC.pdf' })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.document).toMatchObject({ kind: 'rc_insurance', status: 'pending' })
    expect(db.tables.aitickets_event_documents.at(-1)).toMatchObject({ event_id: 10, organization_id: 7, storage_path: up.body.path, uploaded_by: 3, size_bytes: 1000 })
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'upload_event_document', organization_id: 7, user_id: 3, event_id: 10, channel: 'dashboard' })
    expect(mocks.notifySlack).toHaveBeenCalledTimes(1)

    const massive = await post('producer', { eventId: 10, action: 'set_massive', is_massive: true })
    expect(massive.status).toBe(200)
    expect(massive.body.is_massive).toBe(true)
    expect(db.tables.events.find((e) => e.id === 10).is_massive).toBe(true)
  })

  it('confirmar un archivo de la carpeta de otra organización o evento: 400 sin registrar', async () => {
    uploaded.set('8/20/ajeno.pdf', { size: 10, mimetype: 'application/pdf' })
    expect((await post('producer', { eventId: 10, action: 'confirm', kind: 'other', path: '8/20/ajeno.pdf' })).status).toBe(400)
    expect((await post('producer', { eventId: 10, action: 'confirm', kind: 'other', path: '7/10/../../8/20/ajeno.pdf' })).status).toBe(400)
    noWrites('aitickets_event_documents')
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/duplicate', () => {
  const post = (who, body) => hit(duplicate.POST, who, { method: 'POST', body })
  beforeEach(() => {
    seed({
      event_locations: [{ id: 'l10', event_id: 10, venue_id: 'v1', name: 'Sala', display_name: 'Sala' }],
      event_tickets: [
        { id: 5, event_id: 10, ticket_name: 'General', price: 5000, total_quantity: 100, is_gift: false, status: null, event_date_id: 501 },
        { id: 6, event_id: 10, ticket_name: 'Agotada', price: 3000, total_quantity: 10, is_gift: false, status: 'unavailable' },
        { id: 7, event_id: 10, ticket_name: 'Cortesía', price: 0, is_gift: true, status: 'available' },
      ],
      event_tags: [{ event_id: 10, tag_id: 3 }],
      event_faqs: [{ id: 1, event_id: 10, question: '¿Edad mínima?', answer: '18' }, { id: 2, event_id: 20, question: 'Ajena', answer: 'x' }],
    })
    withOrFilter(db)
  })

  it('sin sesión 401; roles sin gestión 403; otra organización y no asignado 404; no crea eventos', async () => {
    expect((await post(null, { eventId: 10 })).status).toBe(401)
    await expectStatusFor(duplicate.POST, NON_MANAGERS, { method: 'POST', body: { eventId: 10 } }, 403)
    expect((await post('producer', { eventId: 20 })).status).toBe(404)
    expect((await post('staff', { eventId: 10 })).status).toBe(404)
    expect((await post('producer', {})).status).toBe(400)
    noWrites('events', 'event_faqs', 'event_tickets')
    expect(db.tables.events).toHaveLength(3)
  })

  it('feliz: borrador en la organización de la sesión con entradas y FAQs, sin funciones', async () => {
    const out = await post('editor', { eventId: 10 })
    expect(out.status).toBe(200)
    const created = db.tables.events.find((e) => e.id === out.body.id)
    expect(created).toMatchObject({ name: 'Show pasado (copia)', status: 'draft', organization_id: 7, created_by: 3, image_url: 'https://img.test/10.jpg' })
    expect(db.tables.event_faqs.filter((f) => f.event_id === out.body.id).map((f) => f.question)).toEqual(['¿Edad mínima?'])
    expect(db.tables.event_dates.some((d) => d.event_id === out.body.id)).toBe(false)
    expect(db.tables.event_tags.some((t) => t.event_id === out.body.id && t.tag_id === 3)).toBe(true)
    // Se copian los tipos a la venta; no los no disponibles ni la Cortesía del sistema
    expect(db.tables.event_tickets.filter((t) => t.event_id === out.body.id).map((t) => t.ticket_name)).toEqual(['General'])
    // El miembro limitado duplica su propio evento
    expect((await post('staff', { eventId: 11 })).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/faqs', () => {
  beforeEach(() =>
    seed({
      event_faqs: [
        { id: 1, event_id: 10, question: '¿Edad mínima?', answer: '18', created_at: '2026-09-01' },
        { id: 2, event_id: 11, question: '¿Estacionamiento?', answer: 'Sí', created_at: '2026-09-02' },
        { id: 9, event_id: 20, question: 'Ajena', answer: 'x', created_at: '2026-09-03' },
      ],
    }),
  )
  const post = (who, body) => hit(faqs.POST, who, { method: 'POST', body })

  it('sin sesión 401; roles sin gestión 403; otra organización y no asignado: 403 (esta ruta responde 403, no 404); sin escribir', async () => {
    expect((await hit(faqs.GET, null, { query: { eventId: 10 } })).status).toBe(401)
    expect((await post(null, { eventId: 10, question: 'q', answer: 'a' })).status).toBe(401)
    await expectStatusFor(faqs.GET, NON_MANAGERS, { query: { eventId: 10 } }, 403)
    await expectStatusFor(faqs.POST, NON_MANAGERS, { method: 'POST', body: { eventId: 10, question: 'q', answer: 'a' } }, 403)
    const foreign = await hit(faqs.GET, 'producer', { query: { eventId: 20 } })
    expect(foreign.status).toBe(403)
    expect(foreign.text).not.toContain('Ajena')
    expect((await post('producer', { eventId: 20, action: 'delete', id: 9 })).status).toBe(403)
    expect((await post('staff', { eventId: 10, question: 'q', answer: 'a' })).status).toBe(403)
    noWrites('event_faqs')
    expect(db.tables.event_faqs).toHaveLength(3)
  })

  it('feliz: lista, crea, edita y elimina; un id de otro evento no se toca', async () => {
    const list = await hit(faqs.GET, 'editor', { query: { eventId: 10 } })
    expect(list.body.faqs.map((f) => f.id)).toEqual([1])
    const created = await post('admin', { eventId: 10, question: '  ¿Hay guardarropía?  ', answer: 'Sí, $1.000' })
    expect(created.status).toBe(201)
    expect(created.body.faq).toMatchObject({ question: '¿Hay guardarropía?', answer: 'Sí, $1.000' })
    expect(db.tables.event_faqs.find((f) => f.id === created.body.faq.id)).toMatchObject({ event_id: 10 })
    expect((await post('producer', { eventId: 10, action: 'update', id: 1, question: '¿Edad?', answer: '+18' })).status).toBe(200)
    expect(db.tables.event_faqs.find((f) => f.id === 1)).toMatchObject({ question: '¿Edad?', answer: '+18' })
    // FAQ del evento 11 con el eventId 10: el filtro por evento la protege
    await post('producer', { eventId: 10, action: 'update', id: 2, question: 'cambiada', answer: 'x' })
    await post('producer', { eventId: 10, action: 'delete', id: 2 })
    expect(db.tables.event_faqs.find((f) => f.id === 2)).toMatchObject({ question: '¿Estacionamiento?' })
    expect((await post('editor', { eventId: 10, action: 'delete', id: 1 })).status).toBe(200)
    expect(db.tables.event_faqs.some((f) => f.id === 1)).toBe(false)
    // El miembro limitado gestiona las de su evento
    expect((await post('staff', { eventId: 11, question: '¿Hora?', answer: '20:00' })).status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/function-settlement (borderó)', () => {
  const line = (id, name, price, quantity, event_date_id) => ({ id, name, price, quantity, total: price * quantity, event_date_id })
  beforeEach(() =>
    seed({
      event_tickets: [{ id: 100, event_id: 10, event_date_id: 501 }],
      event_orders: [
        { id: 'o1', event_id: 10, status: 'paid', amount: 20000, ticket_qty: 2, ticket_fee: 1600, service_fee_tax: 304, discount_amount: 0, fee_absorbed: false, payment_provider: 'flow', ticket_details: [line(100, 'General', 10000, 2, 501)] },
        { id: 'o9', event_id: 20, status: 'paid', amount: 99000, ticket_qty: 9, payment_provider: 'flow', ticket_details: [line(900, 'Ajena', 11000, 9, 520)] },
      ],
    }),
  )
  const get = (who, query) => hit(settlement.GET, who, { query })

  it('sin sesión 401; marketing, puerta y solo lectura 403; otra organización 404', async () => {
    expect((await get(null, { event_id: 10, event_date_id: 501 })).status).toBe(401)
    await expectStatusFor(settlement.GET, ['editor', 'validator', 'viewer'], { query: { event_id: 10, event_date_id: 501 } }, 403)
    const foreign = await get('producer', { event_id: 20, event_date_id: 520, format: 'json' })
    expect(foreign.status).toBe(404)
    expect(foreign.text).not.toContain('99000')
    expect((await get('staff', { event_id: 10, event_date_id: 501 })).status).toBe(403) // marketing (limitado): sin finance.read
    expect((await get('producer', { event_id: 10, event_date_id: 520 })).status).toBe(400) // función de otro evento
    expect((await get('producer', { event_id: 10 })).status).toBe(400)
  })

  it('feliz: planilla CSV por función y JSON de todas las funciones (producer, admin y finanzas)', async () => {
    for (const who of ['producer', 'admin', 'finance']) {
      const csv = await get(who, { event_id: 10, event_date_id: 501 })
      expect(csv.status, who).toBe(200)
      expect(csv.res.headers.get('Content-Type')).toContain('text/csv')
      expect(csv.res.headers.get('Content-Disposition')).toMatch(/bordero-show-pasado-2026-10-01/)
    }
    const json = await get('producer', { event_id: 10, event_date_id: 501, format: 'json' })
    expect(json.status).toBe(200)
    expect(json.body.settlement.function).toMatchObject({ id: 501, date: '2026-10-01', start_time: '20:00' })
    expect(json.body.settlement.totals).toMatchObject({ orders: 1, tickets_sold: 2, gross_clp: 20000 })
    // "all" = solo las entradas válidas para cualquier función: esta orden es de la función 501
    const all = await get('producer', { event_id: 10, event_date_id: 'all', format: 'json' })
    expect(all.body.settlement.totals).toMatchObject({ orders: 0, gross_clp: 0 })
  })

  // Permiso finance.read, el mismo de get_function_settlement (que entrega el csv_url de esta ruta): finanzas descarga el
  // borderó y marketing no (trae el neto al productor). Antes era al revés.
  it('finanzas descarga el borderó; marketing (sin finance.read) no', async () => {
    expect((await get('finance', { event_id: 10, event_date_id: 501 })).status).toBe(200)
    expect((await get('finance', { event_id: 10, event_date_id: 501, format: 'json' })).body.settlement.totals.net_to_producer_clp).toBe(20000)
    expect((await get('editor', { event_id: 10, event_date_id: 501, format: 'json' })).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/invitations', () => {
  const holder = (n, eventId, email, status = 'active', validated_at = null) => ({
    id: `ea-${eventId}-${n}`, event_id: eventId, status, validated_at, attendees: { id: n, first_name: email.split('@')[0], last_name: 'Test', email }, event_orders: null,
  })
  beforeEach(() =>
    seed({
      event_attendees: [holder(1, 10, 'ana@x.cl', 'validated', '2026-10-01T23:30:00Z'), holder(2, 10, 'beto@x.cl'), holder(3, 20, 'ajeno@x.cl')],
      aitickets_event_reviews: [],
      aitickets_org_email_optouts: [],
      notification_log: [],
      aitickets_scheduled_messages: [],
    }),
  )
  const post = (who, body) => hit(invitations.POST, who, { method: 'POST', body })
  const SEND = { eventId: 10, targetEventId: 11, action: 'send', audience: 'all', subject: 'Vuelve', message: '¡Te esperamos!' }

  it('sin sesión 401; roles sin gestión 403; sin crear invitaciones', async () => {
    expect((await post(null, SEND)).status).toBe(401)
    await expectStatusFor(invitations.POST, NON_MANAGERS, { method: 'POST', body: SEND }, 403, ['aitickets_scheduled_messages'])
  })

  it('evento origen o destino de otra organización: 404; miembro limitado: 404 si alguno de los dos no es suyo', async () => {
    expect((await post('producer', { ...SEND, targetEventId: 20 })).status).toBe(404)
    expect((await post('producer', { ...SEND, eventId: 20 })).status).toBe(404)
    expect((await post('staff', SEND)).status).toBe(404) // origen 10 no asignado
    expect((await post('staff', { ...SEND, eventId: 11, targetEventId: 10 })).status).toBe(404) // destino 10 no asignado
    noWrites('aitickets_scheduled_messages')
    expect(mocks.callInternalFunction).not.toHaveBeenCalled()
  })

  it('feliz: vista previa con conteos y envío que queda en la cola y se despacha', async () => {
    const preview = await post('editor', { ...SEND, action: 'preview' })
    expect(preview.status).toBe(200)
    expect(preview.body.counts).toMatchObject({ attendees: 2, recipients: 2 })
    noWrites('aitickets_scheduled_messages')

    const sent = await post('producer', SEND)
    expect(sent.status).toBe(201)
    expect(sent.body).toMatchObject({ dispatched: true, counts: { recipients: 2 } })
    expect(db.tables.aitickets_scheduled_messages).toEqual([
      expect.objectContaining({ organization_id: 7, event_id: 10, target_event_id: 11, kind: 'invitation', subject: 'Vuelve', created_by: 1, created_via: 'dashboard', status: 'sending' }),
    ])
    expect(mocks.callInternalFunction).toHaveBeenCalledTimes(1)
  })

  it('validaciones: sin destino, mismo evento y acción desconocida', async () => {
    expect((await post('producer', { ...SEND, targetEventId: undefined })).status).toBe(400)
    expect((await post('producer', { ...SEND, targetEventId: 10 })).status).toBe(400)
    expect((await post('producer', { ...SEND, action: 'borrar' })).status).toBe(400)
    noWrites('aitickets_scheduled_messages')
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/modules', () => {
  const post = (who, body) => hit(modules.POST, who, { method: 'POST', body })
  beforeEach(() => seed())

  it('sin sesión 401; roles sin gestión 403; otra organización y no asignado 404; sin escribir', async () => {
    expect((await post(null, { eventId: 10, moduleId: 'documents' })).status).toBe(401)
    await expectStatusFor(modules.POST, NON_MANAGERS, { method: 'POST', body: { eventId: 10, moduleId: 'documents' } }, 403)
    expect((await post('producer', { eventId: 20, moduleId: 'documents' })).status).toBe(404)
    expect((await post('staff', { eventId: 10, moduleId: 'documents' })).status).toBe(404)
    noWrites('events')
  })

  it('feliz: agrega la herramienta sin repetir y en el orden del registro; una central o inexistente: 400', async () => {
    const out = await post('editor', { eventId: 10, moduleId: 'documents' })
    expect(out.status).toBe(200)
    expect(out.body.added).toEqual(expect.arrayContaining(['faq', 'documents']))
    expect(db.tables.events.find((e) => e.id === 10).panel_modules).toEqual(out.body.added)
    expect((await post('admin', { eventId: 10, moduleId: 'documents' })).body.added.filter((m) => m === 'documents')).toHaveLength(1)
    expect((await post('producer', { eventId: 10, moduleId: 'tickets' })).status).toBe(400)
    expect((await post('producer', { eventId: 10, moduleId: 'no-existe' })).status).toBe(400)
    expect((await post('staff', { eventId: 11, moduleId: 'waitlist' })).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/preview-links', () => {
  const LINK = { l10: uuid(61), l20: uuid(69) }
  const link = (id, event_id, organization_id) => ({
    id, event_id, organization_id, token_hash: sha256Hex(`pv_${id}`), single_use: false, expires_at: null, consumed_at: null, consumed_nonce_hash: null,
    revoked_at: null, view_count: 0, last_viewed_at: null, label: null, created_via: 'dashboard', created_at: '2026-10-01T00:00:00Z',
  })
  beforeEach(() => seed({ aitickets_event_preview_links: [link(LINK.l10, 10, 7), link(LINK.l20, 20, 8)] }))
  const revoked = (id) => db.tables.aitickets_event_preview_links.find((l) => l.id === id).revoked_at

  it('sin sesión 401 y roles sin gestión 403 en GET, POST y DELETE, sin escribir', async () => {
    expect((await hit(previewLinks.GET, null, { query: { event_id: 10 } })).status).toBe(401)
    expect((await hit(previewLinks.POST, null, { method: 'POST', body: { eventId: 10 } })).status).toBe(401)
    expect((await hit(previewLinks.DELETE, null, { method: 'DELETE', query: { id: LINK.l10 } })).status).toBe(401)
    await expectStatusFor(previewLinks.GET, NON_MANAGERS, { query: { event_id: 10 } }, 403)
    await expectStatusFor(previewLinks.POST, NON_MANAGERS, { method: 'POST', body: { eventId: 10 } }, 403)
    await expectStatusFor(previewLinks.DELETE, NON_MANAGERS, { method: 'DELETE', query: { id: LINK.l10 } }, 403)
    noWrites('aitickets_event_preview_links')
  })

  it('GET/POST de otra organización o no asignado: 404 sin crear links', async () => {
    expect((await hit(previewLinks.GET, 'producer', { query: { event_id: 20 } })).status).toBe(404)
    expect((await hit(previewLinks.POST, 'producer', { method: 'POST', body: { eventId: 20 } })).status).toBe(404)
    expect((await hit(previewLinks.GET, 'staff', { query: { event_id: 10 } })).status).toBe(404)
    expect((await hit(previewLinks.POST, 'staff', { method: 'POST', body: { eventId: 10 } })).status).toBe(404)
    noWrites('aitickets_event_preview_links')
  })

  it('DELETE de un link de otra organización: 404 y sigue activo', async () => {
    expect((await hit(previewLinks.DELETE, 'producer', { method: 'DELETE', query: { id: LINK.l20 } })).status).toBe(404)
    expect(revoked(LINK.l20)).toBeNull()
  })

  it('feliz: crea (la URL con el token solo se muestra una vez), lista y revoca', async () => {
    const created = await hit(previewLinks.POST, 'editor', { method: 'POST', body: { eventId: 10, expiresInHours: 48, singleUse: true, label: 'Para el artista' } })
    expect(created.status).toBe(201)
    expect(created.body.url).toMatch(/^https:\/\/aitickets\.test\/eventos\/vista-previa\/pv_[A-Za-z0-9_-]{32,64}$/)
    expect(created.body.link).toMatchObject({ event_id: 10, label: 'Para el artista', single_use: true, status: 'active' })
    const token = created.body.url.split('/').pop()
    const row = db.tables.aitickets_event_preview_links.find((l) => l.id === created.body.link.id)
    expect(row).toMatchObject({ organization_id: 7, created_by_user_id: 3, token_hash: sha256Hex(token) })
    expect(JSON.stringify(db.tables.aitickets_event_preview_links)).not.toContain(token)

    const list = await hit(previewLinks.GET, 'admin', { query: { event_id: 10 } })
    expect(list.body.links.map((l) => l.id).sort()).toEqual([LINK.l10, created.body.link.id].sort())
    expect(JSON.stringify(list.body)).not.toContain('token_hash')

    expect((await hit(previewLinks.DELETE, 'producer', { method: 'DELETE', query: { id: created.body.link.id } })).status).toBe(200)
    expect(revoked(created.body.link.id)).toEqual(expect.any(String))
    expect((await hit(previewLinks.POST, 'producer', { method: 'POST', body: { eventId: 10, expiresInHours: 0 } })).status).toBe(400)
  })

  // DELETE aplica el mismo acceso que GET: un miembro limitado al evento 11 no revoca el link del evento 10 (antes podía,
  // aunque ni siquiera lo podía listar). revoke_preview_link de la API de productores aplica la misma regla.
  it('DELETE por un miembro limitado a otro evento: 404 y el link sigue activo', async () => {
    const out = await hit(previewLinks.DELETE, 'staff', { method: 'DELETE', query: { id: LINK.l10 } })
    expect(out.status).toBe(404)
    expect(revoked(LINK.l10)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/reviews', () => {
  const R = { r10: uuid(71), r11: uuid(72), r20: uuid(79) }
  const P = { p10: uuid(81), p20: uuid(89) }
  beforeEach(() =>
    seed({
      aitickets_event_reviews: [
        { id: R.r10, event_id: 10, email: 'ana@x.cl', display_name: 'Ana', rating: 5, public_comment: 'Excelente', private_comment: 'Baños sucios', public_status: 'visible', created_at: '2026-10-03' },
        { id: R.r11, event_id: 11, email: 'beto@x.cl', display_name: 'Beto', rating: 3, public_status: 'visible', created_at: '2026-10-03' },
        { id: R.r20, event_id: 20, email: 'aj@x.cl', display_name: 'Ajeno', rating: 1, private_comment: 'secreto ajeno', public_status: 'visible', created_at: '2026-10-03' },
      ],
      aitickets_event_review_photos: [
        { id: P.p10, event_id: 10, email: 'ana@x.cl', display_name: 'Ana', url: 'https://img.test/r1.jpg', status: 'visible', created_at: '2026-10-03' },
        { id: P.p20, event_id: 20, email: 'aj@x.cl', display_name: 'Ajeno', url: 'https://img.test/r9.jpg', status: 'visible', created_at: '2026-10-03' },
      ],
      notification_log: [{ id: 1, event_id: 10, type: 'review_request' }],
      aitickets_scheduled_messages: [],
    }),
  )
  const post = (who, body) => hit(reviews.POST, who, { method: 'POST', body })

  it('GET: sin sesión 401; roles sin gestión 403; otra organización y no asignado 404 (sin datos ajenos)', async () => {
    expect((await hit(reviews.GET, null, { query: { eventId: 10 } })).status).toBe(401)
    await expectStatusFor(reviews.GET, NON_MANAGERS, { query: { eventId: 10 } }, 403)
    const foreign = await hit(reviews.GET, 'producer', { query: { eventId: 20 } })
    expect(foreign.status).toBe(404)
    expect(foreign.text).not.toContain('secreto ajeno')
    expect((await hit(reviews.GET, 'staff', { query: { eventId: 10 } })).status).toBe(404)
    expect((await hit(reviews.GET, 'staff', { query: { eventId: 11 } })).status).toBe(200)
  })

  it('GET feliz: reseñas con comentario privado, fotos, estadísticas y próximos eventos para invitar', async () => {
    const out = await hit(reviews.GET, 'editor', { query: { eventId: 10 } })
    expect(out.status).toBe(200)
    expect(out.body.reviews).toEqual([expect.objectContaining({ id: R.r10, email: 'ana@x.cl', private_comment: 'Baños sucios', rating: 5 })])
    expect(out.body.photos.map((p) => p.id)).toEqual([P.p10])
    expect(out.body.stats).toMatchObject({ requests_sent: 1 })
    expect(out.body.ended).toBe(true)
    expect(out.body.upcoming_events.map((e) => e.id)).toEqual([11])
  })

  it('POST: roles sin gestión 403; otra organización y no asignado 404; sin escribir', async () => {
    expect((await post(null, { eventId: 10, action: 'settings', enabled: false })).status).toBe(401)
    await expectStatusFor(reviews.POST, NON_MANAGERS, { method: 'POST', body: { eventId: 10, action: 'settings', enabled: false } }, 403)
    expect((await post('producer', { eventId: 20, action: 'review_status', id: R.r20, public_status: 'hidden' })).status).toBe(404)
    expect((await post('producer', { eventId: 20, action: 'photo_delete', id: P.p20 })).status).toBe(404)
    expect((await post('staff', { eventId: 10, action: 'settings', enabled: false })).status).toBe(404)
    noWrites('events', 'aitickets_event_reviews', 'aitickets_event_review_photos')
    expect(db.tables.aitickets_event_review_photos).toHaveLength(2)
  })

  it('POST feliz: ajustes con premio, ocultar reseña y foto, borrar foto; ids de otro evento: 404', async () => {
    const s = await post('admin', { eventId: 10, action: 'settings', enabled: true, reward: { value: 15, valid_days: 30 }, moderate_photos: true })
    expect(s.status).toBe(200)
    expect(s.body.settings).toMatchObject({ enabled: true, reward: { value: 15, valid_days: 30 }, moderate_photos: true })
    expect(db.tables.events.find((e) => e.id === 10).review_settings).toEqual(s.body.settings)
    expect((await post('producer', { eventId: 10, action: 'settings', reward: { value: 'mucho' } })).status).toBe(400)

    expect((await post('editor', { eventId: 10, action: 'review_status', id: R.r10, public_status: 'hidden' })).status).toBe(200)
    expect(db.tables.aitickets_event_reviews.find((r) => r.id === R.r10).public_status).toBe('hidden')
    expect((await post('editor', { eventId: 10, action: 'review_status', id: R.r11, public_status: 'hidden' })).status).toBe(404)
    expect(db.tables.aitickets_event_reviews.find((r) => r.id === R.r11).public_status).toBe('visible')

    expect((await post('producer', { eventId: 10, action: 'photo_status', id: P.p10, status: 'hidden' })).status).toBe(200)
    expect(db.tables.aitickets_event_review_photos.find((p) => p.id === P.p10).status).toBe('hidden')
    expect((await post('producer', { eventId: 10, action: 'photo_delete', id: P.p10 })).status).toBe(200)
    expect(db.tables.aitickets_event_review_photos.map((p) => p.id)).toEqual([P.p20])
    expect((await post('producer', { eventId: 10, action: 'otra' })).status).toBe(400)
  })

  it('videos de asistentes: el GET los marca con media_type y borrar uno borra también su archivo', async () => {
    const BASE = 'https://proj.supabase.co/storage/v1/object/public/'
    const removed = []
    db.storage = { from: (bucket) => ({ getPublicUrl: (p) => ({ data: { publicUrl: `${BASE}${bucket}/${p}` } }), remove: async (paths) => (removed.push(...paths.map((p) => `${bucket}/${p}`)), { data: [], error: null }) }) }
    const V = uuid(82)
    db.tables.aitickets_event_review_photos.push({ id: V, event_id: 10, email: 'ana@x.cl', media_type: 'video', duration: 21, url: `${BASE}aitickets-event-videos/event-attendee-videos/10/video-a.mp4`, thumb_url: 'https://img.test/p.jpg', status: 'visible', created_at: '2026-10-04' })
    const out = await hit(reviews.GET, 'producer', { query: { eventId: 10 } })
    expect(out.body.photos.find((p) => p.id === V)).toMatchObject({ media_type: 'video', duration: 21 })
    expect(out.body.photos.find((p) => p.id === P.p10).media_type).toBe('photo')
    expect((await post('producer', { eventId: 10, action: 'photo_delete', id: V })).status).toBe(200)
    expect(removed).toEqual(['aitickets-event-videos/event-attendee-videos/10/video-a.mp4'])
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/upload-image', () => {
  const uploads = []
  beforeEach(() => {
    uploads.length = 0
    seed()
    db.storage = {
      from: (bucket) => ({
        upload: async (path, buffer, opts) => {
          uploads.push({ bucket, path, bytes: buffer.length, contentType: opts.contentType })
          return { error: null }
        },
        getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      }),
    }
  })
  const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#a3e635' } }).png().toBuffer()
  const form = async ({ kind, buffer, name = 'foto.png' } = {}) => {
    const f = new FormData()
    f.set('file', new File([buffer || (await png())], name, { type: 'image/png' }))
    if (kind) f.set('kind', kind)
    return f
  }
  const upload = async (who, opts) => hit(uploadImage.POST, who, { method: 'POST', form: await form(opts) })

  it('sin sesión 401; roles sin gestión 403; nada se sube', async () => {
    expect((await upload(null)).status).toBe(401)
    for (const who of NON_MANAGERS) expect((await upload(who)).status, who).toBe(403)
    expect(uploads).toHaveLength(0)
  })

  it('feliz: portada optimizada en la carpeta de la organización; galería con miniatura WebP', async () => {
    for (const who of MANAGERS) {
      const out = await upload(who)
      expect(out.status, who).toBe(200)
      expect(out.body).toMatchObject({ width: 64, height: 48, thumb_url: null, url: expect.stringContaining('/Events/event-covers/7-') })
    }
    expect(uploads.every((u) => u.bucket === 'Events' && u.path.startsWith('event-covers/7-'))).toBe(true)
    uploads.length = 0
    const gallery = await upload('editor', { kind: 'gallery' })
    expect(gallery.status).toBe(200)
    expect(gallery.body.thumb_url).toMatch(/\/Events\/event-gallery\/7-.+-thumb\.webp$/)
    expect(uploads.map((u) => u.path.split('/')[0])).toEqual(['event-gallery', 'event-gallery'])
  })

  it('archivo que no es imagen (por sus bytes) o más de 5 MB: 400', async () => {
    expect((await upload('producer', { buffer: Buffer.from('<svg onload="alert(1)"></svg>'), name: 'x.png' })).status).toBe(400)
    expect((await upload('producer', { buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 0x89) })).status).toBe(400)
    expect((await hit(uploadImage.POST, 'producer', { method: 'POST', form: new FormData() })).status).toBe(400)
    expect(uploads).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('/api/events/waitlist-list', () => {
  beforeEach(() =>
    seed({
      aitickets_event_waitlist: [
        { id: 1, event_id: 10, email: 'pia@x.cl', kind: 'sold_out', event_date_id: 501, created_at: '2026-09-20T15:00:00Z', notified_at: null },
        { id: 2, event_id: 10, email: 'leo@x.cl', kind: 'sale_opens', event_date_id: null, created_at: '2026-09-21T15:00:00Z', notified_at: '2026-09-22T15:00:00Z' },
        { id: 9, event_id: 20, email: 'ajeno@x.cl', kind: 'sold_out', event_date_id: null, created_at: '2026-09-20T15:00:00Z' },
      ],
    }),
  )
  const get = (who, query) => hit(waitlistList.GET, who, { query })

  it('sin sesión 401; roles sin gestión 403; otra organización y no asignado 404 (sin correos ajenos)', async () => {
    expect((await get(null, { event_id: 10 })).status).toBe(401)
    await expectStatusFor(waitlistList.GET, NON_MANAGERS, { query: { event_id: 10 } }, 403)
    const foreign = await get('producer', { event_id: 20, format: 'csv' })
    expect(foreign.status).toBe(404)
    expect(foreign.text).not.toContain('ajeno@x.cl')
    expect((await get('staff', { event_id: 10 })).status).toBe(404)
    expect((await get('staff', { event_id: 11 })).status).toBe(200)
  })

  it('feliz: JSON con motivo y función, y CSV para descargar', async () => {
    for (const who of MANAGERS) {
      const out = await get(who, { event_id: 10 })
      expect(out.status, who).toBe(200)
      expect(out.body.rows.map((r) => r.email)).toEqual(['pia@x.cl', 'leo@x.cl'])
    }
    const json = await get('producer', { event_id: 10 })
    expect(json.body.rows[0]).toMatchObject({ kind_label: 'Agotado', function_label: expect.stringContaining('20:00') })
    expect(json.body.rows[1]).toMatchObject({ kind_label: 'Venta por abrir', function_label: null })
    const csv = await get('editor', { event_id: 10, format: 'csv' })
    expect(csv.status).toBe(200)
    expect(csv.res.headers.get('Content-Disposition')).toContain('lista-de-espera-show-pasado.csv')
    expect(csv.text).toContain('pia@x.cl')
    expect(csv.text).not.toContain('ajeno@x.cl')
  })
})

// Panoramas (/panoramas): eventos externos públicos y comentarios con comprobante validados por el admin.
// src/lib/panoramas.ts, POST /api/panoramas/reviews y las herramientas list/get/moderate_panorama_reviews del MCP de admin.
// Supabase y Storage falsos: sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const h = { rateAllowed: true, slack: [] }
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: h.rateAllowed, source: 'db' }) }))
vi.mock('../../netlify/lib/slack.mjs', () => ({ notifySlack: async (text) => h.slack.push(text) }))

const P = await import('../../src/lib/panoramas.ts')
const { POST } = await import('../../src/pages/api/panoramas/reviews.ts')
const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')

const actx = (keyKind = 'full') => ({ supabase: db, origin: 'https://aitickets.cl', requestUrl: new URL('https://aitickets.cl/api/admin/mcp'), keyKind, fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const run = async (name, args, keyKind) => {
  const out = await runAdminTool(getAdminTool(name), args, actx(keyKind))
  expect(out.ok, JSON.stringify(out)).toBe(true)
  return out.result
}

/** Storage falso: un mapa bucket/ruta → { bytes, contentType }. */
function fakeStorage() {
  const files = new Map()
  return {
    files,
    from(bucket) {
      return {
        async upload(path, data, opts) {
          files.set(`${bucket}/${path}`, { bytes: Buffer.from(data), contentType: opts?.contentType })
          return { data: { path }, error: null }
        },
        async remove(paths) {
          for (const p of paths) files.delete(`${bucket}/${p}`)
          return { data: paths, error: null }
        },
        async createSignedUrl(path, seconds) {
          return files.has(`${bucket}/${path}`) ? { data: { signedUrl: `https://storage.test/${bucket}/${path}?exp=${seconds}` }, error: null } : { data: null, error: { message: 'Object not found' } }
        },
        async download(path) {
          const f = files.get(`${bucket}/${path}`)
          return f ? { data: new Blob([f.bytes]), error: null } : { data: null, error: { message: 'Object not found' } }
        },
      }
    },
  }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n')
const EML = Buffer.from(
  [
    'Return-Path: <no-reply@passline.com>',
    'From: Passline <no-reply@passline.com>',
    'To: ana@correo.cl',
    'Subject: =?UTF-8?B?VHVzIGVudHJhZGFzIHBhcmEgVGVjaG5vIE5pZ2h0IPCfjp8=?=',
    'Date: Sat, 21 Nov 2026 10:00:00 -0300',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hola Ana, aqu=C3=AD est=C3=A1n tus 2 entradas para Techno Night =',
    'el s=C3=A1bado 21.',
    '--b1--',
    '',
  ].join('\r\n'),
)

const EVENTS = [
  { id: 1, name: 'Techno Night: Subterráneo', category: 'fiesta', niche: 'techno', producer_id: 9, ticketing_platform: 'passline', ticketing_url: 'https://passline.com/techno', price_min: 8000, price_max: 15000, description: 'Fiesta techno de madrugada.', image_url: 'https://cdn.test/techno.jpg', public_status: 'auto', notes: 'NOTA INTERNA', source_url: 'https://passline.com/techno' },
  { id: 2, name: 'Impro Total', category: 'stand_up', niche: 'impro', ticketing_platform: 'none', ticketing_url: null, source_url: 'https://instagram.com/p/impro', price_min: 5000, price_max: 5000, public_status: 'featured' },
  { id: 3, name: 'Oculto', category: 'concierto', public_status: 'hidden', ticketing_url: 'https://x.test' },
  { id: 4, name: 'Feria Pasada', category: 'feria', niche: 'gastronomica', is_free: true, price_min: 0, price_max: 0, public_status: 'auto', source_url: 'https://feria.test' },
  { id: 5, name: 'Festival Largo', category: 'festival', public_status: 'auto', ticketing_platform: 'puntoticket', ticketing_url: 'https://puntoticket.com/f' },
]
const DATES = [
  { id: 11, event_id: 1, event_date: '2026-11-21', start_time: '23:30:00', venue_id: 100, city: 'Providencia', city_key: 'santiago', status: 'completed' },
  { id: 12, event_id: 1, event_date: '2026-12-05', start_time: '23:30:00', venue_id: 100, city: 'Providencia', city_key: 'santiago', status: 'scheduled' },
  { id: 21, event_id: 2, event_date: '2026-11-28', start_time: '21:00:00', city: 'Valparaíso', city_key: 'gran_valparaiso', status: 'scheduled' },
  { id: 31, event_id: 3, event_date: '2026-12-01', city: 'Santiago', city_key: 'santiago', status: 'scheduled' },
  { id: 41, event_id: 4, event_date: '2026-11-15', city: 'Ñuñoa', city_key: 'santiago', status: 'completed' },
  { id: 51, event_id: 5, event_date: '2026-11-20', end_date: '2026-11-30', city: 'Santiago', city_key: 'santiago', status: 'scheduled' },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-26T15:00:00Z'))
  h.rateAllowed = true
  h.slack = []
  db = createFakeSupabase({
    tables: {
      aitickets_external_events: EVENTS.map((e) => ({ ...e })),
      aitickets_external_event_dates: DATES.map((d) => ({ ...d })),
      aitickets_external_venues: [{ id: 100, name: 'Club Subterráneo', city: 'Providencia', city_key: 'santiago' }],
      aitickets_external_producers: [{ id: 9, name: 'Noche Prod', lead_id: 'secret-lead' }],
      aitickets_panorama_reviews: [],
    },
    unique: { aitickets_panorama_reviews: [['event_id', 'email']] },
  })
  db.storage = fakeStorage()
})

describe('helpers', () => {
  it('slug con el id al final, estable y parseable', () => {
    expect(P.panoramaSlug('Techno Night: Subterráneo', 1)).toBe('techno-night-subterraneo-1')
    expect(P.panoramaSlug('¡¡!!', 7)).toBe('7')
    expect(P.parsePanoramaSlug('techno-night-subterraneo-1')).toBe(1)
    expect(P.parsePanoramaSlug('42')).toBe(42)
    expect(P.parsePanoramaSlug('sin-id')).toBeNull()
    expect(P.categoryFromSlug('stand-up')).toBe('stand_up')
    expect(P.categoryFromSlug('nada')).toBeNull()
    expect(P.nicheFromSlug('hip-hop')).toBe('hip_hop')
    expect(P.nicheLabel('lgbtiq')).toBe('LGBTIQ+')
    expect(P.nicheLabel('house')).toBe('House')
  })

  it('detecta el comprobante por sus bytes, no por la extensión', () => {
    expect(P.sniffProof(PNG)).toMatchObject({ kind: 'image', contentType: 'image/png' })
    expect(P.sniffProof(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]))).toMatchObject({ kind: 'image', ext: 'jpg' })
    expect(P.sniffProof(PDF)).toMatchObject({ kind: 'pdf', contentType: 'application/pdf' })
    expect(P.sniffProof(EML)).toMatchObject({ kind: 'email', contentType: 'message/rfc822' })
    expect(P.sniffProof(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull()
    expect(P.sniffProof(Buffer.from('From: alguien\nhola'))).toBeNull()
  })

  it('vista previa de un correo: asunto codificado y texto quoted-printable de un multipart', () => {
    const pv = P.emailPreview(EML)
    expect(pv.from).toBe('Passline <no-reply@passline.com>')
    expect(pv.subject).toBe('Tus entradas para Techno Night 🎟')
    expect(pv.text).toContain('aquí están tus 2 entradas para Techno Night el sábado 21.')
  })

  it('precio y textos de fechas', () => {
    expect(P.priceLabel({ min: 8000, max: 15000, is_free: false })).toBe('$8.000 – $15.000')
    expect(P.priceLabel({ min: 5000, max: 5000, is_free: false })).toBe('Desde $5.000')
    expect(P.priceLabel({ min: null, max: null, is_free: true })).toBe('Gratis')
    expect(P.priceLabel({ min: null, max: null, is_free: false })).toBeNull()
    expect(P.longDate('2026-12-05')).toBe('Sábado 5 de diciembre')
  })
})

describe('carga pública', () => {
  it('lista los vigentes (también el festival que empezó antes), oculta hidden y separa los recientes', async () => {
    const feed = await P.loadPanoramaFeed(db, '2026-11-26')
    expect(feed.upcoming.map((p) => p.id)).toEqual([5, 2, 1])
    expect(feed.recent.map((p) => p.id)).toEqual([4])
    const techno = feed.upcoming.find((p) => p.id === 1)
    expect(techno).toMatchObject({
      path: '/panoramas/evento/techno-night-subterraneo-1',
      category_path: '/panoramas/fiestas',
      niche_path: '/panoramas/fiestas/techno',
      producer: 'Noche Prod',
      link: { url: 'https://passline.com/techno', label: 'Entradas en Passline' },
      has_started: true,
    })
    expect(techno.next.date).toBe('2026-12-05')
    expect(techno.next.venue).toBe('Club Subterráneo')
    // Nada interno sale al público
    expect(JSON.stringify(feed)).not.toMatch(/NOTA INTERNA|secret-lead/)
    expect(feed.upcoming.find((p) => p.id === 2)).toMatchObject({ featured: true, link: { url: 'https://instagram.com/p/impro', label: 'Ver cómo conseguir entradas' } })
  })

  it('filtros y agrupación por fecha', async () => {
    const feed = await P.loadPanoramaFeed(db, '2026-11-26')
    expect(P.filterPanoramas(feed.upcoming, { city: 'Viña del Mar' }).map((p) => p.id)).toEqual([2])
    expect(P.filterPanoramas(feed.upcoming, { category: 'fiesta', niche: 'techno' }).map((p) => p.id)).toEqual([1])
    const groups = P.groupByNextDate(feed.upcoming, '2026-11-26')
    expect(groups[0]).toMatchObject({ label: 'Hoy' })
    expect(groups.map((g) => g.items.length)).toEqual([1, 1, 1])
    const f = P.facets(feed.upcoming, 'fiesta')
    expect(f.niches).toEqual([{ key: 'techno', label: 'Techno', path: '/panoramas/fiestas/techno', count: 1 }])
  })

  it('detalle: oculto = null; comentarios aprobados con promedio', async () => {
    expect(await P.loadPanoramaDetail(db, 3, '2026-11-26')).toBeNull()
    db.tables.aitickets_panorama_reviews.push(
      { id: 'r1', event_id: 1, event_date_id: 11, rating: 5, comment: 'Brutal', public_comment: null, display_name: 'Ana', status: 'approved', moderated_at: '2026-11-23T00:00:00Z' },
      { id: 'r2', event_id: 1, rating: 4, comment: 'Original', public_comment: 'Corregido', display_name: null, status: 'approved', moderated_at: '2026-11-24T00:00:00Z' },
      { id: 'r3', event_id: 1, rating: 1, comment: 'Pendiente', status: 'pending' },
    )
    const d = await P.loadPanoramaDetail(db, 1, '2026-11-26')
    expect(d.rating).toEqual({ average: 4.5, count: 2 })
    expect(d.reviews.map((r) => [r.name, r.comment])).toEqual([['Ana', 'Brutal'], ['Asistente verificado', 'Corregido']])
    expect(d.reviews[0].function_label).toMatch(/^Sábado 21 de noviembre · Club Subterráneo/)
  })

  it('sin la migración: null (la página muestra el estado vacío)', async () => {
    db.failOn('aitickets_external_event_dates', 'select', { code: '42P01', message: 'no existe' })
    expect(await P.loadPanoramaFeed(db, '2026-11-26')).toBeNull()
  })
})

describe('POST /api/panoramas/reviews', () => {
  const send = (fields = {}, file = PNG, name = 'entrada.png') => {
    const fd = new FormData()
    const base = { event_id: '1', rating: '5', comment: 'Muy buena fiesta, gran sonido y puntual.', email: 'Ana@Correo.cl', name: 'Ana', date_id: '11', started_at: String(Date.now() - 60_000), ...fields }
    for (const [k, v] of Object.entries(base)) if (v != null) fd.set(k, v)
    if (file) fd.set('file', new File([file], name))
    return POST({ request: new Request('https://aitickets.cl/api/panoramas/reviews', { method: 'POST', body: fd, headers: { 'x-nf-client-connection-ip': '1.2.3.4' } }) })
  }

  it('guarda el comentario pendiente y el comprobante en el bucket privado; avisa a Slack', async () => {
    const res = await send()
    expect(res.status, await res.clone().text()).toBe(201)
    const [row] = db.tables.aitickets_panorama_reviews
    expect(row).toMatchObject({ event_id: 1, event_date_id: 11, rating: 5, email: 'ana@correo.cl', display_name: 'Ana', status: 'pending', proof_kind: 'image', proof_content_type: 'image/png' })
    expect(row.proof_path).toMatch(/^1\/\d+-[a-z0-9]+\.png$/)
    expect(row.proof_sha256).toHaveLength(64)
    expect(row.ip_hash).not.toContain('1.2.3.4')
    expect(db.storage.files.has(`aitickets-panorama-proofs/${row.proof_path}`)).toBe(true)
    expect(h.slack[0]).toMatch(/list_panorama_reviews/)
  })

  it('una sola opinión por correo y evento; una rechazada se puede reenviar y reemplaza el comprobante', async () => {
    expect((await send()).status).toBe(201)
    expect((await send({ email: 'ana@correo.cl' })).status).toBe(409)
    const first = db.tables.aitickets_panorama_reviews[0]
    const oldPath = first.proof_path
    first.status = 'rejected'
    const again = await send({ comment: 'Ahora con el PDF de la entrada, estuvo increíble.' }, PDF, 'entrada.pdf')
    expect(again.status).toBe(201)
    expect(db.tables.aitickets_panorama_reviews).toHaveLength(1)
    expect(db.tables.aitickets_panorama_reviews[0]).toMatchObject({ status: 'pending', proof_kind: 'pdf' })
    expect(db.storage.files.has(`aitickets-panorama-proofs/${oldPath}`)).toBe(false)
  })

  it('valida: archivo, estrellas, comentario, evento oculto, evento que no empezó y función ajena', async () => {
    expect((await send({}, Buffer.from('<svg onload=alert(1)>'), 'x.png')).status).toBe(400)
    expect((await send({}, null)).status).toBe(400)
    expect((await send({ rating: '6' })).status).toBe(400)
    expect((await send({ comment: 'corto' })).status).toBe(400)
    expect((await send({ email: 'no-es-correo' })).status).toBe(400)
    expect((await send({ event_id: '3' })).status).toBe(404)
    expect((await send({ event_id: '2', date_id: null })).status).toBe(400) // el 28-11 todavía no ocurre
    expect((await send({ date_id: '21' })).status).toBe(400)
    expect(db.tables.aitickets_panorama_reviews).toHaveLength(0)
    expect(db.storage.files.size).toBe(0)
  })

  it('bots y abuso: honeypot no guarda nada; límite por IP', async () => {
    const bot = await send({ hp: 'http://spam.test' })
    expect(bot.status).toBe(201)
    expect(db.tables.aitickets_panorama_reviews).toHaveLength(0)
    h.rateAllowed = false
    expect((await send()).status).toBe(429)
  })
})

describe('MCP de admin: moderación', () => {
  const seed = async () => {
    await send2('ana@correo.cl', EML)
    await send2('beto@correo.cl', PNG)
    await send2('caro@correo.cl', PNG) // mismo archivo que beto
    return db.tables.aitickets_panorama_reviews.map((r) => r.id)
  }
  const send2 = (email, file) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries({ event_id: '1', rating: '4', comment: 'Muy buena fiesta, gran sonido y puntual.', email, date_id: '11', started_at: '1' })) fd.set(k, v)
    fd.set('file', new File([file], 'x'))
    return POST({ request: new Request('https://aitickets.cl/api/panoramas/reviews', { method: 'POST', body: fd }) })
  }

  it('list_panorama_reviews: pendientes con el evento, el link público y archivos repetidos', async () => {
    const [ana, beto, caro] = await seed()
    const r = await run('list_panorama_reviews', {})
    expect(r.total).toBe(3)
    expect(r.counts).toMatchObject({ pending: 3, approved: 0 })
    const byId = Object.fromEntries(r.items.map((i) => [i.id, i]))
    expect(byId[ana]).toMatchObject({ email: 'ana@correo.cl', shown_as: 'Asistente verificado', proof: { kind: 'email', same_file_in: [] }, event: { public_url: 'https://aitickets.cl/panoramas/evento/techno-night-subterraneo-1' } })
    expect(byId[beto].proof.same_file_in).toEqual([{ review_id: caro, event_id: 1 }])
    expect(r.note).toMatch(/DATO/)
  })

  it('get_panorama_review: link firmado, vista previa del correo y señales; exige la llave completa', async () => {
    const [ana, beto] = await seed()
    const r = await run('get_panorama_review', { id: ana })
    expect(r.proof.url).toMatch(/^https:\/\/storage\.test\/aitickets-panorama-proofs\/1\//)
    expect(r.proof.email.subject).toBe('Tus entradas para Techno Night 🎟')
    expect(r.event_functions.map((d) => d.date)).toEqual(['2026-11-21', '2026-12-05'])
    expect((await run('get_panorama_review', { id: beto })).signals.same_file_in_other_reviews).toBe(1)
    const ro = await runAdminTool(getAdminTool('get_panorama_review'), { id: ana }, actx('read_only'))
    expect(ro.ok).toBe(false)
  })

  it('moderate_panorama_reviews: aprueba con texto corregido, rechaza y borra el comprobante; solo lo aprobado se publica', async () => {
    const [ana, beto] = await seed()
    const noReason = await runAdminTool(getAdminTool('moderate_panorama_reviews'), { reviews: [{ id: ana, action: 'approve' }] }, actx())
    expect(noReason.ok).toBe(false)
    const r = await run('moderate_panorama_reviews', {
      reason: 'Validación de comprobantes de panoramas',
      reviews: [
        { id: ana, action: 'approve', public_comment: 'Muy buena fiesta.', delete_proof: true },
        { id: beto, action: 'reject', note: 'Mismo archivo que otro comentario' },
      ],
    })
    expect(r).toMatchObject({ approved: 1, rejected: 1, proofs_deleted: 1, errors: 0 })
    const rows = Object.fromEntries(db.tables.aitickets_panorama_reviews.map((x) => [x.id, x]))
    expect(rows[ana]).toMatchObject({ status: 'approved', public_comment: 'Muy buena fiesta.', proof_path: null })
    expect(rows[ana].proof_deleted_at).toBeTruthy()
    expect(rows[beto].moderation_note).toMatch(/\[2026-11-26\] Mismo archivo/)
    const d = await P.loadPanoramaDetail(db, 1, '2026-11-26')
    expect(d.reviews.map((x) => x.comment)).toEqual(['Muy buena fiesta.'])
  })

  it('register/update_external_event: campos públicos y public_url; una importación no cambia la visibilidad', async () => {
    const reg = await run('register_external_events', {
      reason: 'Carga semanal de panoramas',
      events: [
        { name: 'Jazz en el Parque', category: 'concierto', niche: 'jazz', description: 'Jazz al aire libre.', image_url: 'https://cdn.test/jazz.jpg', public_status: 'featured', dates: [{ date: '2026-12-10', city: 'Santiago' }] },
      ],
    })
    const created = reg.results[0]
    expect(created.public_url).toMatch(/\/panoramas\/evento\/jazz-en-el-parque-\d+$/)
    const row = db.tables.aitickets_external_events.find((e) => e.name === 'Jazz en el Parque')
    expect(row).toMatchObject({ description: 'Jazz al aire libre.', image_url: 'https://cdn.test/jazz.jpg', public_status: 'featured' })

    const again = await run('register_external_events', { reason: 'Carga semanal de panoramas', events: [{ event_id: row.id, public_status: 'auto', dates: [{ date: '2026-12-10', city: 'Santiago' }] }] })
    expect(row.public_status).toBe('featured')
    expect(again.results[0].warnings.join(' ')).toMatch(/public_status no se cambió/)

    const upd = await run('update_external_event', { id: row.id, public_status: 'hidden', reason: 'Ocultar de panoramas: datos dudosos' })
    expect(upd.event.public).toMatchObject({ status: 'hidden', listed: false, url: null })
    const bad = await runAdminTool(getAdminTool('update_external_event'), { id: row.id, image_url: 'http://inseguro.test/a.jpg', reason: 'probar validación' }, actx())
    expect(bad.ok).toBe(false)
  })
})

// Rutas públicas de reseñas (/api/reviews, /api/reviews/verify, /api/reviews/request-link, /api/reviews/photos):
// validación de asistencia con token firmado, premio de un solo uso, comentarios ocultos y fotos.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(async () => ({ id: 'mail' })),
  storeOptimizedImage: vi.fn(async () => ({ url: 'https://cdn.test/foto.jpg', thumb_url: 'https://cdn.test/foto-thumb.webp', width: 1200, height: 900 })),
}))

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db }))
vi.mock('../../src/lib/supabaseServer', () => ({
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))
vi.mock('../../src/lib/sites', () => ({ clientIpFrom: () => '203.0.113.7' }))
vi.mock('../../netlify/lib/rate-limit.mjs', () => ({ rateLimit: async () => ({ allowed: true, source: 'memory' }) }))
vi.mock('../../netlify/lib/mailer.mjs', async (importOriginal) => ({ ...(await importOriginal()), sendEmail: mocks.sendEmail }))
vi.mock('../../src/lib/imageStorage', () => ({ storeOptimizedImage: mocks.storeOptimizedImage, IMAGE_BUCKET: 'Events' }))
vi.mock('../../src/lib/imageOptimize', () => ({ sniffImageType: () => 'image/jpeg', IMAGE_EXT: { 'image/jpeg': 'jpg' } }))

const reviewsApi = await import('../../src/pages/api/reviews/index.ts')
const verifyApi = await import('../../src/pages/api/reviews/verify.ts')
const linkApi = await import('../../src/pages/api/reviews/request-link.ts')
const photosApi = await import('../../src/pages/api/reviews/photos.ts')
const videosApi = await import('../../src/pages/api/reviews/videos.ts')
const sessionApi = await import('../../src/pages/api/reviews/session.ts')
const { loadPublicReviews } = await import('../../src/lib/eventReviews.ts')
const { signReviewToken } = await import('../../netlify/lib/review-token.mjs')

const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const post = (path, body) => ({
  request: new Request(`https://aitickets.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  url: new URL(`https://aitickets.test${path}`),
  locals: {},
})
const token = (email = 'ana@x.cl', eventId = 10) => signReviewToken({ eventId, email })

beforeEach(() => {
  vi.stubEnv('REVIEW_TOKEN_SECRET', 'test-secret')
  mocks.sendEmail.mockClear()
  mocks.storeOptimizedImage.mockClear()
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Prod SpA', website: 'https://prod.cl' }],
      events: [
        { id: 10, name: 'Show', slug: 'show', status: 'published', organization_id: 7, review_settings: { reward: { value: 10, valid_days: 30 } } },
        { id: 11, name: 'Futuro', slug: 'futuro', status: 'published', organization_id: 7, review_settings: null },
        { id: 12, name: 'Fotos con revisión', slug: 'fotos', status: 'published', organization_id: 7, review_settings: { moderate_photos: true } },
      ],
      event_dates: [
        { id: 101, event_id: 10, date: '2020-01-10', start_time: '20:00', end_time: '23:00' },
        { id: 111, event_id: 11, date: '2099-01-10', start_time: '20:00', end_time: '23:00' },
        { id: 121, event_id: 12, date: '2020-01-10', start_time: '20:00', end_time: '23:00' },
      ],
      attendees: [{ id: 1, first_name: 'Ana', last_name: 'Rojas', email: 'ana@x.cl' }],
      event_orders: [{ id: ORDER, event_id: 10, status: 'paid', attendee_id: 1, buyer_first_name: 'Ana', buyer_last_name: 'Rojas', buyer_email: 'ana@x.cl' }],
      event_attendees: [
        { id: 't1', event_id: 10, attendee_id: 1, status: 'active', event_order_id: ORDER, event_orders: { buyer_first_name: 'Ana', buyer_last_name: 'Rojas' } },
        { id: 't2', event_id: 12, attendee_id: 1, status: 'active', event_orders: null },
        { id: 't3', event_id: 11, attendee_id: 1, status: 'active', event_orders: null },
      ],
      aitickets_event_reviews: [],
      aitickets_event_review_photos: [],
      aitickets_discount_codes: [],
    },
    unique: { aitickets_event_reviews: [['event_id', 'email']] },
  })
  db.storage = fakeStorage()
})

/** Storage falso: archivos subidos { 'bucket/path': { contentType, size } } y registro de borrados. */
const STORAGE = 'https://ref.supabase.co/storage/v1/object/public/'
function fakeStorage() {
  const files = {}
  const removed = []
  return {
    files,
    removed,
    from: (bucket) => ({
      getPublicUrl: (p) => ({ data: { publicUrl: `${STORAGE}${bucket}/${p}` } }),
      createSignedUploadUrl: async (p) => ({ data: { signedUrl: `https://ref.supabase.co/storage/v1/object/upload/sign/${bucket}/${p}?token=t`, path: p }, error: null }),
      info: async (p) => (files[`${bucket}/${p}`] ? { data: files[`${bucket}/${p}`], error: null } : { data: null, error: { message: 'Object not found' } }),
      remove: async (paths) => {
        removed.push(...paths.map((p) => `${bucket}/${p}`))
        return { data: [], error: null }
      },
    }),
  }
}

describe('POST /api/reviews', () => {
  it('crea la reseña y entrega UN código de premio de un solo uso (y lo manda por correo)', async () => {
    const res = await reviewsApi.POST(post('/api/reviews', { token: token(), rating: 5, public_comment: ' ¡Increíble! ', private_comment: 'El baño estaba lejos' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(true)
    expect(body.review).toMatchObject({ rating: 5, public_comment: '¡Increíble!', private_comment: 'El baño estaba lejos' })
    expect(body.reward.code).toMatch(/^GRACIAS-/)
    const [code] = db.tables.aitickets_discount_codes
    expect(code).toMatchObject({ organization_id: 7, event_id: null, kind: 'percent', value: 10, max_uses: 1, per_buyer_limit: 1, source: 'review_reward', active: true })
    expect(new Date(code.ends_at).getTime() - Date.now()).toBeGreaterThan(29 * 86400_000)
    expect(db.tables.aitickets_event_reviews[0]).toMatchObject({ email: 'ana@x.cl', display_name: 'Ana R.', verified_via: 'email_link', reward_code: code.code, reward_code_id: code.id })
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'ana@x.cl' })
    expect(mocks.sendEmail.mock.calls[0][0].html).toContain(code.code)

    // Editar la reseña: se actualiza y no crea otro código
    const again = await reviewsApi.POST(post('/api/reviews', { token: token(), rating: 4, public_comment: '' }))
    const edited = await again.json()
    expect(edited.created).toBe(false)
    expect(edited.review).toMatchObject({ rating: 4, public_comment: null })
    expect(edited.reward.code).toBe(code.code)
    expect(db.tables.aitickets_discount_codes).toHaveLength(1)
    expect(db.tables.aitickets_event_reviews).toHaveLength(1)
  })

  it('valida estrellas, token, asistencia y que el evento ya haya empezado', async () => {
    expect((await reviewsApi.POST(post('/api/reviews', { token: token(), rating: 7 }))).status).toBe(400)
    expect((await reviewsApi.POST(post('/api/reviews', { token: 'falso.token', rating: 5 }))).status).toBe(401)
    expect((await reviewsApi.POST(post('/api/reviews', { token: token('otra@x.cl'), rating: 5 }))).status).toBe(403)
    expect((await reviewsApi.POST(post('/api/reviews', { token: token('ana@x.cl', 11), rating: 5 }))).status).toBe(409)
    expect(db.tables.aitickets_event_reviews).toHaveLength(0)
  })
})

describe('GET /api/reviews', () => {
  it('comentarios visibles; un comentario oculto no se muestra pero su nota cuenta', async () => {
    db.tables.aitickets_event_reviews.push(
      { id: 'r1', event_id: 10, email: 'a@x.cl', display_name: 'A.', rating: 5, public_comment: 'Top', public_status: 'visible', created_at: '2026-10-01' },
      { id: 'r2', event_id: 10, email: 'b@x.cl', display_name: 'B.', rating: 1, public_comment: 'Insulto', public_status: 'hidden', created_at: '2026-10-02' },
      { id: 'r3', event_id: 10, email: 'c@x.cl', display_name: 'C.', rating: 3, public_comment: null, public_status: 'visible', created_at: '2026-10-03' },
    )
    const res = await reviewsApi.GET({ url: new URL('https://aitickets.test/api/reviews?eventId=10') })
    const body = await res.json()
    expect(body.summary).toMatchObject({ count: 3, average: 3 })
    expect(body.reviews.map((r) => r.comment)).toEqual(['Top'])
    expect(body.reviews[0]).not.toHaveProperty('email')
    expect(res.headers.get('Netlify-CDN-Cache-Control')).toContain('s-maxage=30')
  })
})

describe('validación de asistencia', () => {
  it('con el link de la orden entrega un token de reseña y la sesión', async () => {
    const res = await verifyApi.POST(post('/api/reviews/verify', { eventId: 10, reference: `https://aitickets.cl/order/${ORDER}` }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.token).toBeTruthy()
    expect(body).toMatchObject({ verified_via: 'order', email: 'an*@x.cl', name: 'Ana', review: null, reward_offer: { label: '10% de descuento' } })
    // La vía queda firmada en el token y se guarda con la reseña
    await reviewsApi.POST(post('/api/reviews', { token: body.token, rating: 5 }))
    expect(db.tables.aitickets_event_reviews[0].verified_via).toBe('order')
  })
  it('referencia que no es de este evento: 404', async () => {
    const res = await verifyApi.POST(post('/api/reviews/verify', { eventId: 12, reference: ORDER }))
    expect(res.status).toBe(404)
  })
  it('validar con el correo: misma respuesta tenga o no entradas; solo a quien tiene le llega el link', async () => {
    const yes = await linkApi.POST(post('/api/reviews/request-link', { eventId: 10, email: 'ANA@x.cl' }))
    const no = await linkApi.POST(post('/api/reviews/request-link', { eventId: 10, email: 'nadie@x.cl' }))
    expect(yes.status).toBe(200)
    expect(await no.json()).toEqual(await yes.json())
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    const sent = mocks.sendEmail.mock.calls[0][0]
    expect(sent.to).toBe('ana@x.cl')
    expect(sent.html).toMatch(/\/eventos\/show#resena=/)
  })
})

describe('POST /api/reviews/photos', () => {
  const upload = (t) => {
    const form = new FormData()
    form.append('token', t)
    form.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'foto.jpg', { type: 'image/jpeg' }))
    return { request: new Request('https://aitickets.test/api/reviews/photos', { method: 'POST', body: form }), url: new URL('https://aitickets.test/api/reviews/photos') }
  }

  it('sube la foto visible (o pendiente si la productora revisa), con tope por persona, y quien la subió la borra', async () => {
    const res = await photosApi.POST(upload(token()))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.photo).toMatchObject({ status: 'visible', url: 'https://cdn.test/foto.jpg' })
    expect(mocks.storeOptimizedImage.mock.calls[0][2].pathPrefix).toBe('event-attendee-photos/10/foto')
    expect(db.tables.aitickets_event_review_photos[0]).toMatchObject({ event_id: 10, organization_id: 7, email: 'ana@x.cl', display_name: 'Ana R.' })

    const moderated = await (await photosApi.POST(upload(token('ana@x.cl', 12)))).json()
    expect(moderated.photo.status).toBe('pending')

    for (let i = 0; i < 5; i++) await photosApi.POST(upload(token()))
    expect((await photosApi.POST(upload(token()))).status).toBe(409)

    // En la BD real el id es uuid (el Supabase falso pone números)
    const PHOTO = '44444444-4444-4444-8444-444444444444'
    db.tables.aitickets_event_review_photos.find((p) => p.id === body.photo.id).id = PHOTO
    expect((await photosApi.POST(post('/api/reviews/photos', { token: token('ana@x.cl', 12), action: 'delete', id: PHOTO }))).status).toBe(200)
    expect(db.tables.aitickets_event_review_photos.some((p) => p.id === PHOTO)).toBe(true) // otro evento: no la borra
    const del = await photosApi.POST(post('/api/reviews/photos', { token: token(), action: 'delete', id: PHOTO }))
    expect(del.status).toBe(200)
    expect((await del.json()).photos).toHaveLength(5)
  })
})

describe('POST /api/reviews/videos', () => {
  const json = (body) => videosApi.POST(post('/api/reviews/videos', body))
  const confirm = (t, url, extra = {}) => {
    const form = new FormData()
    form.append('token', t)
    form.append('action', 'set')
    form.append('url', url)
    for (const [k, v] of Object.entries(extra)) form.append(k, v)
    return videosApi.POST({ request: new Request('https://aitickets.test/api/reviews/videos', { method: 'POST', body: form }), url: new URL('https://aitickets.test/api/reviews/videos') })
  }
  /** Pide la URL firmada y "sube" el archivo al Storage falso. Devuelve la URL pública. */
  const uploadVideo = async (t = token(), file = { contentType: 'video/mp4', size: 8_000_000 }) => {
    const res = await json({ token: t, action: 'upload_url', contentType: 'video/mp4', size: file.size, duration: 20 })
    expect(res.status).toBe(200)
    const { publicUrl } = await res.json()
    db.storage.files[publicUrl.slice(STORAGE.length)] = file
    return publicUrl
  }
  const poster = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'poster.jpg', { type: 'image/jpeg' })

  it('URL firmada en la carpeta de videos del evento, validando formato, peso, duración y asistencia', async () => {
    const res = await json({ token: token(), action: 'upload_url', contentType: 'video/mp4', size: 10_000_000, duration: 30 })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.publicUrl).toMatch(new RegExp(`^${STORAGE}aitickets-event-videos/event-attendee-videos/10/video-.+\\.mp4$`))
    expect(body.uploadUrl).toContain('/object/upload/sign/')
    expect(body.max_bytes).toBe(50 * 1024 * 1024)

    expect((await json({ token: token(), action: 'upload_url', contentType: 'image/gif', size: 100 })).status).toBe(400)
    expect((await json({ token: token(), action: 'upload_url', contentType: 'video/mp4', size: 51 * 1024 * 1024 })).status).toBe(400)
    expect((await json({ token: token(), action: 'upload_url', contentType: 'video/mp4', size: 1000, duration: 75 })).status).toBe(400)
    expect((await json({ token: 'x.y', action: 'upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(401)
    expect((await json({ token: token('otra@x.cl'), action: 'upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(403)
  })

  it('confirma el video con su póster (visible, o pendiente si la productora revisa) y no lo duplica', async () => {
    const url = await uploadVideo()
    const res = await confirm(token(), url, { width: '1080', height: '1920', duration: '24', poster: poster() })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.video).toMatchObject({ media_type: 'video', url, thumb_url: 'https://cdn.test/foto.jpg', status: 'visible', duration: 24 })
    expect(mocks.storeOptimizedImage.mock.calls[0][2].pathPrefix).toBe('event-attendee-photos/10/poster')
    expect(db.tables.aitickets_event_review_photos[0]).toMatchObject({ event_id: 10, organization_id: 7, email: 'ana@x.cl', display_name: 'Ana R.', media_type: 'video', width: 1080, height: 1920 })

    // Doble clic: mismo archivo, misma fila
    expect((await confirm(token(), url)).status).toBe(200)
    expect(db.tables.aitickets_event_review_photos).toHaveLength(1)

    const moderated = await confirm(token('ana@x.cl', 12), await uploadVideo(token('ana@x.cl', 12)))
    expect((await moderated.json()).video.status).toBe('pending')
  })

  it('rechaza archivos de otra carpeta, que no se subieron o que no son video (y los borra)', async () => {
    expect((await confirm(token(), `${STORAGE}aitickets-event-videos/event-attendee-videos/11/video-1.mp4`)).status).toBe(400) // otro evento
    expect((await confirm(token(), `${STORAGE}aitickets-event-videos/event-videos/7/10-1.mp4`)).status).toBe(400) // portada del productor
    expect((await confirm(token(), `${STORAGE}aitickets-event-videos/event-attendee-videos/10/video-nunca.mp4`)).status).toBe(400)

    const fake = await uploadVideo(token(), { contentType: 'application/zip', size: 1000 })
    const res = await confirm(token(), fake)
    expect(res.status).toBe(400)
    expect(db.storage.removed).toEqual([fake.slice(STORAGE.length)])
    expect(db.tables.aitickets_event_review_photos).toHaveLength(0)
  })

  it('máximo 2 videos por persona, aparte de las 6 fotos; borrar un video borra su archivo', async () => {
    await confirm(token(), await uploadVideo())
    await confirm(token(), await uploadVideo())
    expect((await json({ token: token(), action: 'upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(409)

    // Las fotos tienen su propio tope
    const photo = () => {
      const form = new FormData()
      form.append('token', token())
      form.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'foto.jpg', { type: 'image/jpeg' }))
      return photosApi.POST({ request: new Request('https://aitickets.test/api/reviews/photos', { method: 'POST', body: form }), url: new URL('https://aitickets.test/api/reviews/photos') })
    }
    for (let i = 0; i < 6; i++) expect((await photo()).status).toBe(201)
    expect((await photo()).status).toBe(409)

    // La sesión separa fotos y videos y trae los límites
    const session = await (await sessionApi.POST(post('/api/reviews/session', { token: token() }))).json()
    expect(session).toMatchObject({ max_photos: 6, max_videos: 2, max_video_seconds: 60, max_video_bytes: 50 * 1024 * 1024 })
    expect(session.photos.filter((p) => p.media_type === 'video')).toHaveLength(2)

    // Quien lo subió lo borra: la fila y el archivo
    const VIDEO = '55555555-5555-4555-8555-555555555555'
    const row = db.tables.aitickets_event_review_photos.find((p) => p.media_type === 'video')
    row.id = VIDEO
    const del = await photosApi.POST(post('/api/reviews/photos', { token: token(), action: 'delete', id: VIDEO }))
    expect(del.status).toBe(200)
    expect(db.tables.aitickets_event_review_photos.some((p) => p.id === VIDEO)).toBe(false)
    expect(db.storage.removed).toEqual([row.url.slice(STORAGE.length)])
    expect((await json({ token: token(), action: 'upload_url', contentType: 'video/mp4', size: 1000 })).status).toBe(200)
  })

  it('la página pública recibe fotos y videos visibles con media_type', async () => {
    await confirm(token(), await uploadVideo(), { duration: '12', poster: poster() })
    db.tables.aitickets_event_review_photos.push({ id: 'f1', event_id: 10, url: 'https://cdn.test/f1.jpg', status: 'visible', display_name: 'Beto S.' })
    db.tables.aitickets_event_review_photos.push({ id: 'v2', event_id: 10, media_type: 'video', url: 'https://cdn.test/v2.mp4', status: 'hidden' })
    const pub = await loadPublicReviews(10, { supabase: db })
    expect(pub.photos.map((p) => [p.media_type, p.duration])).toEqual([['video', 12], ['photo', null]])
  })
})

describe('POST /api/reviews/videos: el video de otra persona', () => {
  it('no se puede reclamar (ni, por lo tanto, borrar) un video que ya está en la galería', async () => {
    // Beto también tiene entrada del evento 10
    db.tables.attendees.push({ id: 2, first_name: 'Beto', last_name: 'Soto', email: 'beto@x.cl' })
    db.tables.event_attendees.push({ id: 't9', event_id: 10, attendee_id: 2, status: 'active', event_orders: null })
    const res = await videosApi.POST(post('/api/reviews/videos', { token: token(), action: 'upload_url', contentType: 'video/mp4', size: 1000 }))
    const { publicUrl } = await res.json()
    db.storage.files[publicUrl.slice(STORAGE.length)] = { contentType: 'video/mp4', size: 1000 }
    const confirmAs = (email) => {
      const form = new FormData()
      form.append('token', token(email))
      form.append('action', 'set')
      form.append('url', publicUrl)
      return videosApi.POST({ request: new Request('https://aitickets.test/api/reviews/videos', { method: 'POST', body: form }), url: new URL('https://aitickets.test/api/reviews/videos') })
    }
    expect((await confirmAs('ana@x.cl')).status).toBe(201)
    expect((await confirmAs('beto@x.cl')).status).toBe(400)
    expect(db.tables.aitickets_event_review_photos.map((p) => p.email)).toEqual(['ana@x.cl'])
    expect(db.storage.removed).toEqual([])
  })
})

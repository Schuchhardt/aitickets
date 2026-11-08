// Rutas /api/sites/* del editor del sitio del productor (todas detrás de requireSiteAdmin: sesión + rol admin/producer):
// IA (ai.ts), banners (POST/PUT/DELETE/PATCH), dominio propio (GET/POST/DELETE), sitio (GET/PUT), disponibilidad del
// slug y subida de imágenes. En cada una: sin sesión, roles sin permiso, recursos de otra organización (sin escribir
// nada) y un caso feliz con lo que se guarda. src/lib/sites.ts tiene sus propios tests en sites.test.mjs.
// Supabase, proveedor de dominios (Netlify), DNS, IA, correo y Storage falsos (sin red).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
const UPCOMING = new Date(Date.now() + 30 * 86_400_000).toISOString() // evento siempre futuro

const h = vi.hoisted(() => ({
  domainCalls: [],
  addDomain: null,
  checkDomain: null,
  removeFails: false,
  txt: { ok: false, code: 'missing', error: 'Falta el TXT' },
  rateAllowed: true,
  rateCalls: [],
  siteEdit: null,
  siteEditCalls: [],
  contactConfirm: null,
  contactCalls: [],
}))
let db
let session

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', async (importOriginal) => ({ ...(await importOriginal()), getSessionContext: async () => session }))
vi.mock('../../netlify/lib/rate-limit.mjs', () => ({
  rateLimit: async (...args) => {
    h.rateCalls.push(args)
    return { allowed: h.rateAllowed, source: 'db' }
  },
}))
vi.mock('../../src/lib/aiText', async (importOriginal) => ({
  ...(await importOriginal()),
  generateSiteEdit: async (input) => {
    h.siteEditCalls.push(input)
    return h.siteEdit(input)
  },
}))
// getSiteEvents usa .or() (no lo soporta la BD falsa): se reemplaza por un filtro equivalente por organización.
vi.mock('../../src/lib/sites', async (importOriginal) => ({
  ...(await importOriginal()),
  getSiteEvents: async (site) =>
    (db.tables.events || []).filter((e) => e.organization_id === site.organization_id && e.status === 'published'),
}))
vi.mock('../../src/lib/site-contact-email', () => ({
  sendContactEmailConfirmation: async (opts) => {
    h.contactCalls.push(opts)
    return h.contactConfirm(opts)
  },
}))
// API de Netlify (alias de dominio) y DNS falsos
vi.mock('../../netlify/lib/domains/netlify.mjs', () => {
  class DomainProviderError extends Error {
    constructor(message, code, status) {
      super(message)
      this.code = code
      this.status = status
    }
  }
  return {
    DomainProviderError,
    netlifyProvider: {
      name: 'netlify',
      addDomain: async (hostname, opts) => {
        h.domainCalls.push(['add', hostname, opts])
        return h.addDomain(hostname, opts)
      },
      checkDomain: async (site) => {
        h.domainCalls.push(['check', site.custom_domain])
        return h.checkDomain(site)
      },
      removeDomain: async (site) => {
        h.domainCalls.push(['remove', site.custom_domain])
        if (h.removeFails) throw new Error('Netlify no respondió')
      },
    },
  }
})
vi.mock('../../netlify/lib/domains/dns.mjs', () => ({
  checkOwnershipTxt: async () => h.txt,
  checkDnsPointing: async () => ({ ok: false, code: 'missing' }),
  checkHttps: async () => ({ ok: false }),
}))

const aiRoute = await import('../../src/pages/api/sites/ai.ts')
const banners = await import('../../src/pages/api/sites/banners.ts')
const domain = await import('../../src/pages/api/sites/domain.ts')
const sitesIndex = await import('../../src/pages/api/sites/index.ts')
const slugCheck = await import('../../src/pages/api/sites/slug-check.ts')
const upload = await import('../../src/pages/api/sites/upload.ts')
const { AiRefusalError } = await import('../../src/lib/aiText')

const ALL_ROLES = ['producer', 'admin', 'finance', 'editor', 'validator', 'viewer']
const OAR = ['admin', 'producer']
const DENIED = ALL_ROLES.filter((r) => !OAR.includes(r))
const CDN = 'https://proj.supabase.co/storage/v1/object/public/Events/sites'
const PNG = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer()
const OLD = '2026-11-01T00:00:00.000Z'

const asRole = (role, orgId = 7) => {
  session = { authUser: { id: 'auth-1' }, dbUser: { id: 1, organization_id: orgId, role } }
}
const writes = () => db.calls.filter((c) => c.op !== 'select' && c.op !== 'rpc')
const site = (orgId) => db.tables.aitickets_sites.find((s) => s.organization_id === orgId)
const banner = (id) => db.tables.aitickets_site_banners.find((b) => b.id === id)
const req = (method, { path = '/api/sites', query = '', body, raw } = {}) => {
  const url = new URL(`https://aitickets.cl${path}${query}`)
  const init = { method }
  if (body !== undefined) Object.assign(init, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (raw !== undefined) init.body = raw
  return { url, request: new Request(url, init), cookies: {} }
}

function seed() {
  db = createFakeSupabase({
    tables: {
      organizations: [
        { id: 7, public_name: 'Club Norte', email: 'sin-verificar@norte.cl', email_verified_at: '2026-01-01T00:00:00Z', email_verified_for: 'hola@norte.cl' },
        { id: 8, public_name: 'Otra Productora', email: 'otra@otra.cl', email_verified_at: '2026-01-01T00:00:00Z', email_verified_for: 'otra@otra.cl' },
        { id: 9, public_name: 'Productora Nueva', email_verified_at: null, email_verified_for: null },
      ],
      events: [
        { id: 10, organization_id: 7, status: 'published', name: 'Viernes Techno', slug: 'viernes', start_date: UPCOMING, end_date: null, location: 'Valparaíso', image_url: `${CDN}/7/evento.jpg` },
        { id: 11, organization_id: 7, status: 'draft', name: 'Borrador Secreto', slug: 'borrador' },
        { id: 20, organization_id: 8, status: 'published', name: 'Evento Ajeno', slug: 'ajeno', start_date: UPCOMING, image_url: `${CDN}/8/ajeno.jpg` },
      ],
      aitickets_sites: [
        {
          id: 1, organization_id: 7, slug: 'club-norte', template: 'clasico', theme: { primary: '#111111', logo_url: `${CDN}/7/logo.png` },
          content: { title: 'Club Norte', legacy_key: 'se conserva' }, seo: {}, contact_email: null, contact_form_enabled: true,
          published: true, published_at: OLD, custom_domain: null, domain_status: 'none', domain_provider: null, domain_verification: null, updated_at: OLD,
        },
        {
          id: 2, organization_id: 8, slug: 'otra-productora', template: 'nocturno', theme: {}, content: { title: 'Otra' }, seo: {},
          contact_email: 'otra@otra.cl', contact_form_enabled: true, published: true, published_at: OLD,
          custom_domain: 'entradas.otra.cl', domain_status: 'active', domain_provider: 'netlify', domain_requested_at: OLD,
          domain_verification: { token: 'tok-otra', attached_at: OLD }, updated_at: OLD,
        },
      ],
      aitickets_site_banners: [
        { id: 101, site_id: 1, image_url: `${CDN}/7/b1.jpg`, link_url: null, alt: 'Uno', placement: 'hero', sort_order: 0, active: true },
        { id: 102, site_id: 1, image_url: `${CDN}/7/b2.jpg`, link_url: null, alt: 'Dos', placement: 'hero', sort_order: 1, active: true },
        { id: 201, site_id: 2, image_url: `${CDN}/8/ajeno.jpg`, link_url: null, alt: 'Ajeno', placement: 'hero', sort_order: 0, active: true },
      ],
    },
  })
  db.uploads = []
  db.storage = {
    from: (bucket) => ({
      upload: async (path, buf, opts) => {
        db.uploads.push({ bucket, path, bytes: buf.length, contentType: opts?.contentType })
        return { data: { path }, error: null }
      },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  }
}

beforeEach(() => {
  seed()
  asRole('producer')
  vi.stubEnv('DOMAIN_PROVIDER', 'netlify')
  vi.stubEnv('NETLIFY_AUTH_TOKEN', 'nf-test')
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
  h.domainCalls.length = 0
  h.rateCalls.length = 0
  h.siteEditCalls.length = 0
  h.contactCalls.length = 0
  h.rateAllowed = true
  h.removeFails = false
  h.txt = { ok: false, code: 'missing', error: 'Falta el TXT' }
  h.addDomain = (hostname, { token }) => ({
    providerId: hostname, status: 'pending_ssl', records: [], error: null,
    verification: { token, attached_at: new Date().toISOString(), owner_verified_at: new Date().toISOString() },
  })
  h.checkDomain = (s) => ({ status: s.domain_status, error: null, verification: { ...(s.domain_verification || {}) } })
  h.siteEdit = () => ({ summary: 'Listo', sections: [], order: [], template: '', theme: {}, title: '', tagline: '', about: '' })
  h.contactConfirm = () => ({ ok: true })
})

// ---------------------------------------------------------------------------
// requireSiteAdmin en todas las rutas
// ---------------------------------------------------------------------------
describe('requireSiteAdmin: sesión y rol admin/producer en todas las rutas /api/sites/*', () => {
  const pngForm = () => {
    const fd = new FormData()
    fd.append('file', new File([PNG], 'logo.png', { type: 'image/png' }))
    return fd
  }
  const handlers = {
    'POST ai': () => aiRoute.POST(req('POST', { path: '/api/sites/ai', body: { instruction: 'Hazlo más oscuro' } })),
    'POST banners': () => banners.POST(req('POST', { path: '/api/sites/banners', body: { image_url: `${CDN}/7/b3.jpg` } })),
    'PUT banners': () => banners.PUT(req('PUT', { path: '/api/sites/banners', body: { id: 101, alt: 'x' } })),
    'DELETE banners': () => banners.DELETE(req('DELETE', { path: '/api/sites/banners', query: '?id=101' })),
    'PATCH banners': () => banners.PATCH(req('PATCH', { path: '/api/sites/banners', body: { order: [102, 101] } })),
    'GET domain': () => domain.GET(req('GET', { path: '/api/sites/domain' })),
    'POST domain': () => domain.POST(req('POST', { path: '/api/sites/domain', body: { domain: 'entradas.norte.cl' } })),
    'DELETE domain': () => domain.DELETE(req('DELETE', { path: '/api/sites/domain' })),
    'GET sites': () => sitesIndex.GET(req('GET')),
    'PUT sites': () => sitesIndex.PUT(req('PUT', { body: { published: false } })),
    'GET slug-check': () => slugCheck.GET(req('GET', { path: '/api/sites/slug-check', query: '?slug=nuevo-nombre' })),
    'POST upload': () => upload.POST({ request: new Request('https://aitickets.cl/api/sites/upload', { method: 'POST', body: pngForm() }), cookies: {} }),
  }

  it('sin sesión: 401 en todas, sin escribir, sin IA, sin proveedor de dominios ni Storage', async () => {
    session = null
    for (const [name, call] of Object.entries(handlers)) {
      const res = await call()
      expect(res.status, name).toBe(401)
      expect(res.headers.get('Cache-Control'), name).toBe('no-store')
    }
    expect(writes()).toEqual([])
    expect(h.siteEditCalls).toEqual([])
    expect(h.domainCalls).toEqual([])
    expect(db.uploads).toEqual([])
  })

  it('editor, finance, validator y viewer: 403 en todas, sin efectos', async () => {
    for (const role of DENIED) {
      asRole(role)
      for (const [name, call] of Object.entries(handlers)) {
        const res = await call()
        expect(res.status, `${role} ${name}`).toBe(403)
        expect((await res.json()).message).toMatch(/administradores/)
      }
    }
    expect(writes()).toEqual([])
    expect(h.siteEditCalls).toEqual([])
    expect(h.rateCalls).toEqual([])
    expect(h.domainCalls).toEqual([])
    expect(db.uploads).toEqual([])
    expect(banner(101)).toMatchObject({ alt: 'Uno', sort_order: 0 })
  })
})

// ---------------------------------------------------------------------------
// GET/PUT /api/sites
// ---------------------------------------------------------------------------
describe('GET /api/sites', () => {
  it('admin y producer ven el sitio de SU organización con sus banners y el estado de la productora', async () => {
    for (const role of OAR) {
      asRole(role)
      const res = await sitesIndex.GET(req('GET'))
      expect(res.status, role).toBe(200)
      const data = await res.json()
      expect(data.site).toMatchObject({ id: 1, slug: 'club-norte', template: 'clasico', published: true })
      expect(data.banners.map((b) => b.id)).toEqual([101, 102])
      expect(data.urls).toEqual({ free: 'https://aitickets.cl/o/club-norte', subdomain: null, custom: null })
      expect(data.domain).toMatchObject({ domain: null, status: 'none' })
      // orgEmail es el correo VERIFICADO (no organizations.email) y solo cuenta eventos publicados propios
      expect(data.org).toMatchObject({ publicName: 'Club Norte', orgEmail: 'hola@norte.cl', emailVerified: true, publishedEvents: 1, domainProvider: 'netlify' })
      expect(JSON.stringify(data)).not.toMatch(/otra-productora|entradas\.otra\.cl|Ajeno/)
    }
    expect(writes()).toEqual([])
  })

  it('organización sin sitio: se crea uno solo para ella', async () => {
    asRole('admin', 9)
    const res = await sitesIndex.GET(req('GET'))
    expect(res.status).toBe(200)
    const created = site(9)
    expect(created).toMatchObject({ organization_id: 9, slug: 'productora-nueva', published: true })
    expect((await res.json()).site.slug).toBe('productora-nueva')
    expect(writes()).toEqual([expect.objectContaining({ table: 'aitickets_sites', op: 'insert' })])
    expect(db.tables.aitickets_sites).toHaveLength(3)
  })

  it('tabla sin migrar: 503', async () => {
    db.failOn('aitickets_sites', 'select', { code: '42P01', message: 'relation "aitickets_sites" does not exist' })
    expect((await sitesIndex.GET(req('GET'))).status).toBe(503)
  })
})

describe('PUT /api/sites', () => {
  const put = (body) => sitesIndex.PUT(req('PUT', { body }))

  it('no acepta campos fuera del esquema (organization_id, id): 400 sin escribir', async () => {
    for (const body of [{ organization_id: 8, published: false }, { id: 2, slug: 'robado' }, { custom_domain: 'x.cl' }]) {
      expect((await put(body)).status).toBe(400)
    }
    expect((await sitesIndex.PUT(req('PUT', { raw: '{' }))).status).toBe(400)
    expect(writes()).toEqual([])
    expect(site(8)).toMatchObject({ slug: 'otra-productora', published: true })
  })

  it('caso feliz (admin y producer): actualiza solo el sitio de la sesión, saneando tema, contenido y SEO', async () => {
    for (const role of OAR) {
      asRole(role)
      const res = await put({
        slug: role === 'admin' ? 'Club-Norte-Oficial' : 'club-norte-2',
        template: 'musica',
        theme: { primary: '#FF0000', accent: 'rojo', logo_url: 'javascript:alert(1)', font: 'Comic Sans' },
        content: { title: '  Club Norte  ', about: '<p>Hola</p><script>alert(1)</script>', socials: { instagram: 'instagram.com/norte' } },
        seo: { title: 'Club Norte', og_image: 'http://inseguro.cl/a.jpg' },
        published: false,
      })
      expect(res.status, role).toBe(200)
      expect((await res.json()).message).toBe('Cambios guardados')
    }
    const own = site(7)
    expect(own).toMatchObject({ slug: 'club-norte-2', template: 'musica', theme: { primary: '#ff0000' }, seo: { title: 'Club Norte' }, published: false })
    expect(own.content).toMatchObject({ title: 'Club Norte', legacy_key: 'se conserva', socials: { instagram: 'https://instagram.com/norte' } })
    expect(own.content.about).not.toMatch(/script/)
    expect(site(8)).toMatchObject({ slug: 'otra-productora', template: 'nocturno', published: true })
    for (const w of writes()) {
      expect(w).toMatchObject({ table: 'aitickets_sites', op: 'update' })
      expect(w.filters).toEqual([{ col: 'id', op: 'eq', value: 1 }, { col: 'organization_id', op: 'eq', value: 7 }])
    }
  })

  it('slug reservado, inválido o plantilla no ofrecida: 400; slug ya tomado (UNIQUE): 409', async () => {
    expect((await put({ slug: 'admin' })).status).toBe(400)
    expect((await put({ slug: 'a_b' })).status).toBe(400)
    expect((await put({ template: 'inexistente' })).status).toBe(400)
    expect(writes()).toEqual([])
    db.failOn('aitickets_sites', 'update', { code: '23505', message: 'duplicate key value violates unique constraint' })
    const taken = await put({ slug: 'otra-productora' })
    expect(taken.status).toBe(409)
    expect((await taken.json()).field).toBe('slug')
    expect(site(7).slug).toBe('club-norte')
  })

  it('correo de contacto: el verificado se guarda directo; otro (incluido organizations.email sin verificar) espera confirmación', async () => {
    const direct = await put({ contact_email: 'HOLA@norte.cl' })
    expect(direct.status).toBe(200)
    expect(site(7).contact_email).toBe('hola@norte.cl')
    expect(h.contactCalls).toEqual([])

    for (const email of ['sin-verificar@norte.cl', 'otra@otra.cl']) {
      const res = await put({ contact_email: email })
      expect(res.status).toBe(200)
      expect((await res.json()).pendingContactEmail).toBe(email)
      expect(site(7).contact_email).toBe('hola@norte.cl')
    }
    expect(h.contactCalls).toEqual([
      { siteId: 1, orgId: 7, email: 'sin-verificar@norte.cl', orgName: 'Club Norte' },
      { siteId: 1, orgId: 7, email: 'otra@otra.cl', orgName: 'Club Norte' },
    ])
  })

  it('correo de contacto: inválido 400; cuenta sin verificar 403; confirmación reciente 429; vaciar lo borra', async () => {
    expect((await put({ contact_email: 'no-es-correo' })).status).toBe(400)
    db.tables.organizations[0].email_verified_at = null
    db.tables.organizations[0].email_verified_for = null
    expect((await put({ contact_email: 'nuevo@norte.cl' })).status).toBe(403)
    db.tables.organizations[0].email_verified_at = OLD
    h.contactConfirm = () => ({ ok: false })
    expect((await put({ contact_email: 'nuevo@norte.cl' })).status).toBe(429)
    expect(writes()).toEqual([])
    site(7).contact_email = 'viejo@norte.cl'
    expect((await put({ contact_email: '' })).status).toBe(200)
    expect(site(7).contact_email).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------
describe('GET /api/sites/slug-check', () => {
  const check = async (slug) => (await slugCheck.GET(req('GET', { path: '/api/sites/slug-check', query: `?slug=${encodeURIComponent(slug)}` }))).json()

  it('reservado, inválido, tomado por otra productora, el propio y uno libre', async () => {
    for (const role of OAR) {
      asRole(role)
      expect(await check('admin')).toEqual({ available: false, slug: 'admin', reason: 'reserved' })
      expect(await check('ab')).toEqual({ available: false, slug: 'ab', reason: 'invalid' })
      expect(await check('Otra-Productora')).toEqual({ available: false, slug: 'otra-productora', reason: 'taken' })
      expect(await check('club-norte')).toEqual({ available: true, slug: 'club-norte', current: true })
      expect(await check('club-sur')).toEqual({ available: true, slug: 'club-sur', current: false })
    }
    expect(writes()).toEqual([])
  })

  it('tabla sin migrar: 503', async () => {
    db.failOn('aitickets_sites', 'select', { code: 'PGRST205', message: 'schema cache' })
    expect((await slugCheck.GET(req('GET', { path: '/api/sites/slug-check', query: '?slug=club-sur' }))).status).toBe(503)
  })
})

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------
describe('/api/sites/banners', () => {
  const call = (method, opts) => banners[method](req(method, { path: '/api/sites/banners', ...opts }))

  it('POST: crea en el sitio de la sesión (site_id del body se ignora), al final, y responde solo los banners propios', async () => {
    for (const role of OAR) {
      asRole(role)
      const res = await call('POST', { body: { image_url: `${CDN}/7/${role}.jpg`, link_url: 'norte.cl/entradas', alt: 'Promo', site_id: 2, sort_order: -5 } })
      expect(res.status, role).toBe(201)
      expect((await res.json()).banners.every((b) => !String(b.image_url).includes('/8/'))).toBe(true)
    }
    const created = db.tables.aitickets_site_banners.filter((b) => ![101, 102, 201].includes(b.id))
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ site_id: 1, placement: 'hero', sort_order: 2, active: true, link_url: 'https://norte.cl/entradas', alt: 'Promo' })
    expect(created[1]).toMatchObject({ site_id: 1, sort_order: 3 })
    expect(db.tables.aitickets_site_banners.filter((b) => b.site_id === 2)).toHaveLength(1)
  })

  it('POST valida imagen https, enlace, fechas y el máximo de 10', async () => {
    expect((await call('POST', { body: { image_url: 'http://inseguro.cl/a.jpg' } })).status).toBe(400)
    expect((await call('POST', { body: { image_url: `${CDN}/7/a.jpg`, link_url: 'javascript:alert(1)' } })).status).toBe(400)
    expect((await call('POST', { body: { image_url: `${CDN}/7/a.jpg`, starts_at: '2026-12-02', ends_at: '2026-12-01' } })).status).toBe(400)
    expect((await call('POST', { body: { image_url: 123 } })).status).toBe(400)
    for (let i = 0; i < 8; i++) db.tables.aitickets_site_banners.push({ id: 300 + i, site_id: 1, image_url: `${CDN}/7/x${i}.jpg`, sort_order: 2 + i })
    const full = await call('POST', { body: { image_url: `${CDN}/7/once.jpg` } })
    expect(full.status).toBe(400)
    expect((await full.json()).message).toMatch(/hasta 10/)
    expect(writes()).toEqual([])
  })

  it('PUT: banner de otro sitio 404 sin cambios; el propio se actualiza', async () => {
    const other = await call('PUT', { body: { id: 201, alt: 'Hackeado', active: false } })
    expect(other.status).toBe(404)
    expect(banner(201)).toMatchObject({ alt: 'Ajeno', active: true })
    expect((await call('PUT', { body: { id: 'x' } })).status).toBe(400)

    const res = await call('PUT', { body: { id: 101, alt: 'Nuevo', active: false, link_url: '' } })
    expect(res.status).toBe(200)
    expect(banner(101)).toMatchObject({ alt: 'Nuevo', active: false, link_url: null, site_id: 1 })
    expect(writes().map((w) => w.filters)).toEqual([
      [{ col: 'id', op: 'eq', value: 201 }, { col: 'site_id', op: 'eq', value: 1 }],
      [{ col: 'id', op: 'eq', value: 101 }, { col: 'site_id', op: 'eq', value: 1 }],
    ])
  })

  it('DELETE: banner de otro sitio 404 y sigue ahí; el propio se elimina (por query o body)', async () => {
    expect((await call('DELETE', { query: '?id=201' })).status).toBe(404)
    expect(banner(201)).toBeDefined()
    expect((await call('DELETE', { query: '?id=abc' })).status).toBe(400)

    expect((await call('DELETE', { query: '?id=101' })).status).toBe(200)
    expect(banner(101)).toBeUndefined()
    const byBody = await call('DELETE', { body: { id: 102 } })
    expect(byBody.status).toBe(200)
    expect((await byBody.json()).banners).toEqual([])
    expect(db.tables.aitickets_site_banners.map((b) => b.id)).toEqual([201])
  })

  it('PATCH: un orden con banners ajenos o repetidos es 400 sin escribir; el propio reordena', async () => {
    expect((await call('PATCH', { body: { order: [102, 201] } })).status).toBe(400)
    expect((await call('PATCH', { body: { order: [101, 101] } })).status).toBe(400)
    expect((await call('PATCH', { body: { order: [] } })).status).toBe(400)
    expect(writes()).toEqual([])

    const res = await call('PATCH', { body: { order: [102] } })
    expect(res.status).toBe(200)
    expect(banner(102).sort_order).toBe(0)
    expect(banner(101).sort_order).toBe(1)
    expect(banner(201).sort_order).toBe(0)
    expect(writes().every((w) => w.filters.some((f) => f.col === 'site_id' && f.value === 1))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Dominio propio
// ---------------------------------------------------------------------------
describe('/api/sites/domain', () => {
  const post = (body) => domain.POST(req('POST', { path: '/api/sites/domain', body }))

  it('POST caso feliz (admin y producer): reserva el dominio para el sitio de la sesión y llama al proveedor con su slug', async () => {
    for (const role of OAR) {
      asRole(role)
      Object.assign(site(7), { custom_domain: null, domain_status: 'none', domain_verification: null })
      h.domainCalls.length = 0
      const res = await post({ domain: 'https://Entradas.Norte.cl/' })
      expect(res.status, role).toBe(200)
      const data = await res.json()
      expect(data).toMatchObject({ provider: 'netlify', domain: { domain: 'entradas.norte.cl', status: 'pending_ssl' } })
      expect(h.domainCalls).toEqual([['add', 'entradas.norte.cl', expect.objectContaining({ siteSlug: 'club-norte', token: expect.any(String) })]])
    }
    expect(site(7)).toMatchObject({ custom_domain: 'entradas.norte.cl', domain_status: 'pending_ssl', domain_provider: 'netlify' })
    expect(site(8)).toMatchObject({ custom_domain: 'entradas.otra.cl', domain_status: 'active' })
    expect(writes().every((w) => w.filters.some((f) => f.col === 'organization_id' && f.value === 7))).toBe(true)
  })

  it('POST: dominio activo de otra productora → 409; su reserva reciente sin mi TXT → 409 con instrucciones; nada cambia', async () => {
    const taken = await post({ domain: 'entradas.otra.cl' })
    expect(taken.status).toBe(409)
    expect((await taken.json()).message).toBe('Ese dominio ya está conectado a otro sitio.')

    Object.assign(site(8), { domain_status: 'pending_dns', domain_requested_at: new Date().toISOString() })
    const pending = await post({ domain: 'entradas.otra.cl' })
    expect(pending.status).toBe(409)
    expect((await pending.json()).message).toMatch(/_aitickets-verify\.entradas\.otra\.cl/)

    expect(h.domainCalls).toEqual([])
    expect(writes()).toEqual([])
    expect(site(7)).toMatchObject({ custom_domain: null, domain_status: 'none' })
    expect(site(8)).toMatchObject({ custom_domain: 'entradas.otra.cl' })
  })

  it('POST: dominio de AI Tickets, inválido o sin body 400; con otro dominio ya conectado 409', async () => {
    expect((await post({ domain: 'aitickets.cl' })).status).toBe(400)
    expect((await post({ domain: 'no es dominio' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await domain.POST(req('POST', { path: '/api/sites/domain', raw: 'x' }))).status).toBe(400)
    Object.assign(site(7), { custom_domain: 'entradas.norte.cl', domain_status: 'active' })
    expect((await post({ domain: 'otra.norte.cl' })).status).toBe(409)
    expect(h.domainCalls).toEqual([])
    expect(writes()).toEqual([])
  })

  it('GET: refresca solo el dominio del sitio de la sesión (y no más de una vez cada 8 s)', async () => {
    Object.assign(site(7), { custom_domain: 'entradas.norte.cl', domain_status: 'pending_dns', domain_requested_at: new Date().toISOString(), domain_checked_at: OLD, domain_verification: { token: 'tok-norte' } })
    h.checkDomain = (s) => ({ status: 'pending_ssl', error: null, verification: { ...s.domain_verification, attached_at: new Date().toISOString() } })
    const res = await domain.GET(req('GET', { path: '/api/sites/domain' }))
    expect(res.status).toBe(200)
    expect((await res.json()).domain).toMatchObject({ domain: 'entradas.norte.cl', status: 'pending_ssl' })
    expect(h.domainCalls).toEqual([['check', 'entradas.norte.cl']])
    expect(site(7).domain_status).toBe('pending_ssl')
    expect(site(8).domain_status).toBe('active')

    h.domainCalls.length = 0
    await domain.GET(req('GET', { path: '/api/sites/domain' }))
    expect(h.domainCalls).toEqual([])
  })

  it('GET sin dominio: none, sin llamar al proveedor', async () => {
    const res = await domain.GET(req('GET', { path: '/api/sites/domain' }))
    expect((await res.json()).domain).toEqual({ domain: null, status: 'none', records: [], error: null })
    expect(h.domainCalls).toEqual([])
    expect(writes()).toEqual([])
  })

  it('DELETE: quita el alias del dominio propio y limpia la fila; el de otra productora no se toca', async () => {
    Object.assign(site(7), { custom_domain: 'entradas.norte.cl', domain_status: 'active', domain_provider: 'netlify', domain_verification: { token: 't', attached_at: OLD } })
    const res = await domain.DELETE(req('DELETE', { path: '/api/sites/domain' }))
    expect(res.status).toBe(200)
    expect((await res.json()).domain.status).toBe('none')
    expect(h.domainCalls).toEqual([['remove', 'entradas.norte.cl']])
    expect(site(7)).toMatchObject({ custom_domain: null, domain_status: 'none', domain_verification: null })
    expect(site(8)).toMatchObject({ custom_domain: 'entradas.otra.cl', domain_status: 'active' })
    expect(writes().every((w) => w.filters.some((f) => f.col === 'organization_id' && f.value === 7))).toBe(true)
  })

  it('DELETE: si el proveedor falla queda "removing" (202); sin dominio responde none sin llamar al proveedor', async () => {
    expect((await domain.DELETE(req('DELETE', { path: '/api/sites/domain' }))).status).toBe(200)
    expect(h.domainCalls).toEqual([])
    Object.assign(site(7), { custom_domain: 'entradas.norte.cl', domain_status: 'active', domain_provider: 'netlify', domain_verification: { token: 't', attached_at: OLD } })
    h.removeFails = true
    const res = await domain.DELETE(req('DELETE', { path: '/api/sites/domain' }))
    expect(res.status).toBe(202)
    expect(site(7)).toMatchObject({ custom_domain: 'entradas.norte.cl', domain_status: 'removing' })
  })
})

// ---------------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------------
describe('POST /api/sites/ai', () => {
  const call = (body) => aiRoute.POST(req('POST', { path: '/api/sites/ai', body }))
  const draft = {
    template: 'clasico',
    theme: { primary: '#111111', logo_url: `${CDN}/7/logo.png`, hero_image_url: 'javascript:alert(1)' },
    title: 'Club Norte',
    tagline: 'Fiestas',
    about: 'Somos',
    sections: [{ id: 'hero', type: 'hero', data: { title: 'Hola', image_url: `${CDN}/7/hero.jpg` } }],
  }

  it('caso feliz (admin y producer): contexto solo con la productora y eventos publicados propios; no guarda nada', async () => {
    h.siteEdit = () => ({
      summary: 'Cambié la plantilla y agregué una galería.',
      template: 'musica',
      theme: { primary: '#FF00AA', logo_url: 'https://evil.example/logo.png' },
      title: 'Club Norte Oficial',
      tagline: '',
      about: null,
      order: ['hero', 'gallery-1'],
      sections: [{ id: 'gallery-1', type: 'gallery', hidden: false, data: { title: 'Galería', items: [{ image_url: `${CDN}/7/evento.jpg`, caption: 'Propia' }, { image_url: `${CDN}/8/ajeno.jpg`, caption: 'Ajena' }, { image_url: 'https://evil.example/x.jpg' }] } }],
    })
    for (const role of OAR) {
      asRole(role)
      const res = await call({ instruction: 'Ponle una galería y hazlo más musical', draft })
      expect(res.status, role).toBe(200)
      const { summary, changes } = await res.json()
      expect(summary).toBe('Cambié la plantilla y agregué una galería.')
      expect(changes.template).toBe('musica')
      expect(changes.title).toBe('Club Norte Oficial')
      expect(changes.tagline).toBe('')
      expect(changes.theme).toEqual({ primary: '#ff00aa', logo_url: `${CDN}/7/logo.png` })
      // Solo imágenes que ya estaban en el borrador o en eventos propios publicados
      expect(changes.sections.map((s) => s.id)).toEqual(['hero', 'gallery-1'])
      expect(changes.sections[1].data.items).toEqual([{ image_url: `${CDN}/7/evento.jpg`, caption: 'Propia' }])
    }
    const input = h.siteEditCalls[0]
    expect(input.context).toMatch(/Productora: Club Norte/)
    expect(input.context).toContain('Viernes Techno')
    expect(input.context).not.toMatch(/Ajeno|Borrador Secreto|Otra Productora/)
    expect(input.draft.theme).toEqual({ primary: '#111111', logo_url: `${CDN}/7/logo.png` })
    expect(h.rateCalls[0]).toEqual(['dash:siteai', 'org:7', expect.objectContaining({ windowSeconds: 86400, max: 60 })])
    expect(writes()).toEqual([])
  })

  it('editar una sección: solo cambian las secciones', async () => {
    h.siteEdit = () => ({ summary: 'ok', template: 'nocturno', title: 'Otro', order: [], sections: [{ id: 'hero', type: 'hero', data: { title: 'Bienvenidos' } }] })
    const res = await call({ instruction: 'Cambia el título del inicio', draft, section_id: 'hero' })
    const { changes } = await res.json()
    expect(Object.keys(changes)).toEqual(['sections'])
    expect(changes.sections[0].data.title).toBe('Bienvenidos')
    expect(h.siteEditCalls[0].sectionId).toBe('hero')
  })

  it('sin IA configurada 501; instrucción vacía 400; límite diario 429; todo sin llamar a la IA', async () => {
    expect((await call({ instruction: 'ok' })).status).toBe(400)
    h.rateAllowed = false
    expect((await call({ instruction: 'Hazlo más oscuro' })).status).toBe(429)
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect((await call({ instruction: 'Hazlo más oscuro' })).status).toBe(501)
    expect(h.siteEditCalls).toEqual([])
  })

  it('la IA se niega: 422; la IA falla: 502', async () => {
    h.siteEdit = () => { throw new AiRefusalError('no') }
    expect((await call({ instruction: 'Hazlo más oscuro' })).status).toBe(422)
    h.siteEdit = () => { throw new Error('timeout') }
    expect((await call({ instruction: 'Hazlo más oscuro' })).status).toBe(502)
  })
})

// ---------------------------------------------------------------------------
// Subida de imágenes
// ---------------------------------------------------------------------------
describe('POST /api/sites/upload', () => {
  const call = (file, kind) => {
    const fd = new FormData()
    if (file) fd.append('file', file)
    if (kind) fd.append('kind', kind)
    return upload.POST({ request: new Request('https://aitickets.cl/api/sites/upload', { method: 'POST', body: fd }), cookies: {} })
  }

  it('caso feliz (admin y producer): optimiza y guarda en sites/<org de la sesión>/<tipo>', async () => {
    for (const role of OAR) {
      asRole(role)
      const res = await call(new File([PNG], 'logo.png', { type: 'image/png' }), 'logo')
      expect(res.status, role).toBe(200)
      const { url } = await res.json()
      const up = db.uploads.at(-1)
      expect(up.path).toMatch(/^sites\/7\/logo-/)
      expect(up.bucket).toBe('Events')
      expect(url).toBe(`https://proj.supabase.co/storage/v1/object/public/Events/${up.path}`)
    }
    await call(new File([PNG], 'x.png', { type: 'image/png' }), '../../8/logo')
    expect(db.uploads.at(-1).path).toMatch(/^sites\/7\/banner-/)
  })

  it('sin archivo, tipo no permitido, bytes que no son imagen o más de 5 MB: 400 sin subir', async () => {
    expect((await call(null)).status).toBe(400)
    expect((await call(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).status).toBe(400)
    expect((await call(new File(['<svg/>'], 'x.png', { type: 'image/png' }))).status).toBe(400)
    expect((await call(new File([Buffer.alloc(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))).status).toBe(400)
    expect(db.uploads).toEqual([])
  })
})

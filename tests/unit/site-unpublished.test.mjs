// Sitio de productor que existe pero no está publicado (oculto por el productor, sin publicar o con el correo de la
// organización sin verificar): en su dominio propio (src/middleware.ts) y en /o/<slug> (src/pages/o/_site.ts) se
// avisa "no publicado por ahora" (503) en vez del 404 "El sitio o la página que buscas no existe", que parecía un
// dominio roto. Un host o slug desconocido sigue siendo 404. BD falsa en memoria (sin red).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db

vi.mock('astro:middleware', () => ({ defineMiddleware: (fn) => fn }))
vi.mock('../../src/lib/auth-helpers', () => ({
  getSupabaseAdmin: () => db,
  createEphemeralAuthClient: () => ({ auth: { refreshSession: async () => ({ data: null, error: new Error('sin sesión') }) } }),
  getFriendlyErrorMessage: (e) => String(e?.message || e),
}))
vi.mock('../../src/lib/cdnCache', () => ({ purgeEventPages: async () => {} }))

const { onRequest } = await import('../../src/middleware.ts')
const { invalidateSiteCache, resolveSiteByHost } = await import('../../src/lib/sites.ts')
const { siteUnavailableCopy, siteUnavailableResponse } = await import('../../src/lib/siteUnavailable.ts')
const { siteMissingResponse } = await import('../../src/pages/o/_site.ts')

const ORG = { id: 53, public_name: 'CIAD Chile', email: 'ciad@ejemplo.cl', email_verified_at: '2026-11-22T01:47:53Z', email_verified_for: 'ciad@ejemplo.cl' }
const SITE = {
  id: 41,
  organization_id: 53,
  slug: 'ciadchile-cl',
  template: 'clasico',
  theme: {},
  content: {},
  seo: {},
  contact_email: null,
  contact_form_enabled: true,
  published: false,
  published_at: '2026-11-22T01:48:21Z',
  custom_domain: 'ciadchile.cl',
  domain_status: 'active',
}

function seed({ site = {}, org = {} } = {}) {
  db = createFakeSupabase({ tables: { organizations: [{ ...ORG, ...org }], aitickets_sites: [{ ...SITE, ...site }] } })
}

function context(href) {
  const url = new URL(href)
  return {
    isPrerendered: false,
    request: new Request(url),
    url,
    locals: {},
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    redirect: (location, status) => new Response(null, { status, headers: { location } }),
    rewrite: vi.fn(async (target) => new Response(`reescrita a ${new URL(target).pathname}`)),
  }
}

async function visit(href) {
  const ctx = context(href)
  const next = vi.fn(async () => new Response('siguiente'))
  const res = await onRequest(ctx, next)
  return { res, ctx, next, body: await res.text() }
}

beforeEach(() => {
  invalidateSiteCache()
  seed()
})

describe('dominio propio de un sitio no publicado', () => {
  it('avisa que el dominio está conectado pero el sitio no está publicado por ahora (503, sin servir el sitio)', async () => {
    const { res, ctx, next, body } = await visit('https://ciadchile.cl/')
    expect(res.status).toBe(503)
    expect(body).toContain('Este sitio no está publicado por ahora')
    expect(body).toContain('El dominio está conectado a AI Tickets')
    expect(body).toContain('Puede estar en mantenimiento')
    expect(body).not.toContain('Página no encontrada')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('netlify-cdn-cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(res.headers.get('retry-after')).toBe('3600')
    expect(ctx.rewrite).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('también en las rutas de evento y en la reescritura del Edge (/o/_host/...)', async () => {
    for (const path of ['/eventos/encuentro-de-danza', '/contacto', '/o/_host', '/o/_host/eventos/x', '/cualquier-cosa']) {
      const { res, body } = await visit(`https://ciadchile.cl${path}`)
      expect(res.status, path).toBe(503)
      expect(body, path).toContain('no está publicado por ahora')
    }
  })

  it('las APIs permitidas en el host responden el mismo aviso en JSON', async () => {
    const { res, body } = await visit('https://ciadchile.cl/api/sites/contact')
    expect(res.status).toBe(503)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(body)).toEqual({ error: 'Este sitio no está publicado por ahora', code: 'site_unpublished' })
  })

  it('las rutas del panel siguen llevando a aitickets.cl (el productor puede ir a publicarlo)', async () => {
    const { res } = await visit('https://ciadchile.cl/dashboard/sitio')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://aitickets.cl/dashboard/sitio')
  })

  it('una organización sin correo verificado también ve el aviso (el sitio existe pero no es público)', async () => {
    seed({ site: { published: true }, org: { email_verified_at: null } })
    const { res, body } = await visit('https://ciadchile.cl/')
    expect(res.status).toBe(503)
    expect(body).toContain('no está publicado por ahora')
  })

  it('publicado: se sirve el sitio como siempre', async () => {
    seed({ site: { published: true } })
    const { res, ctx, body } = await visit('https://ciadchile.cl/')
    expect(res.status).toBe(200)
    expect(ctx.rewrite).toHaveBeenCalledTimes(1)
    expect(body).toBe('reescrita a /o/ciadchile-cl')
    expect(ctx.locals.site?.slug).toBe('ciadchile-cl')
  })

  it('un dominio que no terminó de conectarse (sin verificar) o desconocido sigue siendo 404 sin datos del sitio', async () => {
    seed({ site: { domain_status: 'pending_dns' } })
    const pending = await visit('https://ciadchile.cl/')
    expect(pending.res.status).toBe(404)
    expect(pending.body).toContain('Página no encontrada')

    const unknown = await visit('https://otro-dominio.cl/')
    expect(unknown.res.status).toBe(404)
    expect(unknown.body).not.toContain('no está publicado')
  })
})

describe('resolveSiteByHost', () => {
  it('por defecto solo devuelve sitios públicos; includeUnpublished también el oculto', async () => {
    expect(await resolveSiteByHost('ciadchile.cl')).toBeNull()
    const hidden = await resolveSiteByHost('ciadchile.cl', { includeUnpublished: true })
    expect(hidden?.slug).toBe('ciadchile-cl')
    expect(hidden?.published).toBe(false)
    expect(await resolveSiteByHost('otro-dominio.cl', { includeUnpublished: true })).toBeNull()
  })
})

describe('/o/<slug> de un sitio oculto (aitickets.cl)', () => {
  const astro = (slug, locals = {}) => ({ params: { site: slug }, locals })

  it('avisa "no publicado por ahora" sin mencionar un dominio conectado', async () => {
    const res = await siteMissingResponse(astro('ciadchile-cl'))
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).toContain('Este sitio no está publicado por ahora')
    expect(body).not.toContain('El dominio está conectado')
  })

  it('un slug inexistente sigue siendo 404', async () => {
    const res = await siteMissingResponse(astro('no-existe'))
    expect(res.status).toBe(404)
  })

  it('en un host de tenant (sitio ya resuelto por el middleware) un null es una ruta de otro sitio: 404', async () => {
    const res = await siteMissingResponse(astro('ciadchile-cl', { site: { ...SITE, published: true } }))
    expect(res.status).toBe(404)
  })
})

describe('siteUnavailableResponse', () => {
  it('enlaza a los eventos y al panel del origen principal, y escapa el HTML', async () => {
    const res = siteUnavailableResponse({ origin: 'https://staging.example.org/' })
    const body = await res.text()
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(body).toContain('href="https://staging.example.org/eventos"')
    expect(body).toContain('href="https://staging.example.org/dashboard/sitio"')
    expect(body).toContain('Mi sitio web</a> → Publicar sitio')
    expect(body).toContain('<meta name="robots" content="noindex">')
  })

  it('el texto del host de tenant aclara que el dominio está conectado', () => {
    expect(siteUnavailableCopy(true).body).toMatch(/^El dominio está conectado a AI Tickets/)
    expect(siteUnavailableCopy(false).body).not.toMatch(/dominio/)
  })
})

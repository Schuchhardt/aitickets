// Sitios de productores (src/lib/sites.ts) y resolución de host (Edge Function netlify/tenant-router).
// Solo lógica pura: ningún caso toca la BD (getSiteBySlug('demo') no consulta Supabase).
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEMO_SITE,
  RESERVED_SLUGS,
  SLUG_RE,
  getSiteBySlug,
  getTrustedTenantProxy,
  isMainHost,
  isSitePublic,
  isUnderRootDomain,
  isValidSlug,
  normalizeHost,
  purchaseUrlFor,
  resolveSiteByHost,
  siteBasePath,
  siteCanonicalOrigin,
  siteUrl,
  slugify,
} from '../../src/lib/sites.ts'
import tenantRouter from '../../netlify/tenant-router/tenant-router.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('slugify', () => {
  it('quita tildes, eñes y símbolos', () => {
    expect(slugify('Producciones Ñandú SpA')).toBe('producciones-nandu-spa')
    expect(slugify('  Teatro   del  Puente!! ')).toBe('teatro-del-puente')
    expect(slugify('Café & Música / 2026')).toBe('cafe-musica-2026')
  })

  it('corta en 40 caracteres sin dejar guiones al borde', () => {
    const s = slugify('La Gran Productora de Espectáculos Culturales del Sur de Chile Limitada')
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s).not.toMatch(/^-|-$/)
  })

  it('entradas vacías o sin letras', () => {
    expect(slugify('')).toBe('')
    expect(slugify(undefined)).toBe('')
    expect(slugify('!!!')).toBe('')
  })
})

describe('isValidSlug y slugs reservados', () => {
  it('acepta slugs normales', () => {
    expect(isValidSlug('teatro-del-puente')).toBe(true)
    expect(isValidSlug('abc')).toBe(true)
  })

  it('rechaza formato inválido (largo, mayúsculas, guiones al borde, 1-2 caracteres)', () => {
    for (const bad of ['ab', 'a', '-abc', 'abc-', 'Teatro', 'teatro_puente', 'a'.repeat(41), 'con espacio']) {
      expect(isValidSlug(bad)).toBe(false)
    }
  })

  it('rechaza todos los slugs reservados de las enmiendas', () => {
    const required = ['demo', 'admin', 'o', 'api', 'www', 'app', 'dashboard', 'eventos', 'organizadores', 'precios',
      'comparar', 'web-gratis', 'bot', 'outreach', 'static', 'assets', 'mail', 'soporte', 'ayuda']
    for (const slug of required) {
      expect(RESERVED_SLUGS).toContain(slug)
      expect(isValidSlug(slug)).toBe(false)
    }
  })

  it('RESERVED_SLUGS y SLUG_RE coinciden con los CHECK de la migración de sitios', () => {
    const sql = readFileSync('db/migrations/202609270200_sites.sql', 'utf8')
    const check = /aitickets_sites_slug_reserved CHECK \(slug <> ALL \(ARRAY\[([\s\S]*?)\]/.exec(sql)
    expect(check).not.toBeNull()
    const sqlReserved = [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect([...sqlReserved].sort()).toEqual([...RESERVED_SLUGS].sort())
    expect(sql).toContain(`slug ~ '${SLUG_RE.source}'`)
  })

  it('slugify + fallback siempre produce un slug válido (misma regla que el backfill org-<id>)', () => {
    for (const [name, id] of [['Demo', 7], ['Ñ', 8], ['API', 9], ['Teatro Municipal de Ñuñoa', 10]]) {
      let s = slugify(name)
      if (!isValidSlug(s)) s = `org-${id}`
      expect(isValidSlug(s)).toBe(true)
    }
  })
})

describe('hosts', () => {
  it('normalizeHost quita puerto, punto final y mayúsculas', () => {
    expect(normalizeHost('Entradas.Productora.CL:443')).toBe('entradas.productora.cl')
    expect(normalizeHost('productora.cl.')).toBe('productora.cl')
    expect(normalizeHost('a.cl, b.cl')).toBe('a.cl')
    expect(normalizeHost('[::1]:4321')).toBe('[::1]')
    expect(normalizeHost(null)).toBe('')
  })

  it('isMainHost: aitickets.cl, www, localhost y *.netlify.app son la app principal', () => {
    for (const h of ['aitickets.cl', 'www.aitickets.cl', 'AITICKETS.CL:443', 'localhost:4321', '127.0.0.1', 'deploy-preview-12--aitickets.netlify.app', '', null]) {
      expect(isMainHost(h)).toBe(true)
    }
    for (const h of ['productora.cl', 'entradas.productora.cl', 'teatro.aitickets.cl', 'aitickets.cl.evil.com']) {
      expect(isMainHost(h)).toBe(false)
    }
  })

  it('isMainHost respeta MAIN_HOSTS y el host de SITE_URL', () => {
    expect(isMainHost('staging.example.org')).toBe(false)
    vi.stubEnv('MAIN_HOSTS', 'staging.example.org, otra.example.org:8080')
    expect(isMainHost('staging.example.org')).toBe(true)
    expect(isMainHost('otra.example.org')).toBe(true)
    vi.stubEnv('SITE_URL', 'https://beta.example.net')
    expect(isMainHost('beta.example.net')).toBe(true)
  })

  it('isUnderRootDomain', () => {
    expect(isUnderRootDomain('teatro.aitickets.cl')).toBe(true)
    expect(isUnderRootDomain('aitickets.cl')).toBe(true)
    expect(isUnderRootDomain('productora.cl')).toBe(false)
    expect(isUnderRootDomain('evilaitickets.cl')).toBe(false)
  })

  it('resolveSiteByHost devuelve null para hosts principales y subdominios sin wildcard (sin consultar la BD)', async () => {
    expect(await resolveSiteByHost('aitickets.cl')).toBeNull()
    expect(await resolveSiteByHost('localhost:4321')).toBeNull()
    expect(await resolveSiteByHost('teatro.aitickets.cl')).toBeNull()
    expect(await resolveSiteByHost('a.b.aitickets.cl')).toBeNull()
  })

  it('con wildcard habilitado, demo.aitickets.cl resuelve al sitio demo', async () => {
    vi.stubEnv('SITES_WILDCARD_ENABLED', 'true')
    expect(await resolveSiteByHost('demo.aitickets.cl')).toBe(DEMO_SITE)
  })
})

describe('proxy de tenants (x-tenant-host)', () => {
  const req = (headers) => new Request('https://aitickets.cl/o/_host/', { headers })

  it('ignora los headers si no hay TENANT_PROXY_SECRET', () => {
    expect(getTrustedTenantProxy(req({ 'x-tenant-host': 'productora.cl', 'x-tenant-proxy-secret': 'x' }))).toBeNull()
  })

  it('ignora los headers si el secreto no coincide', () => {
    vi.stubEnv('TENANT_PROXY_SECRET', 'secreto-correcto')
    expect(getTrustedTenantProxy(req({ 'x-tenant-host': 'productora.cl', 'x-tenant-proxy-secret': 'secreto-incorrecto' }))).toBeNull()
    expect(getTrustedTenantProxy(req({ 'x-tenant-host': 'productora.cl' }))).toBeNull()
  })

  it('confía en el host y la IP cuando el secreto coincide', () => {
    vi.stubEnv('TENANT_PROXY_SECRET', 'secreto-correcto')
    expect(
      getTrustedTenantProxy(req({ 'x-tenant-host': 'Productora.CL:443', 'x-tenant-proxy-secret': 'secreto-correcto', 'x-tenant-client-ip': '1.2.3.4, 5.6.7.8' }))
    ).toEqual({ host: 'productora.cl', clientIp: '1.2.3.4' })
  })
})

describe('URLs del sitio', () => {
  const base = { slug: 'teatro-del-puente', custom_domain: null, domain_status: 'none' }

  it('canónico: /o/<slug> en aitickets.cl si no hay dominio propio activo', () => {
    expect(siteCanonicalOrigin(base)).toBe('https://aitickets.cl/o/teatro-del-puente')
    expect(siteCanonicalOrigin({ ...base, custom_domain: 'entradas.teatro.cl', domain_status: 'pending_dns' })).toBe('https://aitickets.cl/o/teatro-del-puente')
  })

  it('canónico: dominio propio cuando está activo', () => {
    expect(siteCanonicalOrigin({ ...base, custom_domain: 'entradas.teatro.cl', domain_status: 'active' })).toBe('https://entradas.teatro.cl')
  })

  it('canónico respeta SITE_URL', () => {
    vi.stubEnv('SITE_URL', 'http://localhost:4321/')
    expect(siteCanonicalOrigin(base)).toBe('http://localhost:4321/o/teatro-del-puente')
  })

  it('siteUrl arma rutas', () => {
    expect(siteUrl(base)).toBe('https://aitickets.cl/o/teatro-del-puente')
    expect(siteUrl(base, '/contacto')).toBe('https://aitickets.cl/o/teatro-del-puente/contacto')
    expect(siteUrl({ ...base, custom_domain: 'teatro.cl', domain_status: 'active' }, 'contacto')).toBe('https://teatro.cl/contacto')
  })

  it('siteBasePath: "" en host de tenant y /o/<slug> en aitickets.cl', () => {
    expect(siteBasePath(base, 'entradas.teatro.cl')).toBe('')
    expect(siteBasePath(base, 'aitickets.cl')).toBe('/o/teatro-del-puente')
    expect(siteBasePath(base, null)).toBe('/o/teatro-del-puente')
  })

  it('purchaseUrlFor lleva al checkout en aitickets.cl con ?comprar=1', () => {
    expect(purchaseUrlFor(base, 'obra uno')).toBe('https://aitickets.cl/o/teatro-del-puente/eventos/obra%20uno?comprar=1')
  })
})

describe('publicación', () => {
  it('el sitio demo es público y se obtiene sin BD', async () => {
    expect(await getSiteBySlug('demo')).toBe(DEMO_SITE)
    expect(await getSiteBySlug('DEMO')).toBe(DEMO_SITE)
    expect(isSitePublic(DEMO_SITE)).toBe(true)
  })

  it('slugs inválidos no consultan la BD', async () => {
    expect(await getSiteBySlug('A B')).toBeNull()
    expect(await getSiteBySlug('')).toBeNull()
  })

  it('isSitePublic exige published y correo de la organización verificado', () => {
    const site = { ...DEMO_SITE, is_demo: false, published: true, org: { ...DEMO_SITE.org, email_verified: true } }
    expect(isSitePublic(site)).toBe(true)
    expect(isSitePublic({ ...site, published: false })).toBe(false)
    expect(isSitePublic({ ...site, org: { ...site.org, email_verified: false } })).toBe(false)
    expect(isSitePublic({ ...site, org: null })).toBe(false)
    expect(isSitePublic(null)).toBe(false)
  })
})

describe('Edge Function tenant-router', () => {
  const run = (url) => tenantRouter(new Request(url))

  it('no toca aitickets.cl, www, localhost ni previews de Netlify', async () => {
    for (const url of ['https://aitickets.cl/', 'https://www.aitickets.cl/eventos/x', 'http://localhost:8888/', 'https://deploy-preview-3--aitickets.netlify.app/']) {
      expect(await run(url)).toBeUndefined()
    }
  })

  it('reescribe un dominio propio a /o/_host/<ruta> conservando la query', async () => {
    expect(String(await run('https://entradas.teatro.cl/'))).toBe('https://entradas.teatro.cl/o/_host')
    expect(String(await run('https://entradas.teatro.cl/eventos/obra?ref=ig'))).toBe('https://entradas.teatro.cl/o/_host/eventos/obra?ref=ig')
    expect(String(await run('https://entradas.teatro.cl/robots.txt'))).toBe('https://entradas.teatro.cl/o/_host/robots.txt')
  })

  it('no reescribe dos veces ni toca assets o APIs', async () => {
    for (const path of ['/o/_host/eventos/x', '/_astro/app.js', '/api/sites/contact', '/.netlify/functions/x', '/favicon.ico']) {
      expect(await run(`https://entradas.teatro.cl${path}`)).toBeUndefined()
    }
  })

  it('usa SITES_ROOT_DOMAIN y MAIN_HOSTS de Netlify.env', async () => {
    vi.stubGlobal('Netlify', { env: { get: (k) => ({ MAIN_HOSTS: 'staging.example.org' })[k] } })
    expect(await run('https://staging.example.org/')).toBeUndefined()
  })
})

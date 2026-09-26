// Dominios propios de productores (netlify/lib/domains/validate.mjs) y utilidades de dominios/correos
// del outreach (netlify/lib/outreach/domains.mjs, enrich.mjs, sources/inbound.mjs). Sin red ni DNS.
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  NETLIFY_APEX_IP,
  cnameTargetFor,
  dnsRecordsFor,
  domainVerifyToken,
  verificationTxtHost,
  verificationTxtValue,
  isApexDomain,
  maxNetlifyAliases,
  normalizeDomainInput,
  registrableDomain,
} from '../../netlify/lib/domains/validate.mjs'
import * as leadDomains from '../../netlify/lib/outreach/domains.mjs'
import { extractEmails, isAllowedByRobots, parseRobots, pickBestEmail } from '../../netlify/lib/outreach/enrich.mjs'
import { csvRowToCandidate, parseCsv } from '../../netlify/lib/outreach/sources/inbound.mjs'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normalizeDomainInput', () => {
  it('normaliza lo que escribe el productor', () => {
    expect(normalizeDomainInput('https://Entradas.TuProductora.cl/eventos?x=1')).toEqual({ ok: true, hostname: 'entradas.tuproductora.cl', apex: false })
    expect(normalizeDomainInput('  productora.cl.  ')).toEqual({ ok: true, hostname: 'productora.cl', apex: true })
    expect(normalizeDomainInput('entradas.productora.cl:8443')).toMatchObject({ ok: true, hostname: 'entradas.productora.cl' })
  })

  it('convierte dominios con tilde/eñe a punycode', () => {
    const res = normalizeDomainInput('entradas.ñandú.cl')
    expect(res.ok).toBe(true)
    expect(res.hostname).toMatch(/^entradas\.xn--/)
  })

  it('rechaza dominios de AI Tickets y sus subdominios', () => {
    for (const d of ['aitickets.cl', 'www.aitickets.cl', 'teatro.aitickets.cl', 'https://AITICKETS.CL']) {
      expect(normalizeDomainInput(d).ok, d).toBe(false)
    }
  })

  it('respeta SITES_ROOT_DOMAIN', () => {
    vi.stubEnv('SITES_ROOT_DOMAIN', 'sitios.example.org')
    expect(normalizeDomainInput('teatro.sitios.example.org').ok).toBe(false)
  })

  it('rechaza plataformas, IPs, comodines y entradas inválidas', () => {
    const bad = [
      '', '   ', 'productora', 'mi productora.cl', 'ana@productora.cl', '192.168.0.1', '[::1]', '*.productora.cl',
      'productora.netlify.app', 'x.vercel.app', 'x.pages.dev', 'localhost', 'example.com', 'com.ar',
      '-productora.cl', 'productora-.cl', 'productora.c', 'a'.repeat(301),
    ]
    for (const d of bad) {
      const res = normalizeDomainInput(d)
      expect(res.ok, d).toBe(false)
      expect(typeof res.error).toBe('string')
    }
  })

  it('los mensajes de error están en español', () => {
    expect(normalizeDomainInput('').error).toMatch(/Escribe tu dominio/)
    expect(normalizeDomainInput('aitickets.cl').error).toMatch(/pertenece a AI Tickets/)
  })
})

describe('TXT de propiedad del dominio', () => {
  it('token determinístico por sitio y dominio, distinto entre sitios', () => {
    const a = domainVerifyToken(1, 'entradas.productora.cl')
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(domainVerifyToken(1, 'ENTRADAS.productora.cl')).toBe(a)
    expect(domainVerifyToken(2, 'entradas.productora.cl')).not.toBe(a)
    expect(domainVerifyToken(1, 'www.productora.cl')).not.toBe(a)
  })

  it('con token se agrega el registro TXT (subdominio y apex)', () => {
    const recs = dnsRecordsFor('entradas.productora.cl', 'netlify', 'abc')
    expect(recs).toHaveLength(2)
    expect(recs[1]).toMatchObject({ type: 'TXT', name: '_aitickets-verify.entradas', value: 'aitickets-verify=abc', host: '_aitickets-verify.entradas.productora.cl' })
    const apex = dnsRecordsFor('productora.cl', 'netlify', 'abc')
    expect(apex[1]).toMatchObject({ type: 'TXT', name: '_aitickets-verify', host: verificationTxtHost('productora.cl'), value: verificationTxtValue('abc') })
  })
})

describe('registros DNS', () => {
  it('subdominio → CNAME a aitickets.netlify.app', () => {
    expect(dnsRecordsFor('entradas.productora.cl')).toEqual([{ type: 'CNAME', name: 'entradas', value: 'aitickets.netlify.app', host: 'entradas.productora.cl' }])
    expect(dnsRecordsFor('www.productora.com.ar')[0]).toMatchObject({ type: 'CNAME', name: 'www' })
  })

  it('apex → registro A a la IP del balanceador de Netlify', () => {
    const [rec] = dnsRecordsFor('productora.cl')
    expect(rec).toMatchObject({ type: 'A', name: '@', value: NETLIFY_APEX_IP })
    expect(NETLIFY_APEX_IP).toBe('75.2.60.5')
  })

  it('SITES_CNAME_TARGET sobrescribe el destino; cloudflare usa sites.<raíz>', () => {
    expect(cnameTargetFor('cloudflare')).toBe('sites.aitickets.cl')
    vi.stubEnv('SITES_CNAME_TARGET', 'Proxy.Example.org.')
    expect(cnameTargetFor('netlify')).toBe('proxy.example.org')
  })

  it('registrableDomain e isApexDomain con sufijos de segundo nivel', () => {
    expect(registrableDomain('entradas.productora.cl')).toBe('productora.cl')
    expect(registrableDomain('x.gam.com.ar')).toBe('gam.com.ar')
    expect(isApexDomain('productora.cl')).toBe(true)
    expect(isApexDomain('gam.com.ar')).toBe(true)
    expect(isApexDomain('www.productora.cl')).toBe(false)
  })

  it('maxNetlifyAliases: 50 por defecto, máximo 100', () => {
    expect(maxNetlifyAliases()).toBe(50)
    vi.stubEnv('SITES_MAX_NETLIFY_ALIASES', '500')
    expect(maxNetlifyAliases()).toBe(100)
    vi.stubEnv('SITES_MAX_NETLIFY_ALIASES', 'x')
    expect(maxNetlifyAliases()).toBe(50)
  })
})

describe('dominios del outreach', () => {
  it('leadDomainFor: NULL para correo gratuito, nunca gmail.com como clave de organización', () => {
    expect(leadDomains.leadDomainFor({ email: 'productora@gmail.com' })).toBeNull()
    expect(leadDomains.leadDomainFor({ website: 'https://www.instagram.com/productora', email: 'x@hotmail.com' })).toBeNull()
    expect(leadDomains.leadDomainFor({ website: 'https://www.teatro.cl/contacto', email: 'x@gmail.com' })).toBe('teatro.cl')
    expect(leadDomains.leadDomainFor({ email: 'Ventas@Productora.CL' })).toBe('productora.cl')
  })

  it('ticketeras y redes sociales no son sitios propios', () => {
    expect(leadDomains.ticketingPlatformOf('https://www.passline.com/eventos/x')).toBe('passline')
    expect(leadDomains.isOwnedSiteUrl('https://www.passline.com/eventos/x')).toBe(false)
    expect(leadDomains.isOwnedSiteUrl('https://linktr.ee/productora')).toBe(false)
    expect(leadDomains.isOwnedSiteUrl('https://teatrocamino.cl')).toBe(true)
  })

  it('normalizeEmail, casillas de rol y casillas bloqueadas', () => {
    expect(leadDomains.normalizeEmail(' Ana@Teatro.CL ')).toBe('ana@teatro.cl')
    expect(leadDomains.normalizeEmail('no-es-email')).toBe('')
    expect(leadDomains.isRoleAddress('contacto@teatro.cl')).toBe(true)
    expect(leadDomains.isRoleAddress('ana.perez@teatro.cl')).toBe(false)
    expect(leadDomains.isBlockedLocalPart('no-reply@teatro.cl')).toBe(true)
    expect(leadDomains.isBlockedLocalPart('privacidad@teatro.cl')).toBe(true)
  })

  it('dominios de gobierno y educación', () => {
    expect(leadDomains.isGovernmentOrEducationDomain('cultura.gob.cl')).toBe(true)
    expect(leadDomains.isGovernmentOrEducationDomain('uchile.cl')).toBe(true)
    expect(leadDomains.isGovernmentOrEducationDomain('teatro.cl')).toBe(false)
  })
})

describe('enriquecimiento (sin red)', () => {
  it('robots.txt: respeta Disallow para AITicketsBot o *', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /privado\n\nUser-agent: OtroBot\nDisallow: /')
    expect(isAllowedByRobots(rules, '/contacto')).toBe(true)
    expect(isAllowedByRobots(rules, '/privado/x')).toBe(false)
    const specific = parseRobots('User-agent: AITicketsBot\nDisallow: /\n\nUser-agent: *\nAllow: /')
    expect(isAllowedByRobots(specific, '/contacto')).toBe(false)
  })

  it('extractEmails: mailto, texto ofuscado, ignora imágenes y no-reply', () => {
    const html = '<a href="mailto:Contacto@Teatro.cl?subject=hola">Escríbenos</a> ventas [at] teatro [dot] cl <img src="logo@2x.png"> no-reply@teatro.cl'
    const emails = extractEmails(html).map((e) => e.email).sort()
    expect(emails).toEqual(['contacto@teatro.cl', 'ventas@teatro.cl'])
  })

  it('pickBestEmail prefiere una casilla de rol del mismo dominio y descarta agencias', () => {
    const best = pickBestEmail(
      [
        { email: 'webmaster@agencia.cl', viaMailto: true },
        { email: 'ana@teatro.cl', viaMailto: false },
        { email: 'contacto@teatro.cl', viaMailto: true },
      ],
      'teatro.cl'
    )
    expect(best).toMatchObject({ email: 'contacto@teatro.cl', emailType: 'role' })
    expect(pickBestEmail([{ email: 'dev@agencia.cl', viaMailto: true }], 'teatro.cl')).toBeNull()
  })
})

describe('importación CSV', () => {
  it('parseCsv soporta comillas, comas y ; dentro de campos y BOM', () => {
    const rows = parseCsv('﻿org_name,website,source_url\r\n"Teatro ""Camino""",teatrocamino.cl,https://chilecultura.gob.cl/e/1\n\n')
    expect(rows).toEqual([{ org_name: 'Teatro "Camino"', website: 'teatrocamino.cl', source_url: 'https://chilecultura.gob.cl/e/1' }])
  })

  it('csvRowToCandidate exige source_url y sitio propio', () => {
    expect(csvRowToCandidate({ org_name: 'X', website: 'x.cl', source_url: '' }).error).toMatch(/source_url/)
    expect(csvRowToCandidate({ org_name: 'X', website: 'https://instagram.com/x', source_url: 'https://a.cl' }).error).toMatch(/website/)
    const { candidate } = csvRowToCandidate({ org_name: 'Teatro', website: 'www.teatro.cl', source_url: 'https://a.cl/e', email: 'Contacto@Teatro.cl', country: 'c1' })
    expect(candidate).toMatchObject({ website: 'https://www.teatro.cl', domain: 'teatro.cl', email: 'contacto@teatro.cl', country: 'CL', upcoming_event: null })
  })
})

// ---------------------------------------------------------------------------
// removeSiteDomain: solo quita alias que agregó AI Tickets
// ---------------------------------------------------------------------------
describe('removeSiteDomain solo quita alias propios', () => {
  const ENV_KEYS = ['DOMAIN_PROVIDER', 'NETLIFY_AUTH_TOKEN', 'NETLIFY_SITE_ID', 'SLACK_WEBHOOK_URL']
  const saved = {}
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.unstubAllGlobals()
  })

  function fakeSupabase(rowRef) {
    const chain = {
      _patch: null,
      update(patch) {
        this._patch = patch
        return this
      },
      eq() {
        return this
      },
      select() {
        return this
      },
      async maybeSingle() {
        rowRef.current = { ...rowRef.current, ...this._patch }
        return { data: rowRef.current, error: null }
      },
    }
    return { from: () => ({ ...chain }) }
  }

  async function run(site) {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    process.env.DOMAIN_PROVIDER = 'netlify'
    process.env.NETLIFY_AUTH_TOKEN = 'test-token'
    process.env.NETLIFY_SITE_ID = 'site-123'
    delete process.env.SLACK_WEBHOOK_URL
    const calls = []
    let aliases = ['aitickets.com', 'entradas.productora.cl']
    vi.stubGlobal('fetch', async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: init.body })
      if (init.method === 'PATCH') aliases = JSON.parse(init.body).domain_aliases
      return new Response(JSON.stringify({ domain_aliases: aliases, custom_domain: 'aitickets.cl' }), { status: 200 })
    })
    const { removeSiteDomain } = await import('../../netlify/lib/domains/index.mjs')
    const rowRef = { current: { ...site } }
    const res = await removeSiteDomain(fakeSupabase(rowRef), site)
    return { res, calls, row: rowRef.current }
  }

  const base = { id: 7, organization_id: 3, slug: 'prod', domain_provider: 'netlify' }

  it('pending_dns (sin alias agregado): limpia la fila sin tocar Netlify', async () => {
    const { res, calls, row } = await run({
      ...base,
      custom_domain: 'aitickets.com',
      domain_status: 'pending_dns',
      domain_verification: { token: 't' },
    })
    expect(res.ok).toBe(true)
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
    expect(row.custom_domain).toBeNull()
    expect(row.domain_status).toBe('none')
  })

  it('alias que ya existía antes (alias_preexisting): no se quita', async () => {
    const { calls } = await run({
      ...base,
      custom_domain: 'aitickets.com',
      domain_status: 'active',
      domain_verification: { token: 't', attached_at: '2026-09-01T00:00:00Z', alias_preexisting: true },
    })
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
  })

  it('alias agregado por AI Tickets: se quita solo ese alias', async () => {
    const { res, calls } = await run({
      ...base,
      custom_domain: 'entradas.productora.cl',
      domain_status: 'active',
      domain_verification: { token: 't', attached_at: '2026-09-01T00:00:00Z' },
    })
    expect(res.ok).toBe(true)
    const patches = calls.filter((c) => c.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(JSON.parse(patches[0].body).domain_aliases).toEqual(['aitickets.com'])
  })
})

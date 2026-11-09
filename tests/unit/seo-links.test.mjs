// Enlaces internos y Search Console. Dos motivos de "no indexada" que aparecieron juntos:
//   - "Página alternativa con etiqueta canónica adecuada": botones internos con ?next=…&utm_*=… creaban otra URL por
//     cada botón y por cada evento (todas con canónica a la página limpia). Ahora van en el fragmento (#).
//   - "Bloqueada por robots.txt": "Continuar con Google" era un <a href="/api/auth/google…"> (y /api/ está bloqueado)
//     en el registro, enlazado desde todas las landings. Ahora es un botón.
// Además, la web del organizador sin https:// quedaba como enlace relativo (/eventos/aitickets.cl → 404).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import { connectAiUrl, publishUrl, signupUrl, withFragmentParams } from '../../src/components/landing/links.js'
import { normalizeWebsiteUrl } from '../../src/lib/siteTemplates.ts'

const fragmentParams = (url) => new URLSearchParams(url.split('#')[1] || '')

describe('enlaces internos al registro: parámetros en el fragmento, nunca en la query', () => {
  it('publishUrl: misma URL rastreable para todos los botones, con next y atribución en el fragmento', () => {
    const url = publishUrl('teatro_hero')
    expect(url.startsWith('/organizadores/registro#')).toBe(true)
    expect(url).not.toContain('?')
    expect(Object.fromEntries(fragmentParams(url))).toEqual({
      next: '/dashboard/events/create',
      utm_source: 'aitickets',
      utm_medium: 'landing',
      utm_campaign: 'teatro_hero',
    })
  })

  it('connectAiUrl termina en /dashboard/ia', () => {
    expect(fragmentParams(connectAiUrl('organizadores_ia')).get('next')).toBe('/dashboard/ia')
    expect(fragmentParams(connectAiUrl('organizadores_ia')).get('utm_campaign')).toBe('organizadores_ia')
  })

  it('signupUrl omite los valores vacíos (precios, comparar, web-gratis guardan solo su origen)', () => {
    expect(signupUrl({ source: 'precios', medium: '' })).toBe('/organizadores/registro#utm_source=precios')
    expect(signupUrl({ source: 'comparar', medium: '', campaign: 'ticketplus' })).toBe(
      '/organizadores/registro#utm_source=comparar&utm_campaign=ticketplus'
    )
    expect(withFragmentParams('/organizadores', {})).toBe('/organizadores')
  })
})

describe('normalizeWebsiteUrl (web del organizador)', () => {
  it('agrega https:// a un dominio escrito sin esquema (antes: enlace relativo y 404)', () => {
    expect(normalizeWebsiteUrl('aitickets.cl')).toBe('https://aitickets.cl/')
    expect(normalizeWebsiteUrl('  www.teatro.cl/cartelera ')).toBe('https://www.teatro.cl/cartelera')
    expect(normalizeWebsiteUrl('teatro.cl:8080/x')).toBe('https://teatro.cl:8080/x')
  })

  it('respeta las URL http(s) completas', () => {
    expect(normalizeWebsiteUrl('https://teatro.cl/obras?x=1')).toBe('https://teatro.cl/obras?x=1')
    expect(normalizeWebsiteUrl('http://teatro.cl')).toBe('http://teatro.cl')
  })

  it('descarta esquemas peligrosos y textos que no son un dominio', () => {
    for (const raw of ['javascript:alert(1)', 'data:text/html,hola', 'mailto:hola@teatro.cl', 'no tengo', 'eventos', 'localhost', '', '   ', null, undefined, 42]) {
      expect(normalizeWebsiteUrl(raw)).toBeNull()
    }
  })
})

// Guardia de código: ningún enlace interno con utm_* en la query en las páginas públicas. Los enlaces externos
// (anuncios, correos, links de seguimiento que arma el productor) sí los llevan y no se revisan aquí.
describe('código público sin enlaces internos con ?utm_*', () => {
  const ROOT = join(import.meta.dirname, '../../src')
  const SKIP = ['pages/api', 'pages/dashboard', 'components/dashboard', 'lib/producer-api', 'lib/admin-api']
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = relative(ROOT, full)
      if (SKIP.some((s) => rel === s || rel.startsWith(`${s}/`))) continue
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(astro|vue|js|mjs|ts)$/.test(name)) files.push(full)
    }
  }
  walk(ROOT)

  it('no hay rutas internas ("/…?…utm_…") escritas en el código', () => {
    const offenders = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/["'`]\/[^"'`\s]*\?[^"'`\s]*utm_[a-z]+=/.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('"Continuar con Google" es un botón, no un <a href> hacia /api/ (bloqueado en robots.txt)', () => {
    for (const form of ['components/auth/ProducerRegisterForm.vue', 'components/auth/ProducerLoginForm.vue']) {
      const src = readFileSync(join(ROOT, form), 'utf8')
      expect(src).not.toMatch(/<a\b[^>]*:href="googleHref"/)
      expect(src).toMatch(/<button\b[^>]*@click="goToGoogle"|<button[\s\S]{0,300}@click="goToGoogle"/)
    }
  })
})

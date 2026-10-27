// Imágenes para compartir de las páginas públicas (src/lib/ogPages.ts + src/lib/ogCard.ts): cada página indexable
// tiene su tarjeta, las fotos existen, la URL cambia con el contenido y el render cumple lo que piden WhatsApp,
// Facebook y Slack (1200×630, JPEG, bajo 300 KB).
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { LANDINGS } from '../../src/data/landings'
import { COMPARISONS } from '../../src/data/comparisons'
import { OG_MAX_BYTES } from '../../src/lib/imageOptimize'
import { renderOgCard } from '../../src/lib/ogCard'
import { siteOgImagePath } from '../../src/lib/ogImage'
import { DEFAULT_OG_CARD, defaultOgImagePath, guideOgCard, ogCardForPath, ogCardImagePath, ogPageKey, staticOgCards } from '../../src/lib/ogPages'

describe('ogPages', () => {
  it('tarjeta para la portada, las landings, las comparaciones y las páginas fijas', () => {
    const paths = ['/', '/organizadores', '/precios', '/eventos', '/guias', '/web-gratis', '/ticketeras-en-chile', '/presentacion',
      ...LANDINGS.map((l) => `/${l.slug}`), ...COMPARISONS.map((c) => `/comparar/${c.slug}`)]
    for (const path of paths) expect(ogCardForPath(path), path).not.toBeNull()
    expect(ogCardForPath('/ticketera-stand-up').title).toBe(LANDINGS.find((l) => l.slug === 'ticketera-stand-up').h1)
    expect(ogCardForPath('/precios.html')).toBe(ogCardForPath('/precios'))
    expect(ogCardForPath('/mis-entradas')).toBeNull()
  })

  it('todas las fotos existen en public/', () => {
    for (const card of Object.values(staticOgCards())) {
      for (const photo of card.photos) expect(existsSync(`public${photo}`), photo).toBe(true)
    }
  })

  it('claves de archivo y URL versionada por contenido', () => {
    expect(ogPageKey('/')).toBe('inicio')
    expect(ogPageKey('/comparar/passline')).toBe('comparar--passline')
    expect(ogPageKey('/guias/como-hacer-una-preventa/')).toBe('guias--como-hacer-una-preventa')
    expect(Object.keys(staticOgCards())).toContain('inicio')
    const a = ogCardImagePath('precios', ogCardForPath('/precios'))
    expect(a).toMatch(/^\/og\/paginas\/precios\.jpg\?v=[0-9a-f]{12}$/)
    expect(ogCardImagePath('precios', { ...ogCardForPath('/precios'), title: 'Otro' })).not.toBe(a)
    expect(defaultOgImagePath()).toBe(ogCardImagePath('inicio', DEFAULT_OG_CARD))
  })

  it('guía: su título y la foto de su landing', () => {
    const card = guideOgCard({ data: { title: 'Cómo hacer check-in con QR', landing: 'entradas-con-qr' } })
    expect(card.title).toBe('Cómo hacer check-in con QR')
    expect(card.photos).toEqual(['/landing/aitk-puerta-qr.jpg'])
  })

  it('sitio de productor: solo fotos https y slugs válidos', () => {
    expect(siteOgImagePath('mi-productora', 'https://x.supabase.co/a.jpg')).toMatch(/^\/og\/sitios\/mi-productora\.jpg\?v=[0-9a-f]{16}$/)
    expect(siteOgImagePath('mi-productora', 'http://x/a.jpg')).toBeNull()
    expect(siteOgImagePath('../x', 'https://x/a.jpg')).toBeNull()
    expect(siteOgImagePath('mi-productora', null)).toBeNull()
  })
})

describe('renderOgCard', () => {
  it.each([['foto', '/ticketera-stand-up'], ['mosaico', '/']])('%s: JPEG 1200×630 bajo el límite', async (_, path) => {
    const jpg = await renderOgCard(ogCardForPath(path))
    expect(jpg.length).toBeLessThanOrEqual(OG_MAX_BYTES)
    const meta = await sharp(jpg).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1200, 630])
  }, 20000)
})

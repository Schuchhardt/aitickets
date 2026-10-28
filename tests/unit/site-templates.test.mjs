// Plantillas por nicho y secciones del sitio del productor (src/lib/siteTemplates.ts). Solo lógica pura.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  NICHE_TEMPLATES,
  SITE_FONTS,
  SITE_TEMPLATES,
  TEMPLATE_INFO,
  blankSection,
  defaultSections,
  mergeSectionEdits,
  plainTextToHtml,
  readableOn,
  resolveThemeFor,
  sanitizeSections,
  videoEmbedUrl,
} from '../../src/lib/siteTemplates.ts'

describe('plantillas', () => {
  it('cada plantilla tiene colores hex y una tipografía disponible', () => {
    for (const key of SITE_TEMPLATES) {
      const d = TEMPLATE_INFO[key].defaults
      for (const c of [d.primary, d.accent, d.background, d.text]) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
      expect(SITE_FONTS).toContain(d.font)
    }
  })

  it('hay una plantilla por cada landing de nicho', () => {
    expect([...NICHE_TEMPLATES].sort()).toEqual(['academias', 'clubs', 'fiestas', 'musica', 'seminarios', 'standup', 'talleres', 'teatro'])
  })

  it('la migración permite todas las plantillas', () => {
    const sql = readFileSync(new URL('../../db/migrations/202611010100_site_niche_templates.sql', import.meta.url), 'utf8')
    for (const key of SITE_TEMPLATES) expect(sql).toContain(`'${key}'`)
  })

  it('resolveThemeFor usa los colores del nicho y respeta los del productor', () => {
    expect(resolveThemeFor('teatro', {})).toMatchObject({ background: '#0c1220', font: 'Bodoni Moda', dark: true })
    expect(resolveThemeFor('teatro', { primary: '#ff0000', font: 'Comic Sans' })).toMatchObject({ primary: '#ff0000', font: 'Bodoni Moda' })
  })

  it('readableOn elige texto oscuro sobre colores claros y claro sobre oscuros', () => {
    expect(readableOn('#ffe45c')).toBe('#111111')
    expect(readableOn('#0c1220')).toBe('#ffffff')
    expect(readableOn('nope')).toBe('#111111')
  })
})

describe('secciones', () => {
  it('las sugeridas de cada plantilla son válidas y empiezan con portada y eventos', () => {
    for (const key of SITE_TEMPLATES) {
      const sections = defaultSections(key)
      expect(sanitizeSections(sections)).toEqual(sections)
      expect(sections.slice(0, 2).map((s) => s.type)).toEqual(['hero', 'events'])
    }
  })

  it('sanea tipos, textos, URLs y duplicados', () => {
    const out = sanitizeSections([
      { id: 'hero', type: 'hero', data: { title: '  Hola\nmundo ', image_url: 'javascript:alert(1)', extra: 'x' } },
      { id: 'hero', type: 'hero', data: {} }, // segunda portada: se descarta
      { type: 'script', data: {} },
      { id: 'faq', type: 'faq', data: { items: [{ question: '¿Edad?', answer: '' }, { question: '¿QR?', answer: 'Llega por correo.' }] } },
      { id: 'cta', type: 'cta', data: { title: 'Ven', button_url: 'javascript:void(0)' } },
      { id: 'v', type: 'video', data: { url: 'https://example.com/video' } },
    ])
    expect(out.map((s) => s.type)).toEqual(['hero', 'faq', 'cta', 'video'])
    expect(out[0].data).toEqual({ title: 'Hola mundo' })
    expect(out[1].data.items).toEqual([{ question: '¿QR?', answer: 'Llega por correo.' }])
    expect(out[2].data.button_url).toBeUndefined()
    expect(out[3].data.url).toBeUndefined()
  })

  it('con allowedImages descarta imágenes desconocidas', () => {
    const allowed = new Set(['https://cdn.test/a.jpg'])
    const out = sanitizeSections(
      [{ id: 'g', type: 'gallery', data: { items: [{ image_url: 'https://cdn.test/a.jpg' }, { image_url: 'https://evil.test/b.jpg' }] } }],
      { allowedImages: allowed }
    )
    expect(out[0].data.items).toEqual([{ image_url: 'https://cdn.test/a.jpg' }])
  })

  it('blankSection reutiliza los textos de la plantilla', () => {
    expect(blankSection('contact', 'teatro').data.title).toBe(TEMPLATE_INFO.teatro.copy.contactTitle)
    expect(blankSection('faq', 'teatro').type).toBe('faq')
  })

  it('mergeSectionEdits aplica cambios y orden de la IA', () => {
    const current = defaultSections('fiestas')
    const merged = mergeSectionEdits(current, [{ id: 'faq-1', type: 'faq', data: { items: [] } }, { id: 'hero', type: 'hero', data: { title: 'Nuevo' } }], [
      'hero',
      'events',
      'contact',
    ])
    // highlights y about quedan fuera del orden (se eliminan); faq-1, olvidada en el orden, va al final
    expect(merged.map((s) => s.id)).toEqual(['hero', 'events', 'contact', 'faq-1'])
    expect(merged[0].data.title).toBe('Nuevo')
  })

  it('mergeSectionEdits con sectionId solo toca esa sección', () => {
    const current = defaultSections('teatro')
    const merged = mergeSectionEdits(current, [{ id: 'otra', type: 'contact', data: { title: 'Escríbenos' } }], [], 'contact')
    expect(merged.length).toBe(current.length)
    expect(merged.find((s) => s.id === 'contact').data.title).toBe('Escríbenos')
    expect(merged.find((s) => s.id === 'hero')).toEqual(current.find((s) => s.id === 'hero'))
  })
})

describe('utilidades', () => {
  it('videoEmbedUrl acepta YouTube y Vimeo', () => {
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789')
    expect(videoEmbedUrl('https://example.com/x')).toBeNull()
  })

  it('plainTextToHtml escapa y arma párrafos', () => {
    expect(plainTextToHtml('Hola <b>\nlínea\n\nOtro')).toBe('<p>Hola &lt;b&gt;<br>línea</p><p>Otro</p>')
  })
})

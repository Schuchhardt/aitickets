// Plantillas por nicho y secciones del sitio del productor (src/lib/siteTemplates.ts). Solo lógica pura.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  MAX_SITE_IMAGES,
  NICHE_TEMPLATES,
  SECTION_INFO,
  SECTION_TYPES,
  SITE_FONTS,
  SITE_TEMPLATES,
  TEMPLATE_INFO,
  applyTextEdit,
  blankItem,
  blankSection,
  cleanVideo,
  countSectionMedia,
  defaultSections,
  itemIsFilled,
  mergeSectionEdits,
  navLabel,
  plainTextToHtml,
  readableOn,
  resolveThemeFor,
  sanitizeLayout,
  sanitizeSections,
  sectionAnchor,
  sectionVideoUrls,
  videoEmbedUrl,
} from '../../src/lib/siteTemplates.ts'
import { htmlToPlainText } from '../../src/lib/sitePlainText.ts'

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

describe('componentes nuevos: pestañas, personas, imagen y texto, carrusel, ventanas y menú', () => {
  const VIDEO = 'https://proj.supabase.co/storage/v1/object/public/aitickets-event-videos/site-videos/7/video-1.mp4'

  it('pestañas y personas: campos propios, imagen https y enlace saneado', () => {
    const [tabs, people] = sanitizeSections([
      { id: 'programa', type: 'tabs', data: { title: 'Programa', items: [{ title: 'Día 1', text: 'Charlas', image_url: 'https://cdn.test/a.jpg', name: 'x' }, { title: 'Día 2' }] } },
      { id: 'elenco', type: 'people', data: { layout: 'carousel', items: [{ name: ' Ana\nPérez ', role: 'Actriz', text: 'Bio', link_url: 'javascript:alert(1)', image_url: 'http://inseguro/a.jpg' }] } },
    ])
    // Una pestaña sin contenido no se publica
    expect(tabs.data.items).toEqual([{ title: 'Día 1', text: 'Charlas', image_url: 'https://cdn.test/a.jpg' }])
    expect(people.data).toEqual({ layout: 'carousel', items: [{ name: 'Ana Pérez', role: 'Actriz', text: 'Bio' }] })
  })

  it('imagen y texto: lado de la foto, video y botón con ventana; la ventana solo con button_action "modal"', () => {
    const [feature, cta, plain] = sanitizeSections([
      { id: 'sala', type: 'feature', data: { title: 'La sala', text: 'Texto', align: 'right', video: { url: VIDEO, width: '1920', height: 1080, duration: 30, poster_url: 'https://cdn.test/p.jpg' }, button_label: 'Ver', button_action: 'modal', modal_title: 'Info', modal_text: 'Detalle' } },
      { id: 'reserva', type: 'cta', data: { title: 'Reserva', button_action: 'modal', modal_text: 'Escríbenos', button_url: '#sala' } },
      { id: 'otro', type: 'cta', data: { title: 'Ven', button_action: 'link', modal_text: 'no se guarda' } },
    ])
    expect(feature.data).toMatchObject({ align: 'right', button_action: 'modal', modal_title: 'Info', modal_text: 'Detalle' })
    expect(feature.data.video).toEqual({ url: VIDEO, poster_url: 'https://cdn.test/p.jpg', width: 1920, height: 1080, duration: 30 })
    expect(cta.data).toMatchObject({ button_action: 'modal', modal_text: 'Escríbenos', button_url: '#sala' })
    expect(plain.data).toEqual({ title: 'Ven' })
  })

  it('el diseño de cada sección solo acepta sus variantes; nav y el ancla fija de eventos', () => {
    const out = sanitizeSections([
      { id: 'hero', type: 'hero', nav: true, data: { layout: 'overlay' } },
      { id: 'eventos', type: 'gallery', nav: true, data: { layout: 'posters', nav_label: 'Fotos de la temporada pasada', items: [{ image_url: 'https://cdn.test/a.jpg' }] } },
      { id: 'eventos', type: 'events', nav: 'sí', data: { layout: 'list' } },
    ])
    expect(out[0]).toMatchObject({ nav: true, data: { layout: 'overlay' } })
    // "eventos" es el ancla de la sección de eventos: otra sección recibe un id nuevo
    expect(out[1].id).not.toBe('eventos')
    expect(out[1].data.layout).toBeUndefined()
    expect(out[1].data.nav_label).toBe('Fotos de la temporada pa')
    expect(out[2]).toEqual({ id: 'eventos', type: 'events', data: { layout: 'list' } })
    expect(sectionAnchor(out[2])).toBe('eventos')
    expect(navLabel({ type: 'faq', data: {} })).toBe('Preguntas')
    expect(navLabel({ type: 'people', data: { title: 'Un título muy largo para el menú del sitio' } })).toHaveLength(24)
  })

  it('keepEmpty conserva los ítems a medio llenar (editor); sin él solo quedan los completos; galería sin foto nunca', () => {
    const input = [
      { id: 'faq', type: 'faq', data: { items: [{ question: '¿Edad?', answer: '' }, { question: '¿QR?', answer: 'Por correo' }] } },
      { id: 'p', type: 'people', data: { items: [{ name: '', role: '' }] } },
      { id: 'g', type: 'gallery', data: { items: [{ caption: 'sin foto' }] } },
    ]
    const editor = sanitizeSections(input, { keepEmpty: true })
    expect(editor[0].data.items).toEqual([{ question: '¿Edad?' }, { question: '¿QR?', answer: 'Por correo' }])
    expect(editor[1].data.items).toEqual([{}])
    expect(editor[2].data.items).toEqual([])
    const publicSite = sanitizeSections(input)
    expect(publicSite[0].data.items).toEqual([{ question: '¿QR?', answer: 'Por correo' }])
    expect(publicSite[1].data.items).toEqual([])
    expect(itemIsFilled('tabs', { title: 'Día 1' })).toBe(false)
    expect(itemIsFilled('people', { name: 'Ana' })).toBe(true)
  })

  it('cada tipo de sección se puede agregar y sus ítems vacíos tienen los campos del tipo', () => {
    for (const type of SECTION_TYPES) {
      const s = blankSection(type, 'teatro')
      expect(s.type).toBe(type)
      expect(sanitizeSections([s], { keepEmpty: true })).toHaveLength(1)
      if (SECTION_INFO[type].maxItems && type !== 'gallery') expect(Object.keys(blankItem(type)).length).toBeGreaterThan(0)
    }
  })

  it('cleanVideo: solo archivos de video https, metadatos numéricos y videos permitidos', () => {
    expect(cleanVideo({ url: VIDEO, duration: -3 })).toEqual({ url: VIDEO })
    expect(cleanVideo({ url: 'https://cdn.test/x.jpg' })).toBeUndefined()
    expect(cleanVideo({ url: 'http://cdn.test/x.mp4' })).toBeUndefined()
    expect(cleanVideo('javascript:alert(1)')).toBeUndefined()
    expect(cleanVideo({ url: VIDEO }, { allowedVideos: new Set() })).toBeUndefined()
  })

  it('countSectionMedia cuenta fotos y videos subidos sin repetir', () => {
    const sections = [
      { id: 'a', type: 'hero', data: { image_url: 'https://cdn.test/1.jpg', video: { url: VIDEO } } },
      { id: 'b', type: 'gallery', data: { items: [{ image_url: 'https://cdn.test/1.jpg' }, { image_url: 'https://cdn.test/2.jpg' }] } },
      { id: 'c', type: 'video', data: { video: { url: VIDEO } } },
    ]
    expect(countSectionMedia(sections)).toEqual({ images: 2, videos: 1 })
    expect(sectionVideoUrls(sections)).toEqual([VIDEO])
    expect(MAX_SITE_IMAGES).toBeGreaterThan(SECTION_INFO.gallery.maxItems)
  })

  it('sanitizeLayout: tipo de menú conocido y menú fijo', () => {
    expect(sanitizeLayout({ nav: 'sidebar', sticky: true, extra: 1 })).toEqual({ nav: 'sidebar', sticky: true })
    expect(sanitizeLayout({ nav: 'flotante', sticky: 'sí' })).toEqual({})
    expect(sanitizeLayout(null)).toEqual({})
  })
})

describe('edición de textos en la vista previa (applyTextEdit)', () => {
  const draft = () => ({
    title: 'Club',
    tagline: '',
    about: '',
    sections: [
      { id: 'hero', type: 'hero', data: {} },
      { id: 'faq', type: 'faq', data: { items: [{ question: '¿QR?', answer: '' }] } },
      { id: 'eventos', type: 'events', data: {} },
    ],
  })

  it('aplica textos del sitio, de una sección y de un ítem, normalizando saltos de línea', () => {
    const d = draft()
    expect(applyTextEdit(d, 'site.title', '  Club\nNorte ')).toBe(true)
    expect(applyTextEdit(d, 'site.about', 'Uno\n\n\n\nDos')).toBe(true)
    expect(applyTextEdit(d, 'hero.title', 'Temporada\n2027')).toBe(true)
    expect(applyTextEdit(d, 'hero.subtitle', 'Línea 1\nLínea 2')).toBe(true)
    expect(applyTextEdit(d, 'faq.items.0.answer', 'Llega por correo.')).toBe(true)
    expect(d).toMatchObject({ title: 'Club Norte', about: 'Uno\n\nDos' })
    expect(d.sections[0].data).toEqual({ title: 'Temporada 2027', subtitle: 'Línea 1\nLínea 2' })
    expect(d.sections[1].data.items[0].answer).toBe('Llega por correo.')
  })

  it('respeta el largo máximo y rechaza destinos que no existen o no son texto', () => {
    const d = draft()
    expect(applyTextEdit(d, 'hero.eyebrow', 'x'.repeat(200))).toBe(true)
    expect(d.sections[0].data.eyebrow).toHaveLength(60)
    for (const target of ['site.slug', 'hero.image_url', 'hero.items.0.title', 'faq.items.5.answer', 'faq.items.0.image_url', 'otra.title', 'eventos.subtitle', '__proto__.x', 42]) {
      expect(applyTextEdit(d, target, 'x'), String(target)).toBe(false)
    }
    expect(applyTextEdit(d, 'hero.title', { toString: () => 'x' })).toBe(false)
  })

  it('htmlToPlainText pasa "Sobre nosotros" a texto con párrafos', () => {
    expect(htmlToPlainText('<p>Hola &amp; chao</p><p>Línea<br>dos</p>')).toBe('Hola & chao\n\nLínea\ndos')
    expect(htmlToPlainText('')).toBe('')
  })
})

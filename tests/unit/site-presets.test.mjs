// Plantillas completas del sitio del productor (src/lib/sitePresets.ts): copy + layout + tema por tipo de página.
import { describe, expect, it } from 'vitest'

import { PRESET_BY_KEY, SITE_PRESETS, applyPreset, presetGroups } from '../../src/lib/sitePresets.ts'
import { NICHE_TEMPLATES, SITE_FONTS, SITE_TEMPLATES, TEMPLATE_INFO, sanitizeLayout, sanitizeSections, sectionAnchor } from '../../src/lib/siteTemplates.ts'

// Contraste WCAG entre dos colores hex
function luminance(hex) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

describe('plantillas completas por nicho', () => {
  it('cada nicho tiene 2 o 3 tipos de página y las claves son únicas', () => {
    for (const niche of NICHE_TEMPLATES) {
      const count = SITE_PRESETS.filter((p) => p.template === niche).length
      expect(count, niche).toBeGreaterThanOrEqual(2)
      expect(count, niche).toBeLessThanOrEqual(3)
    }
    expect(new Set(SITE_PRESETS.map((p) => p.key)).size).toBe(SITE_PRESETS.length)
    expect(presetGroups([...NICHE_TEMPLATES]).map((g) => g.template)).toEqual([...NICHE_TEMPLATES])
  })

  it('las secciones ya vienen saneadas: portada primero, eventos y contacto, ids únicos', () => {
    for (const p of SITE_PRESETS) {
      expect(SITE_TEMPLATES, p.key).toContain(p.template)
      expect(sanitizeSections(p.sections, { keepEmpty: true }), p.key).toEqual(p.sections)
      expect(p.sections[0].type, p.key).toBe('hero')
      expect(p.sections.filter((s) => s.type === 'events'), p.key).toHaveLength(1)
      expect(p.sections.some((s) => s.type === 'contact'), p.key).toBe(true)
      expect(new Set(p.sections.map((s) => s.id)).size, p.key).toBe(p.sections.length)
      expect(sanitizeLayout(p.layout), p.key).toEqual(p.layout)
    }
  })

  it('los botones apuntan a secciones que existen y el menú no se desborda', () => {
    for (const p of SITE_PRESETS) {
      const anchors = new Set(p.sections.map((s) => `#${sectionAnchor(s)}`))
      for (const s of p.sections) {
        const url = s.data.button_url
        if (url && url.startsWith('#')) expect(anchors.has(url), `${p.key}: ${s.id} → ${url}`).toBe(true)
        if (s.data.button_action === 'modal') expect(s.type === 'cta' || s.type === 'feature', p.key).toBe(true)
      }
      expect(p.sections.filter((s) => s.nav).length, p.key).toBeLessThanOrEqual(7)
    }
  })

  it('no inventan personas ni opiniones: esos ítems vienen vacíos para que los complete el productor', () => {
    for (const p of SITE_PRESETS) {
      for (const s of p.sections) {
        if (s.type === 'testimonials') for (const item of s.data.items || []) expect(item.quote, p.key).toBeUndefined()
        if (s.type === 'people') for (const item of s.data.items || []) expect(item.name, p.key).toBeUndefined()
        if (s.type === 'gallery') expect(s.data.items || [], p.key).toEqual([])
      }
    }
  })

  it('paletas: colores hex, tipografía disponible y texto legible sobre el fondo', () => {
    for (const p of SITE_PRESETS) {
      const palette = { ...TEMPLATE_INFO[p.template].defaults, ...(p.theme || {}) }
      for (const c of [palette.primary, palette.accent, palette.background, palette.text]) expect(c, p.key).toMatch(/^#[0-9a-f]{6}$/i)
      expect(SITE_FONTS, p.key).toContain(palette.font)
      expect(contrast(palette.text, palette.background), p.key).toBeGreaterThanOrEqual(7)
    }
  })

  it('applyPreset: estilo, menú y secciones de la plantilla; conserva logo e imagen de portada; copia independiente', () => {
    const theme = { primary: '#000000', logo_url: 'https://cdn.test/logo.png', hero_image_url: 'https://cdn.test/hero.jpg' }
    const applied = applyPreset('teatro-sala', theme)
    expect(applied).toMatchObject({ template: 'teatro', preset: 'teatro-sala', layout: { nav: 'sidebar' } })
    expect(applied.theme).toMatchObject({ logo_url: theme.logo_url, hero_image_url: theme.hero_image_url, background: '#170b10' })
    expect(applied.theme.primary).not.toBe('#000000')
    applied.sections[0].data.title = 'cambiado'
    expect(PRESET_BY_KEY['teatro-sala'].sections[0].data.title).toBeUndefined()
    expect(applyPreset('no-existe')).toBeNull()
  })
})

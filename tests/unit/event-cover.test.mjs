// Ajuste de portada (src/lib/eventCover.ts): normalización y rangos.
import { describe, expect, it } from 'vitest'
import { DEFAULT_COVER_SETTINGS, isDefaultCoverSettings, normalizeCoverSettings } from '../../src/lib/eventCover'

describe('normalizeCoverSettings', () => {
  it('NULL o vacío => valores por defecto', () => {
    expect(normalizeCoverSettings(null)).toEqual(DEFAULT_COVER_SETTINGS)
    expect(normalizeCoverSettings({})).toEqual(DEFAULT_COVER_SETTINGS)
    expect(isDefaultCoverSettings(normalizeCoverSettings(undefined))).toBe(true)
  })

  it('acota alto y posición y solo acepta cover/contain', () => {
    const s = normalizeCoverSettings({
      desktop: { height: 5000, position_y: -10, fit: 'contain' },
      mobile: { height: '10', position_y: 33.6, fit: 'stretch' },
    })
    expect(s.desktop).toEqual({ height: 720, position_y: 0, fit: 'contain' })
    expect(s.mobile).toEqual({ height: 180, position_y: 34, fit: 'cover' })
    expect(isDefaultCoverSettings(s)).toBe(false)
  })
})

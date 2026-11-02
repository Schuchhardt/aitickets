// Categorías del formulario del evento: cada una con su ícono propio (no la etiqueta genérica) y sin repetir.
import { describe, expect, it } from 'vitest'
import { Tag, Clapperboard, Cake, Gem, PartyPopper } from 'lucide-vue-next'
import { EVENT_CATEGORIES } from '../../src/lib/eventCategories.mjs'
import { categoryIcon } from '../../src/components/event/categoryIcons.js'

describe('categorías del evento', () => {
  it('sin repetir e incluye cine, cumpleaños / fiesta privada y boda', () => {
    expect(new Set(EVENT_CATEGORIES).size).toBe(EVENT_CATEGORIES.length)
    expect(EVENT_CATEGORIES).toEqual(expect.arrayContaining(['Cine', 'Cumpleaños / Fiesta privada', 'Boda']))
  })
  it('cada una (salvo Otro) tiene su ícono', () => {
    for (const c of EVENT_CATEGORIES.filter((c) => c !== 'Otro')) expect(categoryIcon(c), c).not.toBe(Tag)
  })
  it('íconos de las nuevas, y una fiesta abierta sigue siendo fiesta', () => {
    expect(categoryIcon('Cine')).toBe(Clapperboard)
    expect(categoryIcon('Cumpleaños / Fiesta privada')).toBe(Cake)
    expect(categoryIcon('Boda')).toBe(Gem)
    expect(categoryIcon('Fiesta')).toBe(PartyPopper)
    expect(categoryIcon('Cinema Paradiso')).not.toBe(Clapperboard)
  })
})

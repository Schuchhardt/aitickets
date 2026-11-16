// Filtro de Sentry en el navegador: el chunk viejo que ChunkReload.astro está arreglando no se reporta; si vuelve
// después de la recarga (o es otro error), sí.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STALE_CHUNK_RE, dropRecoveredStaleChunk } from '../../src/lib/sentryFilters.js'

const chunkEvent = (value) => ({ exception: { values: [{ type: 'TypeError', value }] } })
const reloading = { __aitChunkReloading: true }

describe('dropRecoveredStaleChunk', () => {
  it('descarta el chunk viejo de cada navegador mientras la recarga está en curso', () => {
    for (const msg of [
      'Failed to fetch dynamically imported module: https://aitickets.cl/_astro/AppHeader.Be0t6wQb.js',
      'Importing a module script failed.',
      'error loading dynamically imported module: https://aitickets.cl/_astro/x.js',
    ]) {
      expect(dropRecoveredStaleChunk(chunkEvent(msg), { originalException: new TypeError(msg) }, reloading)).toBeNull()
      expect(dropRecoveredStaleChunk(chunkEvent(msg), {}, reloading)).toBeNull()
    }
  })

  it('lo reporta si no hay recarga en curso (la recarga ya se hizo y volvió a fallar)', () => {
    const ev = chunkEvent('Failed to fetch dynamically imported module: https://aitickets.cl/_astro/a.js')
    expect(dropRecoveredStaleChunk(ev, {}, {})).toBe(ev)
    expect(dropRecoveredStaleChunk(ev, {}, undefined)).toBe(ev)
  })

  it('no toca otros errores aunque haya recarga en curso', () => {
    const ev = chunkEvent("Cannot read properties of undefined (reading 'price')")
    expect(dropRecoveredStaleChunk(ev, { originalException: new TypeError('x') }, reloading)).toBe(ev)
  })
})

describe('ChunkReload.astro y el filtro', () => {
  const component = readFileSync('src/components/ChunkReload.astro', 'utf8')
  it('ChunkReload marca la recarga y reconoce los mismos mensajes', () => {
    expect(component).toMatch(/window\.__aitChunkReloading = true;\s*location\.reload\(\)/)
    const re = component.match(/var RE = \/(.+)\/i;/)[1]
    expect(re).toBe(STALE_CHUNK_RE.source)
  })
  it('sentry.client.config usa el filtro', () => {
    expect(readFileSync('sentry.client.config.js', 'utf8')).toMatch(/beforeSend: dropRecoveredStaleChunk/)
  })
})

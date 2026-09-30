// Lugares por organización (src/lib/orgVenues.ts): una organización solo ve/usa sus lugares o los que
// ya usan sus eventos, con degradación si venues.organization_id no existe (deploy preview).
import { describe, expect, it } from 'vitest'

import { insertOrgVenue, isMissingColumnError, isVenueAllowed, listOrgVenues, mergeVenues } from '../../src/lib/orgVenues.ts'

const VENUES = [
  { id: 'v-demo', name: 'Teatro Demo', city: 'Santiago', organization_id: 1 },
  { id: 'v-own2', name: 'Anfiteatro', city: 'Valparaíso', organization_id: 1 },
  { id: 'v-legacy', name: 'Bar Compartido', city: 'Santiago', organization_id: null },
  { id: 'v-other', name: 'Teatro Caupolican', city: 'Santiago', organization_id: 2 },
  { id: 'v-test', name: 'Test Venue', city: null, organization_id: null },
]
const EVENT_LOCATIONS = [
  { venue_id: 'v-demo', org: 1 },
  { venue_id: 'v-legacy', org: 1 },
  { venue_id: 'v-legacy', org: 2 },
  { venue_id: 'v-other', org: 2 },
]

/** Cliente falso con la forma mínima del query builder de supabase-js. */
function fakeSupabase({ hasOrgColumn = true, inserts = [] } = {}) {
  const missing = { code: '42703', message: 'column venues.organization_id does not exist' }
  return {
    from(table) {
      const filters = []
      let insertRow = null
      const q = {
        select() { return q },
        limit() { return q },
        eq(col, val) { filters.push((r) => r[col] === val); return q },
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return q },
        insert(row) { insertRow = row; return q },
        single() { return q },
        then(resolve) {
          if (table === 'venues' && insertRow) {
            if (!hasOrgColumn && 'organization_id' in insertRow) return resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'organization_id' column of 'venues' in the schema cache" } })
            inserts.push(insertRow)
            return resolve({ data: { id: 'v-new' }, error: null })
          }
          if (table === 'venues') {
            if (!hasOrgColumn && filters.length && q._usesOrg) return resolve({ data: null, error: missing })
            const rows = VENUES.filter((r) => filters.every((f) => f(r))).map(({ id, name, city }) => ({ id, name, city }))
            return resolve({ data: rows, error: null })
          }
          if (table === 'event_locations') {
            const rows = EVENT_LOCATIONS.filter((r) => filters.every((f) => f({ 'events.organization_id': r.org })))
            return resolve({ data: rows.map((r) => ({ venue_id: r.venue_id, events: { organization_id: r.org } })), error: null })
          }
          return resolve({ data: [], error: null })
        },
      }
      const eq = q.eq
      q.eq = (col, val) => { if (col === 'organization_id') q._usesOrg = true; return eq(col, val) }
      return q
    },
  }
}

describe('listOrgVenues', () => {
  it('incluye los lugares propios y los usados por mis eventos, nunca los de otras organizaciones', async () => {
    const { venues, hasOrgColumn } = await listOrgVenues(fakeSupabase(), 1)
    expect(hasOrgColumn).toBe(true)
    expect(venues.map((v) => v.id)).toEqual(['v-own2', 'v-legacy', 'v-demo'])
    expect(venues.map((v) => v.name)).not.toContain('Teatro Caupolican')
    expect(venues.map((v) => v.name)).not.toContain('Test Venue')
  })

  it('sin la columna organization_id usa solo los lugares de mis eventos', async () => {
    const { venues, hasOrgColumn } = await listOrgVenues(fakeSupabase({ hasOrgColumn: false }), 1)
    expect(hasOrgColumn).toBe(false)
    expect(venues.map((v) => v.id).sort()).toEqual(['v-demo', 'v-legacy'])
  })

  it('sin organización no devuelve lugares', async () => {
    expect((await listOrgVenues(fakeSupabase(), null)).venues).toEqual([])
  })
})

describe('isVenueAllowed', () => {
  it('acepta solo ids del conjunto permitido', async () => {
    const { venues } = await listOrgVenues(fakeSupabase(), 1)
    expect(isVenueAllowed('v-demo', venues)).toBe(true)
    expect(isVenueAllowed('v-other', venues)).toBe(false)
    expect(isVenueAllowed('', venues)).toBe(false)
    expect(isVenueAllowed(undefined, venues)).toBe(false)
    expect(isVenueAllowed('a', ['a', 'b'])).toBe(true)
  })
})

describe('insertOrgVenue', () => {
  it('crea el lugar con la organización', async () => {
    const inserts = []
    const id = await insertOrgVenue(fakeSupabase({ inserts }), 7, { name: 'Nuevo', city: 'Talca' })
    expect(id).toBe('v-new')
    expect(inserts[0]).toMatchObject({ name: 'Nuevo', city: 'Talca', organization_id: 7, country_code: 'CL' })
  })

  it('sin la columna reintenta sin organization_id', async () => {
    const inserts = []
    const id = await insertOrgVenue(fakeSupabase({ hasOrgColumn: false, inserts }), 7, { name: 'Nuevo' })
    expect(id).toBe('v-new')
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).not.toHaveProperty('organization_id')
  })
})

describe('helpers', () => {
  it('isMissingColumnError reconoce Postgres y PostgREST', () => {
    expect(isMissingColumnError({ code: '42703', message: 'column venues.organization_id does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'organization_id' column of 'venues' in the schema cache" })).toBe(true)
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingColumnError(null)).toBe(false)
  })

  it('mergeVenues deduplica y ordena por nombre', () => {
    const merged = mergeVenues([{ id: 'b', name: 'Zeta', city: null }], [{ id: 'a', name: 'álamo', city: null }, { id: 'b', name: 'Zeta', city: null }])
    expect(merged.map((v) => v.id)).toEqual(['a', 'b'])
  })
})

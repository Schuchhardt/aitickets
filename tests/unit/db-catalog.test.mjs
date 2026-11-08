// Catálogo de la base (db/catalog.sql → db/catalog.snapshot.tsv) y detector de drift (scripts/db-drift.mjs).
// Lo que vive en la base y no en el repo no se puede testear: así pasó con el trigger de auth.users que causó el bug de
// "agregar miembro". Estas reglas obligan a que cada trigger esté en el repo Y tenga una prueba en db/ci/assert-*.sql.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { diffCatalogs, formatDiff, formatSnapshot, parseSnapshot } from '../../scripts/db-drift.mjs'

const snapshot = parseSnapshot(readFileSync('db/catalog.snapshot.tsv', 'utf8'))
const assertSql = readdirSync('db/ci')
  .filter((f) => /^assert-.+\.sql$/.test(f))
  .map((f) => readFileSync(`db/ci/${f}`, 'utf8'))
  .join('\n')

describe('db/catalog.snapshot.tsv', () => {
  it('incluye las tablas, el trigger de auth.users y handle_new_user', () => {
    expect(snapshot.size).toBeGreaterThan(1000)
    expect(snapshot.get('table:users')).toBe('rls=true force=false')
    expect(snapshot.get('trigger:auth.users.on_auth_user_created')).toBe(
      'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()',
    )
    expect(snapshot.get('function_grant:handle_new_user()')).toBe('service_role')
    // Las reglas de borrado de producción (antes la CI no las tenía)
    expect(snapshot.get('constraint:event_tickets.event_tickets_event_id_fkey')).toMatch(/ON DELETE CASCADE/)
    expect(snapshot.get('constraint:event_locations.event_locations_venue_id_fkey')).toMatch(/ON DELETE RESTRICT/)
    expect(snapshot.has('index:venues.venues_slug_key')).toBe(true)
  })

  it('cada trigger de AI Tickets tiene una prueba en db/ci/assert-*.sql', () => {
    const triggers = [...snapshot.keys()].filter((k) => k.startsWith('trigger:')).map((k) => k.split('.').pop())
    expect(triggers.length).toBeGreaterThanOrEqual(7)
    const untested = triggers.filter((name) => !assertSql.includes(name))
    expect(untested, `Triggers sin prueba en db/ci/assert-*.sql: ${untested.join(', ')}`).toEqual([])
  })

  it('cada función de trigger es SECURITY DEFINER solo si fija search_path', () => {
    const insecure = [...snapshot.entries()]
      .filter(([k, v]) => k.startsWith('function:') && v.includes('secdef=true') && !/config=.*search_path/.test(v))
      .map(([k]) => k)
    expect(insecure).toEqual([])
  })

  it('ninguna función de AI Tickets se puede ejecutar por anon/authenticated/PUBLIC', () => {
    const open = [...snapshot.entries()].filter(([k, v]) => k.startsWith('function_grant:') && /anon|authenticated|PUBLIC/.test(v)).map(([k]) => k)
    expect(open).toEqual([])
  })
})

describe('scripts/db-drift.mjs', () => {
  it('formatSnapshot/parseSnapshot conservan valores con tabs y saltos de línea, en orden', () => {
    const rows = [
      { key: 'policy:t.p', value: 'SELECT roles={x} using=(a\n AND b)\tcheck=-' },
      { key: 'column:t.a', value: 'text notnull=false default=-' },
    ]
    const text = formatSnapshot(rows)
    expect(text.split('\n').filter((l) => !l.startsWith('#'))[0]).toMatch(/^column:t\.a\t/)
    expect([...parseSnapshot(text)]).toEqual([['column:t.a', rows[1].value], ['policy:t.p', rows[0].value]])
  })

  it('diffCatalogs distingue lo creado a mano, lo que falta y lo distinto', () => {
    const expected = new Map([['trigger:a', 'X'], ['index:b', 'Y'], ['table:c', 'rls=true']])
    const actual = new Map([['trigger:a', 'X'], ['table:c', 'rls=false'], ['trigger:auth.users.manual', 'Z']])
    const diff = diffCatalogs(expected, actual)
    expect(diff.onlyInDb).toEqual([{ key: 'trigger:auth.users.manual', value: 'Z' }])
    expect(diff.missingInDb).toEqual([{ key: 'index:b', value: 'Y' }])
    expect(diff.changed).toEqual([{ key: 'table:c', expected: 'rls=true', actual: 'rls=false' }])
    expect(diff.total).toBe(3)
    const report = formatDiff(diff, { label: 'producción' })
    expect(report).toMatch(/SOLO en producción[\s\S]*trigger:auth\.users\.manual/)
    expect(report).toMatch(/Falta en producción[\s\S]*index:b/)
    expect(formatDiff(diffCatalogs(expected, expected))).toBe('')
  })
})

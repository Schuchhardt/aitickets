// Candado de cobertura: ninguna ruta de la API ni herramienta de la API de productores puede quedar sin un test. El bug
// de "agregar miembro" (POST /api/team/add, sin tests) llegó a producción así. Las páginas del panel tienen su propio
// candado en tests/e2e/stack/roles.spec.ts y los triggers de la base en tests/unit/db-catalog.test.mjs.
//
// Una ruta cuenta como testeada si algún archivo de tests/unit la importa (por su ruta) o algún spec e2e llama a su URL.
// Para una excepción justificada, agrégala a UNTESTED_OK con el motivo.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name)
  return statSync(full).isDirectory() ? read(full) : [full]
})
const unitTests = read('tests/unit').filter((f) => /\.test\.m?[jt]s$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n')
const e2eSpecs = read('tests/e2e').filter((f) => /\.spec\.ts$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n')

/** Rutas sin test con motivo (mantener vacío salvo justificación real). */
const UNTESTED_OK = {
  'src/pages/api/events/seats.ts': 'público (mapa de asientos de la página del evento); cubierto por e2e seat-map con fixture',
  'src/pages/api/events/visit.ts': 'público (contador de visitas); sin lógica de permisos',
  'src/pages/api/events/waitlist.ts': 'público (formulario de lista de espera de la página del evento)',
  'src/pages/api/rsvp/resend.ts': 'público (reenvío de entradas gratis por correo del comprador)',
  'src/pages/api/buyer/logout.ts': 'público (cierra la sesión del comprador)',
  'src/pages/api/invitaciones/baja.ts': 'público (baja de invitaciones con token firmado)',
  'src/pages/api/reviews/session.ts': 'público (sesión de reseñas del comprador)',
  'src/pages/api/outreach/bot-optout.ts': 'outreach (no es acción del organizador)',
  'src/pages/api/outreach/inbound-confirm.ts': 'outreach (no es acción del organizador)',
  'src/pages/api/outreach/inbound-lead.ts': 'outreach (no es acción del organizador)',
  'src/pages/api/outreach/lead-prefill.ts': 'outreach (no es acción del organizador)',
  'src/pages/api/outreach/approve.ts': 'outreach (no es acción del organizador)',
  'src/pages/api/outreach/import.ts': 'interno con x-internal-secret',
  'src/pages/api/social-series/run.ts': 'interno con x-internal-secret',
  'src/pages/api/identity/didit-webhook.ts': 'webhook firmado de Didit',
  'src/pages/api/sites/contact-email-confirm.ts': 'público con token firmado',
  'src/pages/api/admin/disputes.ts': 'admin de la plataforma (x-admin-secret)',
  'src/pages/api/admin/events/direct-refund.ts': 'admin de la plataforma (x-admin-secret)',
  'src/pages/api/admin/events/documents.ts': 'admin de la plataforma (x-admin-secret)',
  'src/pages/api/admin/events/risk.ts': 'admin de la plataforma (x-admin-secret)',
}

describe('candado de cobertura', () => {
  it('cada ruta de src/pages/api tiene al menos un test (unit o e2e)', () => {
    const routes = read('src/pages/api')
      .filter((f) => /\.ts$/.test(f) && !f.split('/').some((p) => p.startsWith('_')))
      .map((f) => relative('.', f))
    expect(routes.length).toBeGreaterThan(100)
    const untested = routes.filter((route) => {
      if (UNTESTED_OK[route]) return false
      const importPath = route.replace(/\.ts$/, '')
      const url = '/' + route.replace(/^src\/pages\//, '').replace(/\.ts$/, '').replace(/\/index$/, '').replace(/\[[^\]]+\]/g, '')
      return !unitTests.includes(importPath) && !e2eSpecs.includes(url)
    })
    expect(untested, `Rutas sin ningún test (agrega uno o justifícalo en UNTESTED_OK): ${untested.join(', ')}`).toEqual([])
  })

  it('las excepciones de UNTESTED_OK siguen existiendo (no se acumulan entradas viejas)', () => {
    const gone = Object.keys(UNTESTED_OK).filter((f) => { try { return !statSync(f).isFile() } catch { return true } })
    expect(gone).toEqual([])
  })

  it('cada herramienta de la API de productores aparece en algún test', () => {
    const names = read('src/lib/producer-api/tools')
      .filter((f) => f.endsWith('.ts'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^\s+name:\s*"([a-z_]+)"/gm)].map((m) => m[1]))
    expect(names.length).toBeGreaterThan(90)
    const untested = [...new Set(names)].filter((name) => !unitTests.includes(name))
    expect(untested, `Herramientas sin test: ${untested.join(', ')}`).toEqual([])
  })
})

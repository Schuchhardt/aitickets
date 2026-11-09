// Plugin de deploy plugins/db-migrate: migra producción y después compara su catálogo con db/catalog.snapshot.tsv.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runMigrations: vi.fn(), checkDrift: vi.fn() }))
vi.mock('../../scripts/migrate.mjs', () => ({ runMigrations: mocks.runMigrations }))
vi.mock('../../scripts/db-drift.mjs', () => ({ checkDrift: mocks.checkDrift }))

const { onPostBuild } = await import('../../plugins/db-migrate/index.js')

const utils = () => ({ build: { failBuild: vi.fn() }, status: { show: vi.fn() } })
const noDrift = { diff: { total: 0 }, report: '' }
const drift = { diff: { total: 1 }, report: 'Existe SOLO en producción:\n  + trigger:auth.users.manual' }

beforeEach(() => {
  vi.stubEnv('CONTEXT', 'production')
  vi.stubEnv('SUPABASE_DB_URL', 'postgresql://u:p@pooler.example:5432/postgres')
  vi.stubEnv('SLACK_WEBHOOK_URL', '')
  vi.stubEnv('DB_DRIFT_FAIL', '')
  vi.stubEnv('DB_DRIFT_CHECK', '')
  mocks.runMigrations.mockReset().mockResolvedValue({ applied: ['a.sql'], baselined: [] })
  mocks.checkDrift.mockReset().mockResolvedValue(noDrift)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('plugins/db-migrate', () => {
  it('fuera de producción no migra ni compara', async () => {
    vi.stubEnv('CONTEXT', 'deploy-preview')
    await onPostBuild({ utils: utils() })
    expect(mocks.runMigrations).not.toHaveBeenCalled()
    expect(mocks.checkDrift).not.toHaveBeenCalled()
  })

  it('migra y luego compara producción con el snapshot del repo', async () => {
    const u = utils()
    await onPostBuild({ utils: u })
    expect(mocks.runMigrations).toHaveBeenCalledTimes(1)
    expect(mocks.checkDrift).toHaveBeenCalledWith(expect.objectContaining({ databaseUrl: 'postgresql://u:p@pooler.example:5432/postgres', label: 'producción' }))
    expect(mocks.checkDrift.mock.calls[0][0].snapshotPath).toMatch(/db\/catalog\.snapshot\.tsv$/)
    expect(u.build.failBuild).not.toHaveBeenCalled()
  })

  it('con drift avisa en el resumen del deploy sin fallar (por defecto)', async () => {
    mocks.checkDrift.mockResolvedValue(drift)
    const u = utils()
    await onPostBuild({ utils: u })
    expect(u.status.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Drift de la base de datos', text: expect.stringContaining('trigger:auth.users.manual') }))
    expect(u.build.failBuild).not.toHaveBeenCalled()
  })

  it('DB_DRIFT_FAIL=true hace fallar el build si hay drift', async () => {
    vi.stubEnv('DB_DRIFT_FAIL', 'true')
    mocks.checkDrift.mockResolvedValue(drift)
    const u = utils()
    await onPostBuild({ utils: u })
    expect(u.build.failBuild).toHaveBeenCalledWith(expect.stringMatching(/db-drift/))
  })

  it('si la migración falla no compara (el build ya falló)', async () => {
    mocks.runMigrations.mockRejectedValue(new Error('boom'))
    const u = utils()
    await onPostBuild({ utils: u })
    expect(u.build.failBuild).toHaveBeenCalledWith(expect.stringMatching(/boom/), expect.anything())
    expect(mocks.checkDrift).not.toHaveBeenCalled()
  })

  it('un error al leer el catálogo no tumba el deploy', async () => {
    mocks.checkDrift.mockRejectedValue(new Error('timeout'))
    const u = utils()
    await onPostBuild({ utils: u })
    expect(u.build.failBuild).not.toHaveBeenCalled()
  })
})

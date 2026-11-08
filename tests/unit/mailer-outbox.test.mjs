// Buzón local del mailer (MAIL_OUTBOX_DIR) para los e2e con base real: escribe los correos en disco en vez de enviarlos
// por Resend. Nunca debe activarse en producción ni en un deploy de Netlify.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mailOutboxDir, sendEmail } = await import('../../netlify/lib/mailer.mjs')

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'outbox-'))
  vi.stubEnv('CONTEXT', '')
  vi.stubEnv('NETLIFY', '')
  vi.stubEnv('RESEND_API_KEY', 'test-key')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('MAIL_OUTBOX_DIR', () => {
  it('escribe el correo como JSON y no llama a Resend', async () => {
    vi.stubEnv('MAIL_OUTBOX_DIR', dir)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await sendEmail({ to: 'Ana <ana@e2e.test>', subject: 'Te invitaron', html: '<a href="https://x.test/invitacion/aitinv_abc">Unirme</a>' })
    expect(fetchSpy).not.toHaveBeenCalled()
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    const mail = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'))
    expect(mail).toMatchObject({ id: res.id, endpoint: '/emails', to: ['Ana <ana@e2e.test>'], subject: 'Te invitaron' })
    expect(mail.html).toContain('/invitacion/aitinv_abc')
  })

  it('nunca en producción ni en Netlify', () => {
    vi.stubEnv('MAIL_OUTBOX_DIR', dir)
    expect(mailOutboxDir()).toBe(dir)
    vi.stubEnv('CONTEXT', 'production')
    expect(mailOutboxDir()).toBeNull()
    vi.stubEnv('CONTEXT', '')
    vi.stubEnv('NETLIFY', 'true')
    expect(mailOutboxDir()).toBeNull()
  })

  it('sin MAIL_OUTBOX_DIR envía por Resend como siempre', async () => {
    vi.stubEnv('MAIL_OUTBOX_DIR', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 're_1' }), { status: 200 }))
    expect(await sendEmail({ to: 'ana@e2e.test', subject: 'Hola', text: 'hola' })).toEqual({ id: 're_1' })
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.resend.com/emails')
    expect(readdirSync(dir)).toHaveLength(0)
  })
})

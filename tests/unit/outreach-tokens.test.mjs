// Tokens firmados del outreach (netlify/lib/outreach/tokens.mjs), su re-export tipado
// (src/lib/lead-token.ts) y el token de verificación de correo de productores (src/lib/email-verification.ts).
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as mjs from '../../netlify/lib/outreach/tokens.mjs'
import * as ts from '../../src/lib/lead-token.ts'
import { emailHash, signEmailVerifyToken, verifyEmailVerifyToken } from '../../src/lib/email-verification.ts'

beforeEach(() => {
  vi.stubEnv('LEAD_TOKEN_SECRET', 'lead-secret-for-tests')
  vi.stubEnv('OUTREACH_UNSUB_SECRET', 'unsub-secret-for-tests')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** Cambia un carácter del medio de una parte del token (base64url). */
function tamper(token, part) {
  const parts = token.split('.')
  const s = parts[part]
  const i = Math.floor(s.length / 2)
  parts[part] = s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
  return parts.join('.')
}

describe('tokens de lead (registro)', () => {
  it('ida y vuelta', () => {
    const t = mjs.signLeadToken('123')
    expect(t).toMatch(/^[\w-]+\.[\w-]+$/)
    expect(mjs.verifyLeadToken(t)).toEqual({ leadId: '123' })
  })

  it('rechaza tokens alterados (payload o firma)', () => {
    const t = mjs.signLeadToken('123')
    expect(mjs.verifyLeadToken(tamper(t, 0))).toBeNull()
    expect(mjs.verifyLeadToken(tamper(t, 1))).toBeNull()
  })

  it('rechaza un payload re-firmado con otro secreto', () => {
    const body = Buffer.from(JSON.stringify({ p: 'l', l: '999', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')
    const mac = createHmac('sha256', 'otro-secreto').update(body).digest('base64url')
    expect(mjs.verifyLeadToken(`${body}.${mac}`)).toBeNull()
  })

  it('vence a los 30 días', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'))
    const t = mjs.signLeadToken('123')
    vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
    expect(mjs.verifyLeadToken(t)).toEqual({ leadId: '123' })
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
    expect(mjs.verifyLeadToken(t)).toBeNull()
  })

  it('basura, vacío o demasiado largo → null', () => {
    for (const bad of ['', 'abc', 'a.b.c', '.', 'x'.repeat(3000), null, undefined, 42]) {
      expect(mjs.verifyLeadToken(bad)).toBeNull()
    }
  })

  it('sin secreto: sign devuelve "" y verify null (falla cerrado)', () => {
    const t = mjs.signLeadToken('123')
    vi.stubEnv('LEAD_TOKEN_SECRET', '')
    expect(mjs.signLeadToken('123')).toBe('')
    expect(mjs.verifyLeadToken(t)).toBeNull()
  })
})

describe('propósitos separados', () => {
  it('un token de un tipo nunca sirve para otro, aunque compartan secreto', () => {
    const lead = mjs.signLeadToken('123')
    const approve = mjs.signApproveToken('123')
    expect(mjs.verifyApproveToken(lead)).toBeNull()
    expect(mjs.verifyLeadToken(approve)).toBeNull()
    expect(mjs.verifyApproveToken(approve)).toEqual({ messageId: '123' })
  })

  it('el token de baja usa su propio secreto', () => {
    const unsub = mjs.signUnsubToken('123', 'Ana@Teatro.cl')
    expect(mjs.verifyUnsubToken(unsub)).toEqual({ leadId: '123', email: 'ana@teatro.cl' })
    expect(mjs.verifyLeadToken(unsub)).toBeNull()
    vi.stubEnv('OUTREACH_UNSUB_SECRET', 'rotado')
    expect(mjs.verifyUnsubToken(unsub)).toBeNull()
  })

  it('el token de baja no vence (la ley exige que el enlace siga funcionando)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'))
    const unsub = mjs.signUnsubToken('123', 'ana@teatro.cl')
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'))
    expect(mjs.verifyUnsubToken(unsub)).toEqual({ leadId: '123', email: 'ana@teatro.cl' })
  })

  it('el token de aprobación vence a los 7 días', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'))
    const t = mjs.signApproveToken('m1')
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    expect(mjs.verifyApproveToken(t)).toBeNull()
  })
})

describe('compatibilidad TS ↔ MJS (src/lib/lead-token.ts re-exporta, no reimplementa)', () => {
  it('lo firmado en un lado se verifica en el otro', () => {
    expect(ts.verifyLeadToken(mjs.signLeadToken('55'))).toEqual({ leadId: '55' })
    expect(mjs.verifyLeadToken(ts.signLeadToken('55'))).toEqual({ leadId: '55' })
    expect(ts.verifyUnsubToken(mjs.signUnsubToken('55', 'a@b.cl'))).toEqual({ leadId: '55', email: 'a@b.cl' })
    expect(mjs.verifyApproveToken(ts.signApproveToken('m9'))).toEqual({ messageId: 'm9' })
  })

  it('son las mismas funciones', () => {
    expect(ts.verifyLeadToken).toBe(mjs.verifyLeadToken)
    expect(ts.signUnsubToken).toBe(mjs.signUnsubToken)
  })
})

describe('safeEqual', () => {
  it('compara en tiempo constante y rechaza vacíos', () => {
    expect(mjs.safeEqual('abc', 'abc')).toBe(true)
    expect(mjs.safeEqual('abc', 'abd')).toBe(false)
    expect(mjs.safeEqual('abc', 'abcd')).toBe(false)
    expect(mjs.safeEqual('', '')).toBe(false)
    expect(mjs.safeEqual(undefined, undefined)).toBe(false)
  })
})

describe('token de verificación de correo del productor', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_VERIFY_SECRET', 'email-verify-secret-for-tests')
  })

  it('ida y vuelta con hash del correo', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    const t = signEmailVerifyToken('uid-1', 'Ana@Teatro.cl', now)
    expect(verifyEmailVerifyToken(t, now)).toEqual({ ok: true, uid: 'uid-1', eh: emailHash('ana@teatro.cl'), next: null })
  })

  it('lleva el destino (next) firmado y descarta destinos externos', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    const ok = signEmailVerifyToken('uid-1', 'ana@teatro.cl', now, '/dashboard/ia')
    expect(verifyEmailVerifyToken(ok, now)).toMatchObject({ ok: true, next: '/dashboard/ia' })
    const oauth = signEmailVerifyToken('uid-1', 'ana@teatro.cl', now, '/oauth/authorize?client_id=x&state=y')
    expect(verifyEmailVerifyToken(oauth, now)).toMatchObject({ ok: true, next: '/oauth/authorize?client_id=x&state=y' })
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/organizadores', '/dashboard\\..']) {
      expect(verifyEmailVerifyToken(signEmailVerifyToken('uid-1', 'ana@teatro.cl', now, bad), now)).toMatchObject({ ok: true, next: null })
    }
  })

  it('vence a las 48 horas', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    const t = signEmailVerifyToken('uid-1', 'ana@teatro.cl', now)
    expect(verifyEmailVerifyToken(t, now + 47 * 3600_000).ok).toBe(true)
    expect(verifyEmailVerifyToken(t, now + 49 * 3600_000)).toEqual({ ok: false, error: 'expired' })
  })

  it('alterado, basura u otro secreto → invalid', () => {
    const now = Date.now()
    const t = signEmailVerifyToken('uid-1', 'ana@teatro.cl', now)
    expect(verifyEmailVerifyToken(tamper(t, 0), now)).toEqual({ ok: false, error: 'invalid' })
    expect(verifyEmailVerifyToken('basura', now)).toEqual({ ok: false, error: 'invalid' })
    vi.stubEnv('EMAIL_VERIFY_SECRET', 'otro')
    expect(verifyEmailVerifyToken(t, now)).toEqual({ ok: false, error: 'invalid' })
  })

  it('un token de lead del outreach no sirve como verificación de correo', () => {
    vi.stubEnv('LEAD_TOKEN_SECRET', 'email-verify-secret-for-tests')
    expect(verifyEmailVerifyToken(mjs.signLeadToken('uid-1')).ok).toBe(false)
  })
})

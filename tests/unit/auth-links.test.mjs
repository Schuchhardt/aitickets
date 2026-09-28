// Enlaces de acceso directo (recuperar / cambiar contraseña) y cookie de "fijar contraseña":
// firma, verificación, vencimiento, propósito y uso único. Lógica pura (sin red ni BD).
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AUTH_LINK_TTL_SECONDS,
  PW_RESET_TTL_SECONDS,
  authLinkKey,
  consumeAuthLinkToken,
  isAiticketsIdentity,
  isAuthLinkPurpose,
  isSameSitePost,
  sendAllowed,
  signAuthLinkToken,
  signPwResetCookie,
  verifyAuthLinkToken,
  verifyPwResetCookie,
} from '../../src/lib/magic-link.ts'
import { emailHash, signEmailVerifyToken } from '../../src/lib/email-verification.ts'

const KEY = Buffer.from('test-auth-link-key-0123456789abcdef')
const OTHER_KEY = Buffer.from('another-key-fedcba9876543210')
const UID = '11111111-2222-3333-4444-555555555555'
const EMAIL = 'Productora@Example.cl'
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0)

/** Store en memoria con la misma semántica que la tabla (PK jti). */
function memoryStore() {
  const used = new Map()
  return {
    used,
    async markUsed({ jti, uid, purpose, expiresAt }) {
      if (used.has(jti)) return 'used'
      used.set(jti, { uid, purpose, expiresAt })
      return 'ok'
    },
  }
}

const decodePayload = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
const resign = (payloadObj, key = KEY) => {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('signAuthLinkToken / verifyAuthLinkToken', () => {
  it('firma y verifica con uid, propósito, hash del correo, jti y vencimiento de 60 min', () => {
    const token = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY })
    const res = verifyAuthLinkToken(token, { now: NOW, key: KEY })
    expect(res.ok).toBe(true)
    expect(res.uid).toBe(UID)
    expect(res.purpose).toBe('recovery')
    expect(res.eh).toBe(emailHash('productora@example.cl'))
    expect(res.exp).toBe(Math.floor(NOW / 1000) + AUTH_LINK_TTL_SECONDS)
    expect(typeof res.jti).toBe('string')
    expect(res.jti.length).toBeGreaterThanOrEqual(16)
  })

  it('cada token tiene un jti distinto', () => {
    const a = verifyAuthLinkToken(signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY }), { now: NOW, key: KEY })
    const b = verifyAuthLinkToken(signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY }), { now: NOW, key: KEY })
    expect(a.jti).not.toBe(b.jti)
  })

  it('vence a los 60 minutos', () => {
    const token = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'change-password', now: NOW, key: KEY })
    expect(verifyAuthLinkToken(token, { now: NOW + 59 * 60 * 1000, key: KEY }).ok).toBe(true)
    expect(verifyAuthLinkToken(token, { now: NOW + 60 * 60 * 1000 + 1000, key: KEY })).toEqual({ ok: false, error: 'expired' })
  })

  it('rechaza firma alterada, otra clave, payload manipulado y basura', () => {
    const token = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY })
    const [payload, sig] = token.split('.')
    expect(verifyAuthLinkToken(`${payload}.${sig.slice(0, -2)}xx`, { now: NOW, key: KEY })).toEqual({ ok: false, error: 'invalid' })
    expect(verifyAuthLinkToken(token, { now: NOW, key: OTHER_KEY })).toEqual({ ok: false, error: 'invalid' })
    const tampered = Buffer.from(JSON.stringify({ ...decodePayload(token), uid: 'otro' })).toString('base64url')
    expect(verifyAuthLinkToken(`${tampered}.${sig}`, { now: NOW, key: KEY })).toEqual({ ok: false, error: 'invalid' })
    for (const bad of ['', 'abc', 'a.b.c', null, undefined, 123, 'x'.repeat(3000)]) {
      expect(verifyAuthLinkToken(bad, { now: NOW, key: KEY }).ok).toBe(false)
    }
  })

  it('exige el propósito pedido y rechaza propósitos desconocidos aunque estén bien firmados', () => {
    const token = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'change-password', now: NOW, key: KEY })
    expect(verifyAuthLinkToken(token, { now: NOW, key: KEY, purpose: 'change-password' }).ok).toBe(true)
    expect(verifyAuthLinkToken(token, { now: NOW, key: KEY, purpose: 'recovery' })).toEqual({ ok: false, error: 'invalid' })
    const forged = resign({ ...decodePayload(token), pu: 'admin' })
    expect(verifyAuthLinkToken(forged, { now: NOW, key: KEY })).toEqual({ ok: false, error: 'invalid' })
    expect(() => signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'admin', key: KEY })).toThrow()
    expect(isAuthLinkPurpose('recovery')).toBe(true)
    expect(isAuthLinkPurpose('nope')).toBe(false)
  })

  it('rechaza un token sin jti o de otro tipo firmado con la misma clave', () => {
    const base = decodePayload(signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY }))
    expect(verifyAuthLinkToken(resign({ ...base, jti: '' }), { now: NOW, key: KEY }).ok).toBe(false)
    expect(verifyAuthLinkToken(resign({ ...base, p: 'pw_reset' }), { now: NOW, key: KEY }).ok).toBe(false)
  })

  it('la clave se deriva del entorno y es distinta a la de verificación de correo', () => {
    vi.stubEnv('EMAIL_VERIFY_SECRET', 'secreto-de-prueba')
    const token = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery' })
    expect(verifyAuthLinkToken(token).ok).toBe(true)
    // Un token de verificación de correo (misma variable) nunca sirve como enlace de acceso
    const verify = signEmailVerifyToken(UID, EMAIL)
    expect(verifyAuthLinkToken(verify)).toEqual({ ok: false, error: 'invalid' })
    expect(authLinkKey().equals(Buffer.from('secreto-de-prueba'))).toBe(false)
  })

  it('sin ningún secreto configurado, firmar lanza y verificar responde inválido', () => {
    expect(() => signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery' })).toThrow(/EMAIL_VERIFY_SECRET/)
    expect(verifyAuthLinkToken('a.b')).toEqual({ ok: false, error: 'invalid' })
  })
})

describe('consumeAuthLinkToken (uso único)', () => {
  it('la primera vez consume y la segunda responde used', async () => {
    const store = memoryStore()
    const token = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY })
    const first = await consumeAuthLinkToken(token, store, { now: NOW, key: KEY })
    expect(first.ok).toBe(true)
    expect(store.used.get(first.jti)).toMatchObject({ uid: UID, purpose: 'recovery' })
    expect(store.used.get(first.jti).expiresAt.getTime()).toBe(first.exp * 1000)
    expect(await consumeAuthLinkToken(token, store, { now: NOW + 1000, key: KEY })).toEqual({ ok: false, error: 'used' })
  })

  it('no registra tokens inválidos o vencidos', async () => {
    const store = memoryStore()
    const token = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY })
    expect(await consumeAuthLinkToken(token, store, { now: NOW + 2 * 3600 * 1000, key: KEY })).toEqual({ ok: false, error: 'expired' })
    expect(await consumeAuthLinkToken('basura', store, { now: NOW, key: KEY })).toEqual({ ok: false, error: 'invalid' })
    expect(store.used.size).toBe(0)
  })

  it('si el store no puede registrar el uso, falla cerrado', async () => {
    const token = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY })
    const res = await consumeAuthLinkToken(token, { markUsed: async () => 'unavailable' }, { now: NOW, key: KEY })
    expect(res).toEqual({ ok: false, error: 'server' })
  })

  it('dos tokens distintos del mismo usuario se consumen por separado', async () => {
    const store = memoryStore()
    const a = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY })
    const b = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY })
    expect((await consumeAuthLinkToken(a, store, { now: NOW, key: KEY })).ok).toBe(true)
    expect((await consumeAuthLinkToken(b, store, { now: NOW, key: KEY })).ok).toBe(true)
  })
})

describe('cookie aitickets_pw_reset', () => {
  it('vale 15 minutos y solo para el mismo uid', () => {
    const cookie = signPwResetCookie(UID, { now: NOW, key: KEY })
    expect(verifyPwResetCookie(cookie, UID, { now: NOW, key: KEY })).toBe(true)
    expect(verifyPwResetCookie(cookie, UID, { now: NOW + (PW_RESET_TTL_SECONDS - 1) * 1000, key: KEY })).toBe(true)
    expect(verifyPwResetCookie(cookie, UID, { now: NOW + (PW_RESET_TTL_SECONDS + 1) * 1000, key: KEY })).toBe(false)
    expect(verifyPwResetCookie(cookie, 'otro-uid', { now: NOW, key: KEY })).toBe(false)
    expect(verifyPwResetCookie(cookie, UID, { now: NOW, key: OTHER_KEY })).toBe(false)
  })

  it('un enlace de acceso no sirve como cookie ni al revés', () => {
    const link = signAuthLinkToken({ uid: UID, email: EMAIL, purpose: 'recovery', now: NOW, key: KEY })
    expect(verifyPwResetCookie(link, UID, { now: NOW, key: KEY })).toBe(false)
    const cookie = signPwResetCookie(UID, { now: NOW, key: KEY })
    expect(verifyAuthLinkToken(cookie, { now: NOW, key: KEY }).ok).toBe(false)
  })

  it('rechaza valores vacíos o manipulados', () => {
    for (const bad of [undefined, null, '', 'a.b', 42]) expect(verifyPwResetCookie(bad, UID, { now: NOW, key: KEY })).toBe(false)
    expect(verifyPwResetCookie(signPwResetCookie(UID, { now: NOW, key: KEY }), '', { now: NOW, key: KEY })).toBe(false)
  })
})

describe('isAiticketsIdentity (contrato R5)', () => {
  it('acepta cuentas creadas por AI Tickets o con fila en public.users', () => {
    expect(isAiticketsIdentity({ app_metadata: { app: 'aitickets' } }, false)).toBe(true)
    expect(isAiticketsIdentity({ app_metadata: {} }, true)).toBe(true)
    expect(isAiticketsIdentity({ app_metadata: { app: 'otra-app' } }, false)).toBe(false)
    expect(isAiticketsIdentity(null, true)).toBe(false)
  })
})

describe('isSameSitePost', () => {
  const page = new URL('https://aitickets.cl/auth/link')
  const req = (headers) => new Request('https://aitickets.cl/auth/link', { method: 'POST', headers })
  it('acepta el mismo origen y navegadores sin Origin', () => {
    expect(isSameSitePost(req({ origin: 'https://aitickets.cl' }), page)).toBe(true)
    expect(isSameSitePost(req({}), page)).toBe(true)
    expect(isSameSitePost(req({ 'sec-fetch-site': 'same-origin' }), page)).toBe(true)
  })
  it('rechaza POST de otro sitio (login CSRF)', () => {
    expect(isSameSitePost(req({ origin: 'https://evil.example' }), page)).toBe(false)
    expect(isSameSitePost(req({ origin: 'null' }), page)).toBe(false)
    expect(isSameSitePost(req({ 'sec-fetch-site': 'cross-site' }), page)).toBe(false)
  })
})

describe('sendAllowed (límite durable por cuenta)', () => {
  const at = (msAgo) => new Date(NOW - msAgo).toISOString()

  it('permite el primer envío', () => {
    expect(sendAllowed([{ id: 1, sent_at: at(0) }], 1, { now: NOW })).toBe(true)
  })
  it('rechaza si hubo otro envío hace menos de 60 s', () => {
    expect(sendAllowed([{ id: 1, sent_at: at(30_000) }, { id: 2, sent_at: at(0) }], 2, { now: NOW })).toBe(false)
  })
  it('entre intentos simultáneos gana el de id menor', () => {
    const rows = [{ id: 5, sent_at: at(0) }, { id: 6, sent_at: at(0) }]
    expect(sendAllowed(rows, 5, { now: NOW })).toBe(true)
    expect(sendAllowed(rows, 6, { now: NOW })).toBe(false)
  })
  it('rechaza el cuarto envío de la hora', () => {
    const rows = [
      { id: 1, sent_at: at(50 * 60_000) },
      { id: 2, sent_at: at(30 * 60_000) },
      { id: 3, sent_at: at(10 * 60_000) },
      { id: 4, sent_at: at(0) },
    ]
    expect(sendAllowed(rows, 4, { now: NOW })).toBe(false)
    expect(sendAllowed(rows.slice(1), 4, { now: NOW })).toBe(true)
  })
})

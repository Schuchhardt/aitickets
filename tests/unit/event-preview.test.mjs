// Links privados de vista previa de eventos (src/lib/eventPreview.ts) y sus herramientas en la API de
// productores (create_preview_link, list_preview_links, revoke_preview_link, preview_url de create_event).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const preview = await import('../../src/lib/eventPreview.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
const ORIGIN = 'https://aitickets.cl'

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora' }, { id: 8, public_name: 'Otra' }],
      events: [
        { id: 10, name: 'Fiesta', slug: 'fiesta-1234', status: 'draft', organization_id: 7 },
        { id: 11, name: 'Publicado', slug: 'pub-1', status: 'published', organization_id: 7 },
        { id: 20, name: 'Ajeno', slug: 'ajeno-1', status: 'draft', organization_id: 8 },
      ],
      aitickets_event_preview_links: [],
      aitickets_api_audit: [],
    },
  })
})

const tokenOf = (url) => url.split('/').pop()
const create = (opts = {}) => preview.createPreviewLink({ eventId: 10, orgId: 7, origin: ORIGIN, ...opts })

describe('createPreviewLink', () => {
  it('genera una URL con token y guarda solo su hash', async () => {
    const { url, link } = await create()
    expect(url).toMatch(/^https:\/\/aitickets\.cl\/eventos\/vista-previa\/pv_[A-Za-z0-9_-]{40,}$/)
    const row = db.tables.aitickets_event_preview_links[0]
    expect(row.token_hash).toBe(preview.sha256Hex(tokenOf(url)))
    expect(JSON.stringify(row)).not.toContain(tokenOf(url))
    expect(link).toMatchObject({ status: 'active', single_use: false })
    // 7 días por defecto
    const hours = (new Date(row.expires_at).getTime() - Date.now()) / 3600000
    expect(hours).toBeGreaterThan(167)
    expect(hours).toBeLessThanOrEqual(168)
  })

  it('sin vencimiento y validación del rango', async () => {
    const { link } = await create({ expiresInHours: null })
    expect(link.expires_at).toBeNull()
    await expect(create({ expiresInHours: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(create({ expiresInHours: 9000 })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('resolvePreviewToken', () => {
  it('link de varios usos: funciona muchas veces y cuenta visitas', async () => {
    const { url } = await create()
    for (let i = 0; i < 3; i++) {
      const r = await preview.resolvePreviewToken(tokenOf(url), { userAgent: BROWSER })
      expect(r).toMatchObject({ ok: true, eventId: 10, orgId: 7 })
      expect(r.setCookie).toBeUndefined()
    }
  })

  it('link de un solo uso: queda atado al primer navegador (cookie) y rechaza a los demás', async () => {
    const { url } = await create({ singleUse: true })
    const token = tokenOf(url)
    const first = await preview.resolvePreviewToken(token, { userAgent: BROWSER })
    expect(first.ok).toBe(true)
    expect(first.setCookie.name).toBe(preview.previewCookieName(token))
    // El mismo navegador (con la cookie) puede recargar
    expect(await preview.resolvePreviewToken(token, { userAgent: BROWSER, cookieNonce: first.setCookie.value })).toMatchObject({ ok: true })
    // Otro navegador no
    expect(await preview.resolvePreviewToken(token, { userAgent: BROWSER })).toEqual({ ok: false, reason: 'used' })
    expect(await preview.resolvePreviewToken(token, { userAgent: BROWSER, cookieNonce: 'otro' })).toEqual({ ok: false, reason: 'used' })
  })

  it('los bots de vista previa de links no consumen ni ven el evento', async () => {
    const { url } = await create({ singleUse: true })
    const token = tokenOf(url)
    expect(await preview.resolvePreviewToken(token, { userAgent: 'WhatsApp/2.23.20.0' })).toEqual({ ok: false, reason: 'bot' })
    expect(await preview.resolvePreviewToken(token, { userAgent: 'Slackbot-LinkExpanding 1.0' })).toEqual({ ok: false, reason: 'bot' })
    expect(db.tables.aitickets_event_preview_links[0].consumed_at).toBeUndefined()
    expect(await preview.resolvePreviewToken(token, { userAgent: BROWSER })).toMatchObject({ ok: true })
  })

  it('vencido, revocado o inexistente', async () => {
    const { url } = await create({ expiresInHours: 1 })
    db.tables.aitickets_event_preview_links[0].expires_at = new Date(Date.now() - 1000).toISOString()
    expect(await preview.resolvePreviewToken(tokenOf(url), { userAgent: BROWSER })).toEqual({ ok: false, reason: 'expired' })

    const other = await create({ expiresInHours: null })
    expect(await preview.revokePreviewLink(other.link.id, 7)).toBe(true)
    expect(await preview.resolvePreviewToken(tokenOf(other.url), { userAgent: BROWSER })).toEqual({ ok: false, reason: 'revoked' })

    expect(await preview.resolvePreviewToken('pv_' + 'a'.repeat(43), { userAgent: BROWSER })).toEqual({ ok: false, reason: 'not_found' })
    expect(await preview.resolvePreviewToken('../../etc', { userAgent: BROWSER })).toEqual({ ok: false, reason: 'not_found' })
  })

  it('no se puede revocar un link de otra organización', async () => {
    const { link } = await create()
    expect(await preview.revokePreviewLink(link.id, 8)).toBe(false)
    expect(db.tables.aitickets_event_preview_links[0].revoked_at).toBeUndefined()
  })
})

describe('herramientas de la API de productores', () => {
  const ctx = (orgId = 7, scopes = ['read', 'write', 'publish']) => ({
    supabase: db,
    actor: { keyId: 'k1', userId: 1, orgId, role: 'producer', name: 'Ana', email: 'ana@prod.cl', scopes },
    origin: ORIGIN,
    requestUrl: new URL(`${ORIGIN}/api/mcp`),
    channel: 'mcp',
  })
  const run = (name, args, c = ctx()) => runTool(getTool(name), args, c)

  it('create_preview_link: borrador, opciones y aviso explícito', async () => {
    const res = await run('create_preview_link', { event_id: 10, single_use: true, no_expiration: true, label: 'Artista' })
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({
      event_id: 10,
      event_status: 'draft',
      is_published: false,
      public_url: null,
      link: { single_use: true, expires_at: null, label: 'Artista', created_via: 'mcp' },
    })
    expect(res.result.preview_url).toMatch(/\/eventos\/vista-previa\/pv_/)
    expect(res.result.note).toMatch(/BORRADOR/)
  })

  it('create_preview_link respeta expires_in_hours y la organización', async () => {
    const res = await run('create_preview_link', { event_id: 10, expires_in_hours: 2 })
    const hours = (new Date(res.result.link.expires_at).getTime() - Date.now()) / 3600000
    expect(hours).toBeGreaterThan(1.9)
    expect(hours).toBeLessThanOrEqual(2)
    expect(await run('create_preview_link', { event_id: 20 })).toMatchObject({ ok: false, code: 'not_found' })
    expect(await run('create_preview_link', { event_id: 10 }, ctx(7, ['read']))).toMatchObject({ ok: false, code: 'forbidden' })
  })

  it('list_preview_links y revoke_preview_link', async () => {
    const created = await run('create_preview_link', { event_id: 10 })
    const list = await run('list_preview_links', { event_id: 10 })
    expect(list.result.links).toHaveLength(1)
    expect(JSON.stringify(list.result)).not.toContain('pv_')
    expect(await run('revoke_preview_link', { link_id: created.result.link.id }, ctx(8))).toMatchObject({ ok: false, code: 'not_found' })
    expect(await run('revoke_preview_link', { link_id: created.result.link.id })).toMatchObject({ ok: true, result: { status: 'revoked' } })
    const after = await run('list_preview_links', { event_id: 10 })
    expect(after.result.links[0].status).toBe('revoked')
  })

  it('evento publicado: public_url activo', async () => {
    const res = await run('create_preview_link', { event_id: 11 })
    expect(res.result).toMatchObject({ is_published: true, public_url: `${ORIGIN}/eventos/pub-1` })
  })
})

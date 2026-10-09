// OAuth 2.1 de la API de productores: registro dinámico, CIMD, consentimiento, PKCE, canje de código de un
// solo uso, refresh rotativo, revocación y rutas HTTP. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  EVENT_MANAGER_ROLES: ['admin', 'producer', 'editor'],
  ORG_ADMIN_ROLES: ['admin', 'producer'],
  getSessionContext: async () => session,
  hasRole: (u, roles) => roles.includes(u?.role),
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

const oauth = await import('../../src/lib/producer-api/oauth.ts')
const { authenticateApiKey } = await import('../../src/lib/producer-api/keys.ts')
const tokenRoute = await import('../../src/pages/api/oauth/token.ts')
const registerRoute = await import('../../src/pages/api/oauth/register.ts')
const authorizeRoute = await import('../../src/pages/api/oauth/authorize.ts')
const asMeta = await import('../../src/pages/.well-known/oauth-authorization-server.ts')
const prMeta = await import('../../src/pages/.well-known/oauth-protected-resource/[...path].ts')
const mcpRoute = await import('../../src/pages/api/mcp.ts')
const apiKeysRoute = await import('../../src/pages/api/api-keys/index.ts')

const ORIGIN = 'https://aitickets.test'
const VERIFIER = 'dBjftJeZ4CVP-mJ92IVOLL7Uz8uTgxlvvzCHvnkhsOU'
const CHALLENGE = '9UDv9BlYCZcYgA6ZtUz0Bxc47aaYMuvSJ9S_JfrwjYw'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

beforeEach(() => {
  session = { dbUser: { id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer' } }
  db = createFakeSupabase({
    tables: {
      organizations: [{ id: 7, public_name: 'Mi Productora' }],
      users: [{ id: 1, name: 'Ana', email: 'ana@prod.cl', organization_id: 7, role: 'producer', active: true }],
      events: [{ id: 10, name: 'Fiesta', slug: 'fiesta', status: 'draft', organization_id: 7 }],
      aitickets_oauth_clients: [],
      aitickets_oauth_codes: [],
      aitickets_oauth_grants: [],
      aitickets_api_keys: [],
      aitickets_api_audit: [],
    },
  })
})

const authorizeParams = (clientId, extra = {}) => new URLSearchParams({
  response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
  code_challenge_method: 'S256', state: 'xyz', scope: 'read write', resource: `${ORIGIN}/api/mcp`, ...extra,
})

async function registerPublicClient() {
  return oauth.registerClient(db, { client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' })
}

async function obtainCode(clientId, scopes = ['read', 'write']) {
  const v = await oauth.validateAuthorizeParams(db, authorizeParams(clientId), ORIGIN)
  expect(v.ok).toBe(true)
  const location = await oauth.createAuthorizationCode(db, v.req, { id: 1, organization_id: 7 }, scopes, ORIGIN)
  const u = new URL(location)
  expect(u.searchParams.get('state')).toBe('xyz')
  expect(u.searchParams.get('iss')).toBe(ORIGIN)
  return u.searchParams.get('code')
}

describe('validaciones', () => {
  it('redirect_uri: https, loopback http y esquemas de app; nunca javascript/data ni http remoto', () => {
    for (const ok of [REDIRECT, 'http://localhost:3334/callback', 'http://127.0.0.1/cb', 'cursor://anysphere.cursor-retrieval/oauth/callback']) {
      expect(oauth.isValidRedirectUri(ok), ok).toBe(true)
    }
    for (const bad of ['http://evil.com/cb', 'javascript:alert(1)', 'data:text/html,x', 'https://x.com/cb#frag', 'not a url', 'file:///etc/passwd']) {
      expect(oauth.isValidRedirectUri(bad), bad).toBe(false)
    }
  })

  it('loopback acepta cualquier puerto (RFC 8252); el resto exige coincidencia exacta', () => {
    expect(oauth.redirectUriMatches('http://localhost:5555/callback', ['http://localhost:3000/callback'])).toBe(true)
    expect(oauth.redirectUriMatches('http://localhost:5555/otro', ['http://localhost:3000/callback'])).toBe(false)
    expect(oauth.redirectUriMatches('https://claude.ai/api/mcp/auth_callback?x=1', [REDIRECT])).toBe(false)
  })

  it('PKCE S256', () => {
    expect(oauth.verifyPkce(VERIFIER, CHALLENGE)).toBe(true)
    expect(oauth.verifyPkce(VERIFIER.replace('d', 'e'), CHALLENGE)).toBe(false)
    expect(oauth.verifyPkce('corto', CHALLENGE)).toBe(false)
  })

  it('metadatos RFC 8414 / RFC 9728', async () => {
    const as = await (await asMeta.GET({ request: new Request(`${ORIGIN}/.well-known/oauth-authorization-server`) })).json()
    expect(as).toMatchObject({ issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/oauth/authorize`, code_challenge_methods_supported: ['S256'] })
    const pr = await (await prMeta.GET({ params: { path: 'api/mcp' }, request: new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`) })).json()
    expect(pr).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] })
    expect((await prMeta.GET({ params: { path: 'otra' }, request: new Request(`${ORIGIN}/x`) })).status).toBe(404)
  })

  it('/api/mcp sin token anuncia resource_metadata para descubrir OAuth', async () => {
    const res = await mcpRoute.POST({ request: new Request(`${ORIGIN}/api/mcp`, { method: 'POST', body: '{}' }) })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`)
  })
})

describe('registro y autorización', () => {
  it('registro dinámico: cliente público sin secreto; confidencial con secreto (guardado como hash)', async () => {
    const pub = await registerPublicClient()
    expect(pub.client_id).toMatch(/^aitc_/)
    expect(pub.client_secret).toBeUndefined()
    const conf = await oauth.registerClient(db, { client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'client_secret_post' })
    expect(conf.client_secret).toMatch(/^aits_/)
    expect(JSON.stringify(db.tables.aitickets_oauth_clients)).not.toContain(conf.client_secret)
    await expect(oauth.registerClient(db, { redirect_uris: ['http://evil.com/cb'] })).rejects.toThrow(/redirect_uris/)
  })

  it('client_id desconocido o redirect_uri distinto: error sin redirigir', async () => {
    expect(await oauth.validateAuthorizeParams(db, authorizeParams('aitc_nope'), ORIGIN)).toHaveProperty('fatal')
    const { client_id } = await registerPublicClient()
    expect(await oauth.validateAuthorizeParams(db, authorizeParams(client_id, { redirect_uri: 'https://evil.com/cb' }), ORIGIN)).toHaveProperty('fatal')
  })

  it('sin PKCE o con resource ajeno: error devuelto al cliente por su redirect_uri', async () => {
    const { client_id } = await registerPublicClient()
    const noPkce = await oauth.validateAuthorizeParams(db, authorizeParams(client_id, { code_challenge_method: 'plain' }), ORIGIN)
    expect(noPkce.redirectError).toMatchObject({ error: 'invalid_request', redirectUri: REDIRECT, state: 'xyz' })
    const foreign = await oauth.validateAuthorizeParams(db, authorizeParams(client_id, { resource: 'https://otro.com/mcp' }), ORIGIN)
    expect(foreign.redirectError.error).toBe('invalid_target')
  })

  it('Client ID Metadata Document: client_id https con sus redirect_uris', async () => {
    const url = 'https://8.8.8.8/oauth/client.json'
    const fetchImpl = async () => new Response(JSON.stringify({ client_id: url, client_name: 'Claude', redirect_uris: [REDIRECT] }), { status: 200 })
    const client = await oauth.resolveClient(db, url, fetchImpl)
    expect(client).toMatchObject({ client_id: url, client_name: 'Claude', source: 'metadata_document' })
    const mismatched = async () => new Response(JSON.stringify({ client_id: 'https://otro', redirect_uris: [REDIRECT] }), { status: 200 })
    expect(await oauth.resolveClient(db, url, mismatched)).toBeNull()
    expect(await oauth.resolveClient(db, 'https://127.0.0.1/client.json', fetchImpl)).toBeNull()
  })
})

describe('tokens', () => {
  it('flujo completo: código → tokens → la API acepta el access token con los scopes autorizados', async () => {
    const client = await oauth.resolveClient(db, (await registerPublicClient()).client_id)
    const code = await obtainCode(client.client_id, ['read', 'publish'])
    const tokens = await oauth.exchangeAuthorizationCode(db, client, { code, redirectUri: REDIRECT, codeVerifier: VERIFIER })
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read publish' })
    const auth = await authenticateApiKey(db, tokens.access_token)
    expect(auth.ok).toBe(true)
    expect(auth.actor).toMatchObject({ userId: 1, orgId: 7, scopes: ['read', 'publish'] })
    expect(db.tables.aitickets_api_keys[0].oauth_grant_id).toBe(db.tables.aitickets_oauth_grants[0].id)
    // Nada en claro en la BD
    const dump = JSON.stringify(db.tables)
    expect(dump).not.toContain(tokens.access_token)
    expect(dump).not.toContain(tokens.refresh_token)
    expect(dump).not.toContain(code)
  })

  it('el código es de un solo uso y exige el code_verifier correcto', async () => {
    const client = await oauth.resolveClient(db, (await registerPublicClient()).client_id)
    const code = await obtainCode(client.client_id)
    await expect(oauth.exchangeAuthorizationCode(db, client, { code, redirectUri: REDIRECT, codeVerifier: 'x'.repeat(43) })).rejects.toThrow(/PKCE/)
    // el intento fallido consumió el código
    await expect(oauth.exchangeAuthorizationCode(db, client, { code, redirectUri: REDIRECT, codeVerifier: VERIFIER })).rejects.toThrow(/ya fue usado/)
  })

  it('un código no sirve para otro cliente ni con otro redirect_uri', async () => {
    const a = await oauth.resolveClient(db, (await registerPublicClient()).client_id)
    const b = await oauth.resolveClient(db, (await registerPublicClient()).client_id)
    const code = await obtainCode(a.client_id)
    await expect(oauth.exchangeAuthorizationCode(db, b, { code, redirectUri: REDIRECT, codeVerifier: VERIFIER })).rejects.toThrow(/no pertenece/)
    const code2 = await obtainCode(a.client_id)
    await expect(oauth.exchangeAuthorizationCode(db, a, { code: code2, redirectUri: 'https://claude.ai/otro', codeVerifier: VERIFIER })).rejects.toThrow(/redirect_uri/)
  })

  it('refresh rota el token: el anterior deja de servir; no se pueden ampliar scopes', async () => {
    const client = await oauth.resolveClient(db, (await registerPublicClient()).client_id)
    const tokens = await oauth.exchangeAuthorizationCode(db, client, { code: await obtainCode(client.client_id), redirectUri: REDIRECT, codeVerifier: VERIFIER })
    const next = await oauth.refreshAccessToken(db, client, tokens.refresh_token, null)
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    expect((await authenticateApiKey(db, next.access_token)).ok).toBe(true)
    await expect(oauth.refreshAccessToken(db, client, tokens.refresh_token, null)).rejects.toThrow(/no es válido/)
    await expect(oauth.refreshAccessToken(db, client, next.refresh_token, 'publish attendees')).rejects.toThrow(/exceden/)
    const narrowed = await oauth.refreshAccessToken(db, client, next.refresh_token, 'read')
    expect(narrowed.scope).toBe('read')
  })

  it('si el usuario se desactiva, el refresh revoca la conexión', async () => {
    const client = await oauth.resolveClient(db, (await registerPublicClient()).client_id)
    const tokens = await oauth.exchangeAuthorizationCode(db, client, { code: await obtainCode(client.client_id), redirectUri: REDIRECT, codeVerifier: VERIFIER })
    db.tables.users[0].active = false
    await expect(oauth.refreshAccessToken(db, client, tokens.refresh_token, null)).rejects.toThrow(/ya no tiene acceso/)
    expect(db.tables.aitickets_oauth_grants[0].revoked_at).not.toBeNull()
    expect(db.tables.aitickets_api_keys[0].revoked_at).not.toBeNull()
  })

  it('desconectar la app desde el panel invalida sus access tokens', async () => {
    const client = await oauth.resolveClient(db, (await registerPublicClient()).client_id)
    const tokens = await oauth.exchangeAuthorizationCode(db, client, { code: await obtainCode(client.client_id), redirectUri: REDIRECT, codeVerifier: VERIFIER })
    // en Postgres el id del grant es uuid (el fake genera números)
    const uuid = '22222222-2222-2222-2222-222222222222'
    db.tables.aitickets_oauth_grants[0].id = uuid
    db.tables.aitickets_api_keys[0].oauth_grant_id = uuid
    const list = await (await apiKeysRoute.GET({ request: new Request(`${ORIGIN}/api/api-keys`), url: new URL(`${ORIGIN}/api/api-keys`) })).json()
    expect(list.keys).toHaveLength(0) // los access tokens OAuth no se listan como llaves
    expect(list.connections).toEqual([expect.objectContaining({ name: 'Claude', scopes: ['read', 'write'] })])
    const grantId = list.connections[0].id
    const del = await apiKeysRoute.DELETE({ request: new Request(`${ORIGIN}/api/api-keys?grant=${grantId}`, { method: 'DELETE' }), url: new URL(`${ORIGIN}/api/api-keys?grant=${grantId}`) })
    expect(del.status).toBe(200)
    expect((await authenticateApiKey(db, tokens.access_token)).ok).toBe(false)
  })

  it('cliente confidencial: exige su secreto', async () => {
    const reg = await oauth.registerClient(db, { client_name: 'ChatGPT', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' })
    const client = await oauth.resolveClient(db, reg.client_id)
    expect(() => oauth.authenticateClient(client, null)).toThrow(/Autenticación/)
    expect(() => oauth.authenticateClient(client, 'aits_mal')).toThrow(/Autenticación/)
    expect(() => oauth.authenticateClient(client, reg.client_secret)).not.toThrow()
  })
})

describe('rutas HTTP', () => {
  it('/api/oauth/register + consentimiento + /api/oauth/token (form-urlencoded)', async () => {
    const reg = await (await registerRoute.POST({ request: new Request(`${ORIGIN}/api/oauth/register`, { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }) }) })).json()

    const form = new FormData()
    form.set('params', authorizeParams(reg.client_id).toString())
    form.set('decision', 'allow')
    form.append('scope', 'read')
    form.append('scope', 'attendees')
    const redirect = (location, status) => new Response(null, { status, headers: { Location: location } })
    const consent = await authorizeRoute.POST({ request: new Request(`${ORIGIN}/api/oauth/authorize`, { method: 'POST', body: form }), url: new URL(`${ORIGIN}/api/oauth/authorize`), redirect })
    expect(consent.status).toBe(303)
    const location = new URL(consent.headers.get('location'))
    expect(location.origin + location.pathname).toBe(REDIRECT)
    const code = location.searchParams.get('code')

    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: VERIFIER })
    const res = await tokenRoute.POST({ request: new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.json()).scope).toBe('read attendees')

    const again = await tokenRoute.POST({ request: new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }) })
    expect(again.status).toBe(400)
    expect((await again.json()).error).toBe('invalid_grant')
  })

  it('cancelar en el consentimiento devuelve access_denied al cliente', async () => {
    const { client_id } = await registerPublicClient()
    const form = new FormData()
    form.set('params', authorizeParams(client_id).toString())
    form.set('decision', 'deny')
    const redirect = (location, status) => new Response(null, { status, headers: { Location: location } })
    const res = await authorizeRoute.POST({ request: new Request(`${ORIGIN}/api/oauth/authorize`, { method: 'POST', body: form }), url: new URL(`${ORIGIN}/api/oauth/authorize`), redirect })
    expect(new URL(res.headers.get('location')).searchParams.get('error')).toBe('access_denied')
    expect(db.tables.aitickets_oauth_codes).toHaveLength(0)
  })

  it('un rol sin acceso a la API no puede autorizar apps', async () => {
    session = { dbUser: { id: 2, organization_id: 7, role: 'guest' } }
    const form = new FormData()
    form.set('params', '')
    const res = await authorizeRoute.POST({ request: new Request(`${ORIGIN}/api/oauth/authorize`, { method: 'POST', body: form }), url: new URL(`${ORIGIN}/api/oauth/authorize`), redirect: () => null })
    expect(res.status).toBe(403)
  })

  it('grant_type desconocido y cliente inexistente', async () => {
    const post = (body) => tokenRoute.POST({ request: new Request(`${ORIGIN}/api/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) }) })
    expect((await (await post({ grant_type: 'password', client_id: 'aitc_x' })).json()).error).toBe('invalid_client')
    const { client_id } = await registerPublicClient()
    expect((await (await post({ grant_type: 'password', client_id })).json()).error).toBe('unsupported_grant_type')
  })
})

// El par VERIFIER/CHALLENGE de arriba es consistente (por si alguien lo cambia)
it('CHALLENGE = base64url(sha256(VERIFIER))', () => {
  expect(createHash('sha256').update(VERIFIER).digest('base64url')).toBe(CHALLENGE)
})

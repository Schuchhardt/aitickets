// Foto de perfil (src/lib/userAvatar.ts y /api/users/avatar): solo se toma la foto de Google de cuentas que entraron
// con Google y de googleusercontent.com (el servidor la descarga), pedida en 512 px; se guarda una copia propia en
// user-avatars/<id del usuario de la sesión>; al cambiarla se borra la anterior (solo si es de ese usuario). Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', async (importOriginal) => ({ ...(await importOriginal()), getSessionContext: async () => session }))

const { googlePhotoUrl } = await import('../../src/lib/userAvatar.ts')
const route = await import('../../src/pages/api/users/avatar.ts')

const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a3e635' } }).png().toBuffer()
const PUBLIC = 'https://proj.supabase.co/storage/v1/object/public/Events/'
const googleUser = (meta, providers = ['google']) => ({ id: 'auth-5', user_metadata: meta, app_metadata: { providers }, identities: [] })

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      users: [
        { id: 5, name: 'Ana', organization_id: 7, role: 'viewer', avatar_url: `${PUBLIC}user-avatars/5-old.jpg` },
        { id: 6, name: 'Otro', organization_id: 7, role: 'producer', avatar_url: null },
      ],
    },
  })
  db.uploads = []
  db.removed = []
  db.storage = {
    from: (bucket) => ({
      upload: async (path, buf) => (db.uploads.push({ bucket, path, bytes: buf.length }), { data: { path }, error: null }),
      getPublicUrl: (path) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
      remove: async (paths) => (db.removed.push(...paths), { data: null, error: null }),
    }),
  }
  session = { authUser: googleUser({ avatar_url: 'https://lh3.googleusercontent.com/a/ABC=s96-c' }), dbUser: { id: 5, organization_id: 7, role: 'viewer' } }
})

const avatarOf = async (id) => (await db.from('users').select('avatar_url').eq('id', id).maybeSingle()).data?.avatar_url
const post = (body) => route.POST({ request: new Request('https://aitickets.cl/api/users/avatar', { method: 'POST', ...body }), cookies: {} })
const upload = (file) => {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return post({ body: fd })
}

describe('googlePhotoUrl', () => {
  it('pide la foto de Google en 512 px', () => {
    expect(googlePhotoUrl(googleUser({ avatar_url: 'https://lh3.googleusercontent.com/a/ABC=s96-c' }))).toBe('https://lh3.googleusercontent.com/a/ABC=s512-c')
    expect(googlePhotoUrl(googleUser({ picture: 'https://lh3.googleusercontent.com/a/XYZ' }))).toBe('https://lh3.googleusercontent.com/a/XYZ')
    const byIdentity = { user_metadata: { picture: 'https://lh3.googleusercontent.com/a/X=s96-c' }, app_metadata: {}, identities: [{ provider: 'google' }] }
    expect(googlePhotoUrl(byIdentity)).toBe('https://lh3.googleusercontent.com/a/X=s512-c')
  })

  it('null sin Google, sin foto o con un host que no es de Google', () => {
    expect(googlePhotoUrl(null)).toBeNull()
    expect(googlePhotoUrl(googleUser({ avatar_url: 'https://lh3.googleusercontent.com/a/X' }, ['email']))).toBeNull()
    expect(googlePhotoUrl(googleUser({}))).toBeNull()
    expect(googlePhotoUrl(googleUser({ avatar_url: 'https://evil.example/a.jpg' }))).toBeNull()
    expect(googlePhotoUrl(googleUser({ avatar_url: 'https://googleusercontent.com.evil.example/a' }))).toBeNull()
    expect(googlePhotoUrl(googleUser({ avatar_url: 'http://lh3.googleusercontent.com/a/X' }))).toBeNull()
  })
})

describe('POST/DELETE /api/users/avatar', () => {
  it('sin sesión: 401 y no se sube nada', async () => {
    session = null
    expect((await upload(new File([PNG], 'a.png'))).status).toBe(401)
    expect((await route.DELETE({ request: new Request('https://aitickets.cl/api/users/avatar', { method: 'DELETE' }), cookies: {} })).status).toBe(401)
    expect(db.uploads).toEqual([])
  })

  it('sin archivo, más de 5 MB o algo que no es imagen (SVG): 400 sin subir nada', async () => {
    expect((await upload(null)).status).toBe(400)
    expect((await upload(new File([Buffer.alloc(5 * 1024 * 1024 + 1)], 'big.png'))).status).toBe(400)
    expect((await upload(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'x.png'))).status).toBe(400)
    expect(db.uploads).toEqual([])
    expect(await avatarOf(5)).toBe(`${PUBLIC}user-avatars/5-old.jpg`)
  })

  it('cualquier rol sube su foto: queda en user-avatars/<su id> y se borra la anterior', async () => {
    const res = await upload(new File([PNG], 'yo.png'))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(db.uploads.at(-1).path).toMatch(/^user-avatars\/5-/)
    expect(url).toBe(`${PUBLIC}${db.uploads.at(-1).path}`)
    expect(await avatarOf(5)).toBe(url)
    expect(await avatarOf(6)).toBeNull()
    expect(db.removed).toEqual(['user-avatars/5-old.jpg'])
  })

  it('no borra una foto anterior que no es de su carpeta', async () => {
    await db.from('users').update({ avatar_url: `${PUBLIC}user-avatars/6-ajena.jpg` }).eq('id', 5)
    expect((await upload(new File([PNG], 'yo.png'))).status).toBe(200)
    expect(db.removed).toEqual([])
  })

  it('source=google: descarga la foto de Google en 512 px y la guarda', async () => {
    const fetched = []
    vi.stubGlobal('fetch', async (u) => (fetched.push(String(u)), new Response(PNG, { status: 200 })))
    const res = await post({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'google' }) })
    expect(res.status).toBe(200)
    expect(fetched).toEqual(['https://lh3.googleusercontent.com/a/ABC=s512-c'])
    expect(await avatarOf(5)).toBe((await res.json()).url)
  })

  it('source=google sin cuenta de Google: 400 sin red; si Google falla: 502 y queda la foto anterior', async () => {
    const fetched = []
    vi.stubGlobal('fetch', async (u) => (fetched.push(String(u)), new Response('no', { status: 429 })))
    session.authUser = googleUser({ avatar_url: 'https://lh3.googleusercontent.com/a/X' }, ['email'])
    const json = { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'google' }) }
    expect((await post(json)).status).toBe(400)
    expect(fetched).toEqual([])
    session.authUser = googleUser({ picture: 'https://lh3.googleusercontent.com/a/X' })
    expect((await post(json)).status).toBe(502)
    expect(await avatarOf(5)).toBe(`${PUBLIC}user-avatars/5-old.jpg`)
    expect((await post({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'https://evil' }) })).status).toBe(400)
  })

  it('DELETE quita la foto y borra el archivo', async () => {
    const res = await route.DELETE({ request: new Request('https://aitickets.cl/api/users/avatar', { method: 'DELETE' }), cookies: {} })
    expect(res.status).toBe(200)
    expect(await avatarOf(5)).toBeNull()
    expect(db.removed).toEqual(['user-avatars/5-old.jpg'])
  })
})

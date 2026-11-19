// Logo de la organización (src/lib/orgLogo.ts y /api/organizations/logo): solo dueño y administradores; se guarda una
// copia propia en org-logos/<id de la organización de la sesión>; al cambiarlo se borra el anterior (solo si es de esa
// organización). Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))
vi.mock('../../src/lib/supabaseServer', async (importOriginal) => ({ ...(await importOriginal()), getSessionContext: async () => session }))

const route = await import('../../src/pages/api/organizations/logo.ts')

const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a3e635' } }).png().toBuffer()
const PUBLIC = 'https://proj.supabase.co/storage/v1/object/public/Events/'

beforeEach(() => {
  db = createFakeSupabase({
    tables: {
      organizations: [
        { id: 7, public_name: 'Dance Studio', logo_url: `${PUBLIC}org-logos/7-old.jpg` },
        { id: 8, public_name: 'Otra', logo_url: null },
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
  session = { dbUser: { id: 5, organization_id: 7, role: 'producer' } }
})

const logoOf = async (id) => (await db.from('organizations').select('logo_url').eq('id', id).maybeSingle()).data?.logo_url
const upload = (file) => {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return route.POST({ request: new Request('https://aitickets.cl/api/organizations/logo', { method: 'POST', body: fd }), cookies: {} })
}
const remove = () => route.DELETE({ request: new Request('https://aitickets.cl/api/organizations/logo', { method: 'DELETE' }), cookies: {} })

describe('POST/DELETE /api/organizations/logo', () => {
  it('sin sesión: 401; roles sin administración (finanzas, staff): 403, sin subir nada', async () => {
    session = null
    expect((await upload(new File([PNG], 'a.png'))).status).toBe(401)
    expect((await remove()).status).toBe(401)
    session = { dbUser: { id: 6, organization_id: 7, role: 'finance' } }
    expect((await upload(new File([PNG], 'a.png'))).status).toBe(403)
    expect((await remove()).status).toBe(403)
    expect(db.uploads).toEqual([])
    expect(await logoOf(7)).toBe(`${PUBLIC}org-logos/7-old.jpg`)
  })

  it('sin archivo, más de 5 MB o algo que no es imagen (SVG): 400 sin subir nada', async () => {
    expect((await upload(null)).status).toBe(400)
    expect((await upload(new File([Buffer.alloc(5 * 1024 * 1024 + 1)], 'big.png'))).status).toBe(400)
    expect((await upload(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'x.png'))).status).toBe(400)
    expect(db.uploads).toEqual([])
  })

  it('un administrador sube el logo: queda en org-logos/<su organización> y se borra el anterior', async () => {
    const res = await upload(new File([PNG], 'logo.png'))
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(db.uploads.at(-1).path).toMatch(/^org-logos\/7-/)
    expect(url).toBe(`${PUBLIC}${db.uploads.at(-1).path}`)
    expect(await logoOf(7)).toBe(url)
    expect(await logoOf(8)).toBeNull()
    expect(db.removed).toEqual(['org-logos/7-old.jpg'])
  })

  it('no borra un logo anterior que no es de su carpeta', async () => {
    await db.from('organizations').update({ logo_url: `${PUBLIC}org-logos/8-ajeno.jpg` }).eq('id', 7)
    expect((await upload(new File([PNG], 'logo.png'))).status).toBe(200)
    expect(db.removed).toEqual([])
  })

  it('DELETE quita el logo y borra el archivo', async () => {
    const res = await remove()
    expect(res.status).toBe(200)
    expect(await logoOf(7)).toBeNull()
    expect(db.removed).toEqual(['org-logos/7-old.jpg'])
  })
})

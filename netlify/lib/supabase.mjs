// Helpers compartidos por las Netlify Functions (esbuild los incluye en el bundle de cada función).
// Todo el acceso a Supabase es con la service role key: cada función debe autorizar
// explícitamente (sesión + organización) antes de tocar datos de un productor.
// El proyecto de Supabase es compartido con otras apps: filtrar siempre por event_id / organization_id.
import { createClient } from '@supabase/supabase-js'

let adminClient = null

export function getSupabaseAdmin() {
  if (adminClient) return adminClient
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials (URL or Service Role Key)')
  adminClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  return adminClient
}

/**
 * Cliente service role NUEVO para refreshSession/signIn: supabase-js guarda la sesión en memoria y
 * sobre el singleton haría que las consultas siguientes usen el JWT del usuario en vez de la service role.
 */
export function createEphemeralAuthClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase credentials (URL or Service Role Key)')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
}

export function parseCookies(req) {
  const header = req.headers.get('cookie') || ''
  return Object.fromEntries(
    header.split(';').filter(Boolean).map(c => {
      const [key, ...val] = c.trim().split('=')
      return [key, decodeURIComponent(val.join('='))]
    })
  )
}

/**
 * Devuelve { authUser, dbUser } del productor logueado (cookie sb-access-token) o null.
 */
export async function getSessionContext(req) {
  const accessToken = parseCookies(req)['sb-access-token']
  if (!accessToken) return null

  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(accessToken)
  if (error || !user) return null

  const { data: dbUser } = await supabase
    .from('users')
    .select('id, name, email, organization_id, role, active')
    .eq('auth_user_id', user.id)
    .single()

  if (!dbUser?.organization_id || dbUser.active === false) return null
  return { authUser: user, dbUser }
}

/** Carga el evento solo si pertenece a la organización indicada. */
export async function getOwnedEvent(eventId, organizationId, columns = '*') {
  const { data } = await getSupabaseAdmin()
    .from('events')
    .select(columns)
    .eq('id', eventId)
    .eq('organization_id', organizationId)
    .single()
  return data || null
}

/** Compara un secreto compartido en tiempo constante (para llamadas servidor→servidor). */
export function hasValidInternalSecret(req) {
  const expected = process.env.INTERNAL_API_SECRET
  const received = req.headers.get('x-internal-secret') || ''
  if (!expected || received.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  return diff === 0
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * Lee TODAS las filas de una consulta paginando con .range() (PostgREST corta en 1000 filas por defecto).
 * `buildQuery` debe devolver un query builder NUEVO en cada llamada, con un .order() estable.
 * @param {() => any} buildQuery
 * @param {number} pageSize
 * @returns {Promise<any[]>}
 */
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
    if (from > 200000) break // corta-circuito defensivo
  }
  return rows
}

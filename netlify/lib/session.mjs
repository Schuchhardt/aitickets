// Sesión del productor para Netlify Functions con refresco del access token.
// Las funciones con `config.path` no pasan por el middleware de Astro, así que si el
// access token (1 hora) venció lo refrescamos aquí con el refresh token y devolvemos
// los Set-Cookie para que el navegador guarde la sesión nueva (ej: portero con la app abierta horas).
import { createEphemeralAuthClient, parseCookies, getSessionContext, json } from './supabase.mjs'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

function sessionCookie(name, value) {
  const secure = process.env.CONTEXT === 'dev' || process.env.NETLIFY_DEV === 'true' ? '' : '; Secure'
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`
}

/** @returns {Promise<{ctx: {authUser:any, dbUser:any}|null, setCookies: string[]}>} */
export async function getSessionContextWithRefresh(req) {
  const ctx = await getSessionContext(req)
  if (ctx) return { ctx, setCookies: [] }

  const refreshToken = parseCookies(req)['sb-refresh-token']
  if (!refreshToken) return { ctx: null, setCookies: [] }

  const { data, error } = await createEphemeralAuthClient().auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data?.session) return { ctx: null, setCookies: [] }

  const { access_token: accessToken, refresh_token: newRefresh } = data.session
  const retryReq = new Request(req.url, { headers: { cookie: `sb-access-token=${encodeURIComponent(accessToken)}` } })
  const refreshedCtx = await getSessionContext(retryReq)
  return {
    ctx: refreshedCtx,
    setCookies: [sessionCookie('sb-access-token', accessToken), sessionCookie('sb-refresh-token', newRefresh)],
  }
}

/** json() + Set-Cookie de una sesión refrescada. */
export function jsonWithCookies(body, status, setCookies = []) {
  const res = json(body, status)
  for (const c of setCookies) res.headers.append('Set-Cookie', c)
  return res
}

/** Roles que pueden hacer check-in (C7). */
export const CHECKIN_ROLES = ['admin', 'producer', 'editor', 'validator']
export const EVENT_MANAGER_ROLES = ['admin', 'producer', 'editor']

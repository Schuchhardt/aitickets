#!/usr/bin/env node
// Obtiene el GOOGLE_OAUTH_REFRESH_TOKEN del blog SEO (Search Console + Google Ads / Keyword Planner) con un solo
// consentimiento del dueño de la propiedad y de la cuenta de Ads. Flujo "loopback" de una app de escritorio:
// abre la URL que imprime, acepta, y el script recibe el código en 127.0.0.1 y lo cambia por el refresh token.
//
// Requisitos (docs/runbooks/blog-seo.md):
//   - Un cliente OAuth tipo "App de escritorio" en Google Cloud (APIs: Google Search Console API y Google Ads API).
//   - La pantalla de consentimiento en "En producción" (en "Prueba" el refresh token vence a los 7 días).
//
// Uso: GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/google-oauth.mjs
// El token se imprime en la terminal: cópialo directo a las variables de Netlify, no lo pegues en chats ni en el repo.
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const SCOPES = ['https://www.googleapis.com/auth/webmasters', 'https://www.googleapis.com/auth/adwords']
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
if (!clientId || !clientSecret) {
  console.error('Faltan GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET (cliente OAuth tipo "App de escritorio").')
  process.exit(1)
}
const port = Number(process.env.PORT || 53682)
const redirectUri = `http://127.0.0.1:${port}/callback`
const state = randomBytes(16).toString('hex')
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: SCOPES.join(' '),
  access_type: 'offline',
  prompt: 'consent',
  state,
})}`

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', redirectUri)
  if (url.pathname !== '/callback') {
    res.writeHead(404).end()
    return
  }
  const done = (status, text) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text)
    server.close()
  }
  if (url.searchParams.get('state') !== state) return done(400, 'state inválido: vuelve a correr el script.')
  if (url.searchParams.get('error')) return done(400, `Google respondió: ${url.searchParams.get('error')}`)
  const code = url.searchParams.get('code')
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  })
  const data = await tokenRes.json().catch(() => ({}))
  if (!data.refresh_token) {
    console.error('No llegó refresh_token:', data.error_description || data.error || tokenRes.status)
    return done(500, 'No llegó el refresh token: revisa la terminal.')
  }
  const granted = String(data.scope || '').split(' ')
  const missing = SCOPES.filter((s) => !granted.includes(s))
  console.log('\nGOOGLE_OAUTH_REFRESH_TOKEN=' + data.refresh_token)
  if (missing.length) console.warn(`\nOjo: no se otorgaron estos permisos: ${missing.join(', ')}`)
  done(200, 'Listo. Vuelve a la terminal y copia el GOOGLE_OAUTH_REFRESH_TOKEN a Netlify.')
})

server.listen(port, '127.0.0.1', () => {
  console.log('Abre esta URL con la cuenta de Google dueña de Search Console y con acceso a Google Ads:\n')
  console.log(authUrl + '\n')
})

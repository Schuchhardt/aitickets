// Service worker del validador de entradas (/validador, src/layouts/ValidatorLayout.astro lo registra con ese scope).
// Objetivo: que la página de puerta vuelva a abrir SIN conexión (pestaña recargada, teléfono que cerró el navegador).
// La lista de entradas y las validaciones pendientes viven en el dispositivo (ValidateQR.vue, localStorage); aquí
// solo se guarda lo necesario para que la página cargue:
//   - Páginas /validador y /validador/<slug>: primero la red (con un tope de espera) y, si no hay, la última copia.
//   - /_astro/* (archivos con hash, no cambian) y el motor de lectura de QR (zxing-wasm desde jsDelivr, lo pide
//     vue-qrcode-reader en navegadores sin BarcodeDetector, p. ej. iPhone): primero la caché.
//   - Otros archivos del mismo sitio: primero la red, la caché si no hay conexión.
// Nunca se guardan las APIs (/api/*): la sincronización siempre va al servidor.
// Al cerrar sesión desde el validador se borran estas cachés (caches.delete de 'validador-*').
const PAGES = 'validador-pages-v1'
const ASSETS = 'validador-assets-v1'
const KEEP = [PAGES, ASSETS]
const NAV_TIMEOUT_MS = 5000
const MAX_ASSETS = 400
const MAX_PRECACHE = 600
const ZXING_PREFIX = 'https://fastly.jsdelivr.net/npm/zxing-wasm@'

const isValidatorPage = (url) =>
  url.origin === self.location.origin && (url.pathname === '/validador' || url.pathname.startsWith('/validador/'))
// Una copia por página (sin query string)
const pageKey = (url) => url.origin + (url.pathname.replace(/\/+$/, '') || '/')
const isZxing = (url) => url.href.startsWith(ZXING_PREFIX)
const isAsset = (url) =>
  isZxing(url) || (url.origin === self.location.origin && !url.pathname.startsWith('/api/') && !isValidatorPage(url))
const isImmutable = (url) => isZxing(url) || (url.origin === self.location.origin && url.pathname.startsWith('/_astro/'))
const storable = (res) => res && res.ok && !res.redirected && (res.type === 'basic' || res.type === 'cors')

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('validador-') && !KEEP.includes(k)).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return
  let url
  try { url = new URL(req.url) } catch { return }
  if (req.mode === 'navigate') {
    if (isValidatorPage(url)) event.respondWith(networkFirstPage(req, url))
    return
  }
  if (!isAsset(url)) return
  event.respondWith(isImmutable(url) ? cacheFirst(req) : networkFirstAsset(req))
})

self.addEventListener('message', (event) => {
  const data = event.data || {}
  if (data.type === 'precache' && Array.isArray(data.urls)) event.waitUntil(precache(data.urls))
})

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

async function networkFirstPage(req, url) {
  const cache = await caches.open(PAGES)
  const key = pageKey(url)
  const network = fetch(req).then((res) => {
    if (storable(res) && res.type === 'basic') cache.put(key, res.clone()).catch(() => {})
    return res
  })
  const cached = await cache.match(key)
  if (!cached) return network.catch(() => offlinePage())
  try {
    const res = await withTimeout(network, NAV_TIMEOUT_MS)
    // Servidor caído: mejor la última copia que un error en plena puerta
    return res.status >= 500 ? cached : res
  } catch {
    network.catch(() => {})
    return cached
  }
}

async function trim(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_ASSETS) return
  await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((k) => cache.delete(k)))
}

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(req, { ignoreVary: true })
  if (hit) return hit
  const res = await fetch(req)
  if (storable(res)) {
    await cache.put(req, res.clone()).catch(() => {})
    trim(cache).catch(() => {})
  }
  return res
}

async function networkFirstAsset(req) {
  const cache = await caches.open(ASSETS)
  try {
    const res = await fetch(req)
    if (storable(res)) {
      cache.put(req, res.clone()).then(() => trim(cache)).catch(() => {})
    }
    return res
  } catch (err) {
    const hit = await cache.match(req, { ignoreVary: true })
    if (hit) return hit
    throw err
  }
}

/**
 * La página avisa qué cargó (ella misma y sus archivos): en la primera visita el service worker todavía no la
 * controlaba, así que se guarda ahora lo que falte. Una página ya guardada no se vuelve a pedir (cada una carga la
 * lista completa de entradas en el servidor); se actualiza sola en la próxima visita con conexión.
 */
async function precache(urls) {
  const pages = await caches.open(PAGES)
  const assets = await caches.open(ASSETS)
  const queue = []
  for (const raw of urls.slice(0, MAX_PRECACHE)) {
    let url
    try { url = new URL(raw, self.location.origin) } catch { continue }
    if (isValidatorPage(url)) queue.push({ url, page: true })
    else if (isAsset(url)) queue.push({ url, page: false })
  }
  const work = async ({ url, page }) => {
    try {
      if (page) {
        const key = pageKey(url)
        if (await pages.match(key)) return
        const res = await fetch(key, { credentials: 'same-origin' })
        if (storable(res) && res.type === 'basic') await pages.put(key, res)
        return
      }
      if (await assets.match(url.href, { ignoreVary: true })) return
      const res = await fetch(url.href, isZxing(url) ? { mode: 'cors' } : { credentials: 'same-origin' })
      if (storable(res)) await assets.put(url.href, res)
    } catch { /* sin conexión: se guardará en la próxima visita */ }
  }
  for (let i = 0; i < queue.length; i += 6) await Promise.all(queue.slice(i, i + 6).map(work))
  await trim(assets)
}

function offlinePage() {
  const html = '<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sin conexión · Validador</title></head>' +
    '<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f9fafb;color:#111827">' +
    '<main style="text-align:center;padding:24px;max-width:420px"><h1 style="font-size:1.4rem">Sin conexión</h1>' +
    '<p>Esta página del validador todavía no está guardada en este teléfono. Ábrela una vez con internet (y toca Sincronizar) para poder usarla sin conexión.</p>' +
    '<p><button onclick="location.reload()" style="padding:10px 16px;border-radius:8px;border:0;background:#111827;color:#fff;font-size:1rem">Reintentar</button></p></main></body></html>'
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}

// Service worker del panel de productores (PWA): avisos push y caché mínima. Solo guarda assets con hash
// (/_astro/, inmutables) e íconos; el resto del sitio (páginas, imágenes de eventos, API) va siempre a la red.
const CACHE_NAME = 'ait-producer-v1'
const PRECACHE_URLS = [
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/apple-touch-icon.png',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Solo cachés propias: las del validador (validador-*) son del mismo origen y deben sobrevivir
      Promise.all(keys.filter((k) => k.startsWith('ait-producer-') && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (event.request.method !== 'GET') return
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return

  const isAstroAsset = url.pathname.startsWith('/_astro/')
  const isIcon = PRECACHE_URLS.includes(url.pathname)

  if (url.origin === self.location.origin && (isAstroAsset || isIcon)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
      })
    )
    return
  }

})

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const title = data.title || 'AI Tickets'
  const options = {
    body: data.body || '',
    icon: data.icon || '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    tag: data.tag || 'ait-notification',
    data: { url: data.url || '/dashboard' },
    vibrate: [200, 100, 200],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (new URL(client.url).pathname === targetUrl && 'focus' in client) {
          return client.focus()
        }
      }
      for (const client of windowClients) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})

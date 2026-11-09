// Lo que se hace cuando un artículo se publica, cambia o se despublica: vaciar la caché del CDN de las páginas del
// blog, reenviar el sitemap a Search Console y avisar las URLs por IndexNow (Bing y otros). Ninguna falla detiene la
// publicación: cada paso devuelve su resultado para la bitácora. Lo usan las funciones del blog y el MCP de admin.
import { indexNowKey, isSearchConsoleConfigured, SITE_URL } from './config.mjs'
import { submitSitemap } from './google.mjs'

/** Etiqueta de caché de /blog, /blog/<slug>, /blog/tema/<slug> y el RSS (src/lib/cdnCache.ts). */
export const BLOG_CACHE_TAG = 'blog-pages'

const env = (name) => (globalThis.process?.env?.[name] || '').trim()

export async function purgeBlogCache({ fetchImpl = fetch } = {}) {
  const token = env('NETLIFY_PURGE_API_TOKEN')
  const siteId = env('SITE_ID')
  if (!token || !siteId) return 'sin NETLIFY_PURGE_API_TOKEN/SITE_ID'
  try {
    const res = await fetchImpl('https://api.netlify.com/api/v1/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ site_id: siteId, cache_tags: [BLOG_CACHE_TAG] }),
      signal: AbortSignal.timeout(5000),
    })
    return res.ok ? 'ok' : `HTTP ${res.status}`
  } catch (err) {
    return err?.message || String(err)
  }
}

export async function pingIndexNow(urls, { fetchImpl = fetch } = {}) {
  const key = indexNowKey()
  if (!key || !urls.length) return key ? 'sin URLs' : 'sin INDEXNOW_KEY'
  const site = SITE_URL()
  try {
    const res = await fetchImpl('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(site).host, key, keyLocation: `${site}/indexnow.txt`, urlList: urls.slice(0, 100) }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok || res.status === 202 ? 'ok' : `HTTP ${res.status}`
  } catch (err) {
    return err?.message || String(err)
  }
}

async function resubmitSitemap(fetchImpl) {
  if (!isSearchConsoleConfigured()) return 'Search Console sin configurar'
  try {
    await submitSitemap(`${SITE_URL()}/sitemap.xml`, { fetchImpl })
    return 'ok'
  } catch (err) {
    return err?.message || String(err)
  }
}

/** Tras publicar o actualizar: CDN, sitemap e IndexNow. `paths`: rutas que cambiaron ("/blog/mi-articulo"). */
export async function afterBlogChange(paths, { fetchImpl = fetch, notify = true } = {}) {
  const urls = paths.map((p) => `${SITE_URL()}${p}`)
  const [cache, sitemap, indexnow] = await Promise.all([
    purgeBlogCache({ fetchImpl }),
    notify ? resubmitSitemap(fetchImpl) : 'omitido',
    notify ? pingIndexNow([...urls, `${SITE_URL()}/blog`], { fetchImpl }) : 'omitido',
  ])
  return { cache, sitemap, indexnow }
}

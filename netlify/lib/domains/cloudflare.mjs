// Proveedor "cloudflare" (Cloudflare for SaaS, custom_hostnames): SOLO INTERFAZ por ahora.
//
// Se activará cuando la zona aitickets.cl esté en Cloudflare y exista el fallback origin. La
// implementación real usará:
//   POST   /zones/${CLOUDFLARE_ZONE_ID}/custom_hostnames  { hostname, ssl: { method: 'http', type: 'dv' } }
//   GET    /zones/${CLOUDFLARE_ZONE_ID}/custom_hostnames/{id}
//   DELETE /zones/${CLOUDFLARE_ZONE_ID}/custom_hostnames/{id}
// con el mapeo: status pending → pending_dns; active + ssl no activo → pending_ssl; ambos activos → active.
//
// Mientras tanto se comporta como "none": guarda pending_provider y avisa por Slack, sin llamar APIs.
import { notifySlack } from '../slack.mjs'
import { dnsRecordsFor } from './validate.mjs'

export const cloudflareProvider = {
  name: 'cloudflare',

  async addDomain(hostname, { siteSlug, token } = {}) {
    await notifySlack(
      `🌐 Dominio solicitado (${hostname}${siteSlug ? `, sitio /o/${siteSlug}` : ''}), pero el proveedor Cloudflare ` +
        'aún no está implementado. Configura DOMAIN_PROVIDER=netlify o conéctalo manualmente.'
    )
    return {
      providerId: null,
      status: 'pending_provider',
      records: dnsRecordsFor(hostname, 'cloudflare', token),
      error: null,
      verification: token ? { token } : {},
    }
  },

  async checkDomain(site) {
    return {
      status: site.domain_status,
      error: site.domain_error || null,
      verification: { ...(site.domain_verification || {}) },
    }
  },

  async removeDomain(site) {
    if (site?.domain_provider_id) {
      await notifySlack(`🌐 Dominio eliminado: ${site.custom_domain}. Quita el custom hostname en Cloudflare manualmente.`)
    }
  },
}

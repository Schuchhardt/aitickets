// Proveedor "none": sin credenciales de dominio configuradas (p. ej. sin NETLIFY_AUTH_TOKEN).
// No llama a ninguna API: guarda la solicitud como pending_provider y avisa por Slack para que el equipo
// configure el proveedor. Cuando el proveedor quede configurado, el cron retoma estas filas.
import { notifySlack } from '../slack.mjs'
import { dnsRecordsFor } from './validate.mjs'

export const noneProvider = {
  name: 'none',

  async addDomain(hostname, { siteSlug, token } = {}) {
    await notifySlack(
      `🌐 Dominio solicitado, configurar proveedor: ${hostname}${siteSlug ? ` (sitio /o/${siteSlug})` : ''}. ` +
        'Configura NETLIFY_AUTH_TOKEN (solo Production) o DOMAIN_PROVIDER para conectarlo.'
    )
    return {
      providerId: null,
      status: 'pending_provider',
      records: dnsRecordsFor(hostname, 'netlify', token),
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
    // Si alguna vez se agregó con otro proveedor (p. ej. alias de Netlify), hay que quitarlo a mano.
    if (site?.domain_provider && site.domain_provider !== 'none') {
      await notifySlack(
        `🌐 Dominio eliminado por el productor: ${site.custom_domain} (proveedor ${site.domain_provider}). ` +
          'Sin credenciales del proveedor: quítalo manualmente.'
      )
    }
  },
}

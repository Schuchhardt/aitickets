// Función programada (cada 15 minutos): avanza el estado de los dominios propios de los sitios.
// - pending_dns / pending_ssl / removing (y pending_provider cuando ya hay proveedor): se refrescan.
// - active: se revisa cada ~6 h que el DNS siga apuntando (si no, a las 72 h se desconecta).
// - Al quedar active (o failed) se avisa al productor por correo y al equipo por Slack
//   (netlify/lib/domains/index.mjs → refreshSiteDomain).
// - Máx. 20 sitios por corrida y < 25 s (límite de 30 s de las funciones programadas).
// - DOMAIN_CHECKS_DISABLED=true la desactiva (kill switch).
import { getSupabaseAdmin, json } from '../../lib/supabase.mjs'
import { getDomainProvider, refreshSiteDomain, SITE_DOMAIN_COLUMNS } from '../../lib/domains/index.mjs'

const BATCH_LIMIT = 20
const TIME_BUDGET_MS = 22000
const ACTIVE_RECHECK_MS = 6 * 60 * 60 * 1000

export default async function handler() {
  if (process.env.DOMAIN_CHECKS_DISABLED === 'true') return json({ skipped: 'disabled' }, 200)
  const started = Date.now()
  const supabase = getSupabaseAdmin()
  const provider = getDomainProvider()

  const pending = ['pending_dns', 'pending_ssl', 'removing']
  // Sin proveedor real, las solicitudes pending_provider esperan (se avisó por Slack al crearlas)
  if (provider.name === 'netlify') pending.push('pending_provider')
  const staleActive = new Date(Date.now() - ACTIVE_RECHECK_MS).toISOString()

  const { data: sites, error } = await supabase
    .from('aitickets_sites')
    .select(SITE_DOMAIN_COLUMNS)
    .not('custom_domain', 'is', null)
    .or(
      `domain_status.in.(${pending.join(',')}),` +
        `and(domain_status.eq.active,domain_checked_at.lt.${staleActive}),` +
        'and(domain_status.eq.active,domain_checked_at.is.null)'
    )
    .order('domain_checked_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT)

  if (error) {
    // 42P01 / PGRST205: la migración de sitios aún no está aplicada
    if (error.code === '42P01' || error.code === 'PGRST205') return json({ skipped: 'schema' }, 200)
    console.error('check-custom-domains: error leyendo sitios:', error.message)
    return json({ message: 'Error leyendo sitios' }, 500)
  }

  const summary = { scanned: sites?.length || 0, changed: 0, active: 0, failed: 0, removed: 0, provider: provider.name }
  for (const site of sites || []) {
    if (Date.now() - started > TIME_BUDGET_MS) break
    try {
      const res = await refreshSiteDomain(supabase, site)
      if (res.changed) {
        summary.changed++
        if (res.to === 'active') summary.active++
        if (res.to === 'failed') summary.failed++
        if (res.to === 'none') summary.removed++
      }
    } catch (err) {
      console.error(`check-custom-domains: ${site.custom_domain}:`, err?.message || err)
    }
  }

  if (summary.changed) console.log('🌐 check-custom-domains:', JSON.stringify(summary))
  return json(summary, 200)
}

export const config = {
  schedule: '*/15 * * * *',
}

// Reporte semanal a productores (netlify/lib/weekly-report-send.mjs): ventas y dinero de la semana, mejor canal e
// ideas para promover cada evento (IA o reglas fijas). Un correo por persona: recibe los datos ya calculados y los
// links ya armados (con seguimiento) por el envío; aquí solo se presentan.
import { Link } from '@react-email/components'
import { h, str, safeHref, COLORS, FONT_FAMILY, TABLE_PROPS, EmailLayout, Title, Subtitle, Paragraph, Badge, PrimaryButton, Panel, KeyValueTable, Divider, renderEmail } from './layout.mjs'

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`
const plural = (n, one, many) => `${Number(n).toLocaleString('es-CL')} ${n === 1 ? one : many}`
const oneLine = (v) => str(v).replace(/[\r\n]+/g, ' ').trim()
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const linkStyle = { color: COLORS.text, fontWeight: 600, textDecoration: 'underline' }

/** "↑ 50% vs la semana anterior" (null si no hay base para comparar). */
export function changeLabel(pct) {
  if (pct == null) return null
  if (pct === 0) return 'igual que la semana anterior'
  return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs la semana anterior`
}

const TYPE_LABELS = { channel: 'Tu mejor canal', tracking: 'Mide tus canales', offer: 'Oferta', content: 'Contenido', ads: 'Publicidad' }

/** Fila de 3 cifras grandes (entradas, ventas, mejor canal). En texto plano sale como "etiqueta: valor". */
function StatTiles({ items }) {
  const cell = { width: `${Math.floor(100 / items.length)}%`, padding: '0 4px', verticalAlign: 'top' }
  const box = { backgroundColor: COLORS.panel, borderRadius: '12px', padding: '14px 10px', textAlign: 'center' }
  return h(
    'table',
    { ...TABLE_PROPS, style: { borderCollapse: 'collapse', margin: '0 0 20px' } },
    h(
      'tbody',
      null,
      h(
        'tr',
        null,
        items.map((it, i) =>
          h(
            'td',
            { key: `stat-${i}`, style: cell },
            h(
              'div',
              { style: box },
              h('div', { style: { fontFamily: FONT_FAMILY, fontSize: '11px', lineHeight: '16px', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: COLORS.muted } }, it.label),
              h('div', { style: { fontFamily: FONT_FAMILY, fontSize: it.small ? '17px' : '24px', lineHeight: '32px', fontWeight: 700, color: COLORS.text } }, it.value),
              it.hint ? h('div', { style: { fontFamily: FONT_FAMILY, fontSize: '12px', lineHeight: '16px', color: COLORS.muted } }, it.hint) : null
            )
          )
        )
      )
    )
  )
}

/** Tabla de canales de la semana: canal, visitas, entradas y ventas. */
function ChannelTable({ channels }) {
  const head = { fontFamily: FONT_FAMILY, fontSize: '11px', lineHeight: '16px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', color: COLORS.muted, padding: '0 0 6px', borderBottom: `1px solid ${COLORS.border}` }
  const cell = { fontFamily: FONT_FAMILY, fontSize: '13px', lineHeight: '18px', color: COLORS.text, padding: '7px 0', borderBottom: `1px solid ${COLORS.border}` }
  const num = { textAlign: 'right', paddingLeft: '8px', whiteSpace: 'nowrap' }
  return h(
    'table',
    { ...TABLE_PROPS, style: { borderCollapse: 'collapse', margin: '0 0 16px' } },
    h(
      'thead',
      null,
      h('tr', null, h('th', { style: { ...head, textAlign: 'left' } }, 'Canal'), h('th', { style: { ...head, ...num } }, 'Visitas'), h('th', { style: { ...head, ...num } }, 'Entradas'), h('th', { style: { ...head, ...num } }, 'Ventas'))
    ),
    h(
      'tbody',
      null,
      channels.map((c, i) =>
        h(
          'tr',
          { key: `ch-${i}` },
          h('td', { style: cell }, oneLine(c.label)),
          h('td', { style: { ...cell, ...num } }, c.visits ? c.visits.toLocaleString('es-CL') : '—'),
          h('td', { style: { ...cell, ...num } }, c.tickets ? c.tickets.toLocaleString('es-CL') : '—'),
          h('td', { style: { ...cell, ...num } }, c.revenue_clp ? clp(c.revenue_clp) : '—')
        )
      )
    )
  )
}

/** Una idea: tipo, título, texto y, si corresponde, el botón al panel y/o el link con seguimiento para copiar. */
function SuggestionCard({ s, index }) {
  const action = s.action && safeHref(s.action.href) ? s.action : null
  const tracking = safeHref(s.trackingUrl)
  return h(
    Panel,
    { tone: index === 0 ? 'lime' : 'outline', label: `${index + 1}. ${TYPE_LABELS[s.type] || 'Idea'}` },
    h(Paragraph, { style: { margin: '0 0 6px', fontWeight: 600 } }, oneLine(s.title)),
    h(Paragraph, { small: true, style: { margin: action || tracking ? '0 0 10px' : 0 } }, oneLine(s.body)),
    action
      ? h(
          Paragraph,
          { small: true, style: { margin: tracking ? '0 0 6px' : 0 } },
          h(Link, { href: safeHref(action.href), style: linkStyle }, `${oneLine(action.label)} →`)
        )
      : null,
    tracking
      ? h(
          Paragraph,
          { small: true, muted: true, style: { margin: 0, wordBreak: 'break-all' } },
          `${oneLine(s.trackingLabel) || 'Link con seguimiento'}: `,
          h(Link, { href: tracking, style: { color: COLORS.muted, textDecoration: 'underline' } }, tracking)
        )
      : null
  )
}

function EventSection({ e, isFirst }) {
  const change = changeLabel(e.tickets_change_pct)
  const when = [oneLine(e.dateLabel), e.daysUntil != null ? (e.daysUntil === 0 ? 'es hoy' : `faltan ${plural(e.daysUntil, 'día', 'días')}`) : ''].filter(Boolean).join(' · ')
  const totalValue = e.capacity ? `${e.total_tickets.toLocaleString('es-CL')} de ${e.capacity.toLocaleString('es-CL')} (${String(e.sell_through_pct).replace('.', ',')}%)` : e.total_tickets.toLocaleString('es-CL')
  const visits = e.visits ? `${e.visits.toLocaleString('es-CL')}${e.conversion_pct != null ? ` · conversión ${String(e.conversion_pct).replace('.', ',')}%` : ''}` : '0'
  return h(
    'div',
    null,
    isFirst ? null : h(Divider),
    h(
      Paragraph,
      { style: { margin: '0 0 2px', fontSize: '18px', lineHeight: '26px', fontWeight: 700 } },
      safeHref(e.publicUrl) ? h(Link, { href: safeHref(e.publicUrl), style: { color: COLORS.text, textDecoration: 'none' } }, oneLine(e.name)) : oneLine(e.name)
    ),
    when ? h(Paragraph, { small: true, muted: true, style: { margin: '0 0 12px' } }, capitalize(when)) : null,
    h(
      Panel,
      { tone: 'outline' },
      h(KeyValueTable, {
        rows: [
          { label: 'Entradas esta semana', value: `${e.week.tickets.toLocaleString('es-CL')}${change ? ` (${change})` : ''}` },
          { label: 'Ventas esta semana', value: clp(e.week.revenue_clp) },
          { label: 'Vendidas en total', value: totalValue },
          { label: 'Visitas a la página', value: visits },
        ],
      })
    ),
    e.channels?.length ? h(ChannelTable, { channels: e.channels }) : null,
    e.bestChannel
      ? h(
          Paragraph,
          { small: true, style: { margin: '0 0 12px' } },
          h('strong', null, 'Mejor canal: '),
          `${oneLine(e.bestChannel.label)} `,
          h('span', { style: { color: COLORS.muted } }, e.bestChannel.basis === 'sales' ? `(${plural(e.bestChannel.tickets, 'entrada vendida', 'entradas vendidas')} con su link)` : `(${plural(e.bestChannel.visits, 'visita', 'visitas')}; las compras llegaron sin seguimiento)`)
        )
      : null,
    e.insight ? h(Paragraph, { small: true, style: { margin: '0 0 16px' } }, oneLine(e.insight)) : null,
    h(Paragraph, { style: { margin: '0 0 10px', fontWeight: 700 } }, 'Ideas para esta semana'),
    ...(e.suggestions || []).map((s, i) => h(SuggestionCard, { key: `s-${i}`, s, index: i })),
    h(PrimaryButton, { href: e.createPostUrl }, 'Crear contenido con IA'),
    safeHref(e.analyticsUrl)
      ? h(Paragraph, { small: true, align: 'center', style: { margin: '-12px 0 8px' } }, h(Link, { href: safeHref(e.analyticsUrl), style: { color: COLORS.muted, textDecoration: 'underline' } }, 'Ver todas las estadísticas del evento'))
      : null
  )
}

/** Asunto según la semana: con ventas, las cifras; sin ventas, la promesa de ideas. */
export function weeklyReportSubject({ totals, events }) {
  if (totals.tickets > 0) return `📊 Tu semana: ${plural(totals.tickets, 'entrada', 'entradas')} y ${clp(totals.revenue_clp)} en ventas`
  if (events.length === 1) return `📊 Tu semana en AI Tickets: ideas para vender ${oneLine(events[0].name).slice(0, 60)}`
  return '📊 Tu semana en AI Tickets: ideas para vender más entradas'
}

/**
 * @param {{
 *   recipientName?: string, orgName?: string, weekLabel: string, summary?: string,
 *   totals: { tickets: number, revenue_clp: number, tickets_change_pct: number | null, visits: number, best_channel: { label: string } | null },
 *   events: any[], moreEvents?: number, dashboardUrl: string, unsubscribeUrl?: string,
 * }} opts  events: ver EventSection (cifras de computeEventMetrics + links y sugerencias armadas por el envío).
 */
export async function renderWeeklyReportEmail({ recipientName, orgName, weekLabel, summary, totals, events, moreEvents = 0, dashboardUrl, unsubscribeUrl } = {}) {
  const org = oneLine(orgName)
  const name = oneLine(recipientName)
  const best = totals.best_channel
  const ideas = events.reduce((n, e) => n + (e.suggestions?.length || 0), 0)
  const subject = weeklyReportSubject({ totals, events })
  const change = changeLabel(totals.tickets_change_pct)
  const element = h(
    EmailLayout,
    {
      preview: `${capitalize(weekLabel)}${best ? ` · Tu mejor canal: ${oneLine(best.label)}` : ''} · ${plural(ideas, 'idea', 'ideas')} para esta semana`,
      footer: { unsubscribeUrl },
    },
    h(Badge, null, 'Reporte semanal'),
    h(Title, null, 'Tu semana en AI Tickets'),
    h(Subtitle, null, `${capitalize(weekLabel)}${org ? ` · ${org}` : ''}`),
    h(Paragraph, null, `Hola${name ? ` ${name}` : ''}:`),
    h(
      Paragraph,
      null,
      oneLine(summary) ||
        (totals.tickets > 0
          ? `Esta semana vendiste ${plural(totals.tickets, 'entrada', 'entradas')} por ${clp(totals.revenue_clp)}. Abajo tienes cómo le fue a cada evento, qué canal te está vendiendo y qué hacer esta semana.`
          : 'Esta semana no hubo ventas, pero hay tiempo para moverlas. Abajo tienes cómo va cada evento y tres ideas concretas para esta semana.')
    ),
    h(StatTiles, {
      items: [
        { label: 'Entradas', value: totals.tickets.toLocaleString('es-CL'), hint: change },
        { label: 'Ventas', value: clp(totals.revenue_clp), hint: totals.visits ? plural(totals.visits, 'visita', 'visitas') : null },
        { label: 'Mejor canal', value: best ? oneLine(best.label) : 'Sin datos', small: true, hint: best ? (best.basis === 'sales' ? 'por ventas' : 'por visitas') : 'usa links con seguimiento' },
      ],
    }),
    ...events.map((e, i) => h(EventSection, { key: `ev-${e.event_id}`, e, isFirst: i === 0 })),
    moreEvents > 0
      ? h(
          Paragraph,
          { small: true, align: 'center', muted: true },
          `Tienes ${plural(moreEvents, 'evento activo más', 'eventos activos más')}: `,
          h(Link, { href: safeHref(dashboardUrl), style: linkStyle }, 'míralos en tu panel'),
          '.'
        )
      : null,
    h(Divider),
    h(
      Paragraph,
      { small: true, muted: true, style: { margin: 0 } },
      'Las ventas y el dinero son de la semana (domingo a sábado, hora de Chile), sin cortesías y sin el cargo por servicio. Una venta tiene canal solo si se compró con un link con seguimiento: usa los de este correo para saber qué te vende.',
      org ? ` Recibes este reporte porque administras ${org} en AI Tickets.` : ''
    )
  )
  return renderEmail(subject, element)
}

// Puntaje (0-100) de una keyword para decidir qué artículo escribir primero. Función pura (tests en
// tests/unit/blog-engine.test.mjs).
//
//   score = 100 × √demanda × competencia × intención × relevancia × empuje
//
// - demanda (0-1): búsquedas mensuales de Keyword Planner en escala log (10 → 0,26 · 100 → 0,5 · 10.000 → 1). Sin
//   Planner, las impresiones de Search Console de 28 días (≈ un mes); sin ninguna, 0,35 si salió del autocompletado
//   de Google (alguien la busca) y 0,2 si no. Mínimo 0,1: Planner redondea a 0 muchas long-tail que sí se buscan.
// - competencia: la de Google Ads mide anunciantes, no SEO; pesa poco (LOW 1 · MEDIUM 0,9 · HIGH 0,75).
// - intención: el blog responde preguntas (informational 1); comparativas sirven (commercial 0,85); las de compra
//   ya las cubren las landings (transactional 0,3); las de marca ajena no se escriben (navigational 0).
// - relevancia: la que puso la IA (0-100), pensando en productores de eventos en Chile, no en público asistente.
// - empuje ×1,25: Search Console ya nos muestra entre las posiciones 4 y 30 ("striking distance"): un artículo
//   dedicado es la forma más rápida de subir.

const COMPETITION = { LOW: 1, MEDIUM: 0.9, HIGH: 0.75 }
const INTENT = { informational: 1, commercial: 0.85, transactional: 0.3, navigational: 0 }

/** Demanda 0-1 de una keyword (ver arriba). */
export function keywordDemand(k) {
  const volume = Number.isFinite(k?.planner_searches) ? k.planner_searches : Number.isFinite(k?.gsc_impressions) ? k.gsc_impressions : null
  if (volume == null) return (k?.sources || []).includes('autocomplete') ? 0.35 : 0.2
  return Math.max(0.1, Math.min(1, Math.log10(volume + 1) / 4))
}

export const isStrikingDistance = (k) => Number.isFinite(k?.gsc_position) && k.gsc_position >= 4 && k.gsc_position <= 30

export function keywordScore(k) {
  if (!k || !Number.isFinite(k.relevance) || !k.intent) return 0
  const intent = INTENT[k.intent] ?? 0.5
  if (!intent) return 0
  const competition = COMPETITION[k.planner_competition] ?? 0.9
  const boost = isStrikingDistance(k) ? 1.25 : 1
  const score = 100 * Math.sqrt(keywordDemand(k)) * competition * intent * (Math.max(0, Math.min(100, k.relevance)) / 100) * boost
  return Math.round(Math.min(100, score) * 100) / 100
}

/** Puntaje mínimo para que el generador elija una keyword sin que nadie la haya priorizado a mano. */
export const MIN_AUTO_SCORE = 25

/**
 * Motivo para descartar una keyword al clasificarla (o null si sirve). Solo descarta las nuevas: las priorizadas a
 * mano (queued) y las usadas no se tocan.
 */
export function rejectionReason(k) {
  if (k.intent === 'navigational') return 'Busca una marca o sitio puntual'
  if (k.audience && k.audience !== 'producer') return k.audience === 'attendee' ? 'La busca público que compra entradas, no productores' : 'No es para productores de eventos'
  if (!k.topic_id) return 'No calza con ningún tema del blog'
  if (Number.isFinite(k.relevance) && k.relevance < 40) return 'Relevancia baja para productores'
  return null
}

/**
 * Tema que toca según las cuotas: el de mayor déficit entre su peso (normalizado) y su parte de los artículos
 * recientes. topics: [{id, weight}], recentCounts: Map(topic_id → artículos). Empate: el de más peso.
 */
export function topicByDeficit(topics, recentCounts, eligible = () => true) {
  const active = topics.filter((t) => t.weight > 0 && eligible(t))
  const totalWeight = active.reduce((s, t) => s + t.weight, 0)
  if (!totalWeight) return null
  const totalPosts = active.reduce((s, t) => s + (recentCounts.get(t.id) || 0), 0)
  let best = null
  for (const t of active) {
    const target = t.weight / totalWeight
    const actual = totalPosts ? (recentCounts.get(t.id) || 0) / totalPosts : 0
    const deficit = target - actual
    if (!best || deficit > best.deficit + 1e-9 || (Math.abs(deficit - best.deficit) <= 1e-9 && t.weight > best.topic.weight)) {
      best = { topic: t, deficit }
    }
  }
  return best?.topic || null
}

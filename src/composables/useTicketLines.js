// Líneas de entradas de las calculadoras con varias filas (StageCalculator de /ticketera-fiestas y QuoteCalculator de
// /ticketera-seminarios): cada línea con su precio (parseAmount, tope CALC_PRICE.inputMax) y su cantidad (1 a
// CALC_QTY.inputMax), lo que paga el público y lo que recibes por línea con priceQuote (fees.mjs, la fórmula del
// checkout), los totales si se vende todo, agregar y quitar líneas, y la línea elegida para el desglose de una entrada
// (radiogroup con flechas). Solo la lógica: cada landing pone su piel, sus textos y su analítica.
import { computed, ref } from 'vue'
import { CALC_PRICE, CALC_QTY, parseAmount, priceQuote } from '../components/landing/producerLanding.js'

/**
 * lines: [{ name, price, qty, ...lo que la piel necesite }] (name identifica la línea: debe ser único).
 * payer: ref 'buyer' | 'producer' (usePayerToggle). max / min: cuántas líneas como máximo y como mínimo.
 * order(a, b): orden de las líneas al agregar una (opcional; sin él, la nueva va al final).
 */
export function useTicketLines({ lines, payer, max = Infinity, min = 1, order = null }) {
  const toRow = (l) => ({ ...l, priceText: l.price.toLocaleString('es-CL'), qtyText: String(l.qty) })
  const rows = ref(lines.map(toRow))
  const picked = ref(0)

  const quotes = computed(() => rows.value.map((r) => ({ one: priceQuote(r.price, payer.value), all: priceQuote(r.price, payer.value, r.qty) })))
  const totalPublic = computed(() => quotes.value.reduce((s, q, i) => s + q.one.buyerPays * rows.value[i].qty, 0))
  const totalYou = computed(() => quotes.value.reduce((s, q) => s + q.all.total, 0))
  const pickedIndex = computed(() => Math.min(picked.value, rows.value.length - 1))
  const pickedRow = computed(() => rows.value[pickedIndex.value])
  const pickedQuote = computed(() => quotes.value[pickedIndex.value].one)
  /** Firma de las líneas para la analítica con pausa ("60000x120,40000x60") */
  const signature = computed(() => rows.value.map((r) => `${r.price}x${r.qty}`).join())

  function onPrice(row, e) {
    row.price = parseAmount(e.target.value, CALC_PRICE.inputMax)
  }
  function onQty(row, e) {
    row.qty = Math.max(1, parseAmount(e.target.value, CALC_QTY.inputMax))
  }
  function blurRow(row) {
    row.priceText = row.price.toLocaleString('es-CL')
    row.qtyText = String(row.qty)
  }
  /** Radiogroup "Desglose de una entrada de": las flechas cambian la opción y mueven el foco (como onSegKey) */
  function onPickKey(e) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const n = rows.value.length
    const next = (pickedIndex.value + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + n) % n
    picked.value = next
    e.currentTarget.children[next]?.focus()
  }
  function addLine(line) {
    if (rows.value.length >= max || !line) return
    const next = [...rows.value, toRow(line)]
    rows.value = order ? next.sort(order) : next
  }
  function removeLine(i) {
    if (rows.value.length <= min) return
    rows.value = rows.value.filter((_, j) => j !== i)
    if (picked.value >= rows.value.length) picked.value = rows.value.length - 1
  }

  return { rows, picked, quotes, totalPublic, totalYou, pickedIndex, pickedRow, pickedQuote, signature, onPrice, onQty, blurRow, onPickKey, addLine, removeLine }
}

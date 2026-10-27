// Piezas compartidas de las calculadoras de precio de las landings (PriceCalculator de /organizadores y PriceSentence
// de /ticketera-stand-up): el selector de quién paga el cargo y el anuncio del resultado a lectores de pantalla. La
// fórmula es priceQuote de producerLanding.js (fees.mjs); aquí solo va el comportamiento de la interfaz.
import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * Segmented control "¿Quién paga el cargo?" como radiogroup: las flechas cambian la opción y mueven el foco.
 * payers = [{ value, label }]. En el template: :ref="(el) => (segButtons[i] = el)" y @keydown="onSegKey($event, i)".
 */
export function usePayerToggle(payers, initial = 'buyer') {
  const payer = ref(initial)
  const segButtons = ref([])
  function onSegKey(e, i) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + payers.length) % payers.length
    payer.value = payers[next].value
    segButtons.value[next]?.focus()
  }
  return { payer, segButtons, onSegKey }
}

/**
 * Texto para una región aria-live que se actualiza con `delayMs` de pausa: mientras el slider se mueve no se anuncia
 * cada paso, solo el valor final. message(valor) arma el texto.
 */
export function useDelayedAnnouncement(source, message, delayMs = 400) {
  const announced = ref('')
  let timer = null
  watch(source, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      announced.value = message(value)
    }, delayMs)
  })
  onBeforeUnmount(() => clearTimeout(timer))
  return announced
}

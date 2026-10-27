// Piezas compartidas de las calculadoras de precio de las landings (PriceCalculator de /organizadores y PriceSentence
// de /ticketera-stand-up): el selector de quién paga el cargo, el anuncio del resultado a lectores de pantalla y la
// analítica de los cambios. La fórmula es priceQuote de producerLanding.js (fees.mjs); aquí solo va el comportamiento de
// la interfaz.
import { onBeforeUnmount, ref, watch } from 'vue'
import { trackEvent } from './useGoogleAnalytics.js'

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

/**
 * Analítica de una calculadora (SPEC_landing_productores §11, y con prefijo su_ en stand-up, SPEC_landing_standup §8):
 * `event` { ...payload(), field } `delayMs` después del último cambio, una vez por sesión por campo. fields = { nombre: ref }
 * (price, qty, payer...): cada campo que cambió en la ráfaga manda su propio evento. Lo ya medido se guarda en
 * sessionStorage (<prefijo>_calc_tracked); sin storage se vuelve a medir en la próxima carga.
 */
export function useCalcChangeTracking(event, fields, payload, delayMs = 1000) {
  const storageKey = event.replace(/_change$/, '_tracked')
  const names = Object.keys(fields)
  const pending = new Set()
  let timer = null
  function trackedFields() {
    try {
      const list = JSON.parse(sessionStorage.getItem(storageKey) || '[]')
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }
  watch(Object.values(fields), (values, prev) => {
    names.forEach((name, i) => {
      if (values[i] !== prev[i]) pending.add(name)
    })
    clearTimeout(timer)
    timer = setTimeout(() => {
      const done = trackedFields()
      const changed = [...pending].filter((f) => !done.includes(f))
      pending.clear()
      for (const field of changed) trackEvent(event, { ...payload(), field })
      if (!changed.length) return
      try {
        sessionStorage.setItem(storageKey, JSON.stringify([...done, ...changed]))
      } catch {
        /* sin storage: se vuelve a medir en la próxima carga */
      }
    }, delayMs)
  })
  onBeforeUnmount(() => clearTimeout(timer))
}

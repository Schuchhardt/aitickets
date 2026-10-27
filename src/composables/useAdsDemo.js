// Lógica compartida de las demos de anuncios de las landings (StandupAdsDemo de /ticketera-stand-up y MusicAdsDemo de
// /ticketera-musica-en-vivo): presupuesto diario × días = total, estado "activo" y el foco al cambiar de estado. Es una
// demostración: no crea anuncios ni estima alcance. Cada landing pone su piel y su evento de analítica.
import { computed, nextTick, ref } from 'vue'

/**
 * budget y days: valores iniciales. onLaunch({ budget, days }) se llama al impulsar (analítica).
 * En el template: ref="launchButton" en el botón de impulsar y ref="pauseButton" en el de pausar.
 */
export function useAdsDemo({ budget: initialBudget, days: initialDays, onLaunch }) {
  const budget = ref(initialBudget)
  const days = ref(initialDays)
  const launched = ref(false)
  const total = computed(() => budget.value * days.value)
  const daysLabel = computed(() => `${days.value} ${days.value === 1 ? 'día' : 'días'}`)

  // El botón con foco se desmonta al cambiar de estado: el foco pasa al botón del otro estado (no cae al <body>)
  const launchButton = ref(null)
  const pauseButton = ref(null)
  async function setLaunched(value) {
    launched.value = value
    if (value) onLaunch?.({ budget: budget.value, days: days.value })
    await nextTick()
    const next = value ? pauseButton.value : launchButton.value
    next?.focus()
  }

  return { budget, days, launched, total, daysLabel, launchButton, pauseButton, setLaunched }
}

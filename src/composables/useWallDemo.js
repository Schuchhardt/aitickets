// Lógica compartida de las demos del muro "Quiénes van" de las landings (WallDemo de /organizadores y PartyWall de
// /ticketera-fiestas). Igual que el producto (buyer/AttendeeFeed.vue y netlify/lib/attendee-community.mjs): los mismos
// emojis, mensajes de hasta FEED_MESSAGE_MAX caracteres (el maxlength lo pone cada piel) y conteos de mayor a menor. Es
// una demo local: no publica nada. Cada landing pone su piel, sus mensajes de ejemplo y su evento de analítica.
import { computed, onBeforeUnmount, ref } from 'vue'

/** Mensajes que se pueden publicar en la demo antes de pedir que pare */
export const WALL_DEMO_LIMIT = 3

/**
 * emojis: FEED_EMOJIS (en orden: desempata los conteos). baseCounts = { emoji: n }; basePosts = [{ id, name, emoji, when,
 * text, tint }]. compact: () => boolean (la versión mobile muestra 2 mensajes en vez de 4 y se reacciona con un toque).
 * onReact(emoji, { hasText }) se llama al publicar o tocar una reacción (analítica; hasText: si el mensaje traía texto). mineTint: fondo del avatar de lo que publicas.
 */
export function useWallDemo({ emojis, baseCounts, basePosts, compact = () => false, onReact, mineTint = 'var(--surface-1)' }) {
  const pick = ref(emojis[0])
  const message = ref('')
  const mine = ref([])
  const error = ref('')
  const bumped = ref('')
  // Versión compacta: un toque suma (o quita) tu reacción a ese emoji
  const tapped = ref('')
  let bumpTimer = null

  const counts = computed(() => {
    const c = { ...baseCounts }
    for (const p of mine.value) c[p.emoji] = (c[p.emoji] || 0) + 1
    if (tapped.value) c[tapped.value] = (c[tapped.value] || 0) + 1
    return Object.entries(c)
      .sort((a, b) => b[1] - a[1] || emojis.indexOf(a[0]) - emojis.indexOf(b[0]))
      .map(([emoji, n]) => ({ emoji, n }))
  })
  const posts = computed(() => [...mine.value, ...basePosts].slice(0, compact() ? 2 : 4))

  function bump(emoji) {
    bumped.value = emoji
    clearTimeout(bumpTimer)
    bumpTimer = setTimeout(() => (bumped.value = ''), 400)
  }
  function publish() {
    if (mine.value.length >= WALL_DEMO_LIMIT) {
      error.value = 'Es una demo: con 3 mensajes basta 🙂'
      return
    }
    const text = message.value.trim()
    mine.value = [{ id: `m${Date.now()}`, name: 'Tú', emoji: pick.value, when: 'recién', text: text || `Reaccionó ${pick.value}`, tint: mineTint }, ...mine.value]
    message.value = ''
    error.value = ''
    bump(pick.value)
    onReact?.(pick.value, { hasText: Boolean(text) })
  }
  function tap(emoji) {
    tapped.value = tapped.value === emoji ? '' : emoji
    if (tapped.value) {
      bump(emoji)
      onReact?.(emoji, { hasText: false })
    }
  }
  /** Radiogroup de emojis: las flechas cambian la opción y mueven el foco */
  function onEmojiKey(e, i) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + emojis.length) % emojis.length
    pick.value = emojis[next]
    e.currentTarget.parentElement?.children[next]?.focus()
  }
  onBeforeUnmount(() => clearTimeout(bumpTimer))

  return { pick, message, error, bumped, tapped, counts, posts, publish, tap, onEmojiKey }
}

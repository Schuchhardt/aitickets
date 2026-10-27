<script setup>
// Demo del muro "Quiénes van" (SPEC_landing_productores §5.5b). Igual que el producto (buyer/AttendeeFeed.vue y
// netlify/lib/attendee-community.mjs): los mismos emojis, mensajes de hasta FEED_MESSAGE_MAX caracteres y conteos
// de mayor a menor. Es una demo local: no publica nada. compact = versión mobile (4 chips tocables y 2 mensajes).
// La lógica vive en useWallDemo (compartida con PartyWall de /ticketera-fiestas); aquí van la piel y los mensajes.
// Analítica (§11): lp_wall_demo { emoji, has_text } al publicar o tocar una reacción.
import { trackEvent } from '../../composables/useGoogleAnalytics.js'
import { useWallDemo } from '../../composables/useWallDemo.js'

const props = defineProps({
  emojis: { type: Array, required: true },
  maxLength: { type: Number, required: true },
  compact: { type: Boolean, required: false },
})

const BASE_COUNTS = { '🔥': 38, '🎉': 25, '🙌': 19, '❤️': 12 }
const BASE_POSTS = [
  { id: 'b1', name: 'Camila R.', emoji: '🔥', when: 'hace 2 h', text: 'Primera vez que vengo, ¡qué ganas! ¿Alguien más va sola?', tint: '#fff1e6' },
  { id: 'b2', name: 'Diego M.', emoji: '🎉', when: 'hace 5 h', text: 'Vamos 6 de la pega, nos vemos en primera fila 😅', tint: '#f3eeff' },
  { id: 'b3', name: 'Fran S.', emoji: '🙌', when: 'ayer', text: 'La última vez fue buenísima. Repito.', tint: '#eef8dc' },
]

const { pick, message, error, bumped, tapped, counts, posts, publish, tap, onEmojiKey } = useWallDemo({
  emojis: props.emojis,
  baseCounts: BASE_COUNTS,
  basePosts: BASE_POSTS,
  compact: () => props.compact,
  onReact: (emoji, { hasText }) => trackEvent('lp_wall_demo', { emoji, has_text: hasText }),
})
</script>

<template>
  <div class="wd lp-card" :class="{ 'wd-compact': props.compact }" data-testid="wall-demo">
    <div class="wd-head">
      <p class="wd-title">Quiénes van</p>
      <p class="lp-example">Datos de ejemplo</p>
    </div>

    <ul v-if="!props.compact" class="wd-counts" aria-label="Reacciones">
      <li v-for="r in counts" :key="r.emoji" class="wd-count" :class="{ 'is-bump': bumped === r.emoji }">
        <span aria-hidden="true">{{ r.emoji }}</span><span class="ev-tabular" aria-hidden="true">{{ r.n }}</span>
        <span class="lp-sr-only">{{ r.n }} con {{ r.emoji }}</span>
      </li>
    </ul>
    <div v-else class="wd-counts">
      <button
        v-for="r in counts.slice(0, 4)"
        :key="r.emoji"
        type="button"
        class="wd-count wd-chip"
        :class="{ 'is-bump': bumped === r.emoji, 'is-on': tapped === r.emoji }"
        :aria-pressed="tapped === r.emoji ? 'true' : 'false'"
        :aria-label="`Reaccionar con ${r.emoji}, ${r.n}`"
        @click="tap(r.emoji)"
      >
        <span aria-hidden="true">{{ r.emoji }}</span><span class="ev-tabular" aria-hidden="true">{{ r.n }}</span>
      </button>
    </div>

    <div v-if="!props.compact" class="wd-compose">
      <p id="wd-pick-label" class="wd-compose-title">Tu reacción</p>
      <div class="wd-emojis" role="radiogroup" aria-labelledby="wd-pick-label">
        <button
          v-for="(e, i) in props.emojis"
          :key="e"
          type="button"
          role="radio"
          class="wd-emoji"
          :class="{ 'is-on': pick === e }"
          :aria-checked="pick === e ? 'true' : 'false'"
          :tabindex="pick === e ? 0 : -1"
          @click="pick = e"
          @keydown="onEmojiKey($event, i)"
        >{{ e }}</button>
      </div>
      <form class="wd-form" @submit.prevent="publish">
        <input
          v-model="message"
          class="ev-field wd-input"
          :maxlength="props.maxLength"
          aria-label="Mensaje corto para los demás asistentes"
          placeholder="¡Nos vemos el viernes!"
          data-testid="wall-demo-input"
          @input="error = ''"
        />
        <button type="submit" class="ev-btn ev-btn-primary wd-send" data-testid="wall-demo-publish">Publicar</button>
      </form>
      <p v-if="error" class="ev-error" role="status">{{ error }}</p>
    </div>

    <TransitionGroup name="wd-post" tag="ul" class="wd-posts">
      <li v-for="p in posts" :key="p.id" class="wd-post">
        <span class="wd-avatar" :style="{ background: p.tint }" aria-hidden="true">{{ p.emoji }}</span>
        <div class="wd-post-body">
          <p class="wd-meta"><strong>{{ p.name }}</strong> <span>· {{ p.when }}</span></p>
          <p class="wd-text">{{ p.text }}</p>
        </div>
      </li>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.wd {
  padding: 22px;
}
.wd-compact {
  padding: 16px;
  box-shadow: none;
}
.wd-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.wd-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 17px;
  font-weight: 700;
}
.wd-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.wd-count {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  background: var(--surface-1);
  font-size: 14px;
}
.wd-count .ev-tabular {
  font-size: 12px;
  color: var(--text-2);
}
.wd-chip {
  height: 36px;
  border: 1px solid var(--border);
  background: var(--surface-0);
  font-family: inherit;
  cursor: pointer;
  transition: transform var(--dur-1) var(--ease-spring);
}
.wd-chip.is-on {
  border-color: var(--text-1);
  background: var(--surface-1);
}
.wd-chip:focus-visible,
.wd-emoji:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.is-bump {
  animation: wd-bump 320ms var(--ease-spring);
}
.wd-compose {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
}
.wd-compose-title {
  font-size: 13px;
  font-weight: 600;
}
.wd-emojis {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
  margin-top: 8px;
}
.wd-emoji {
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-0);
  font-size: 18px;
  cursor: pointer;
  transition: transform 160ms var(--ease-spring), border-color var(--dur-1);
}
.wd-emoji.is-on {
  border-color: var(--text-1);
  background: var(--surface-1);
  transform: scale(1.08);
}
.wd-form {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.wd-input {
  flex: 1;
  min-width: 0;
  height: 40px;
  font-size: 14px;
}
.wd-send {
  min-height: 40px;
  padding: 0 14px;
  font-size: 14px;
}
.wd-posts {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}
.wd-post {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.wd-avatar {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 17px;
}
.wd-post-body {
  min-width: 0;
}
.wd-meta {
  font-size: 13px;
}
.wd-meta strong {
  font-weight: 600;
}
.wd-meta span {
  color: var(--text-3);
}
.wd-text {
  font-size: 14px;
  line-height: 20px;
  color: var(--text-1);
  overflow-wrap: anywhere;
}
.wd-post-enter-active {
  animation: wd-pop 360ms var(--ease-out) both;
}
.wd-post-leave-active {
  display: none;
}
@keyframes wd-pop {
  0% {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  60% {
    opacity: 1;
    transform: translateY(0) scale(1.02);
  }
  100% {
    opacity: 1;
    transform: none;
  }
}
@keyframes wd-bump {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.18);
  }
  100% {
    transform: scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-bump,
  .wd-post-enter-active {
    animation-duration: 1ms;
  }
  .wd-emoji,
  .wd-chip {
    transition-duration: 1ms;
  }
}
</style>

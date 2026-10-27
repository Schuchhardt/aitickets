<script setup>
// "Quiénes van" (SPEC_landing_seminarios §4.6): piel de tarjetas de presentación sobre la lógica de la demo del muro
// (useWallDemo, la misma de WallDemo en /organizadores y PartyWall en fiestas): los mismos FEED_EMOJIS, mensajes de hasta
// FEED_MESSAGE_MAX caracteres y conteos de mayor a menor (por props desde attendee-community.mjs). Cada mensaje es una
// tarjeta con el nombre en Archivo 700 y el cargo en meta. Demo local: no publica nada. El muro real lo ven solo quienes
// tienen entrada, moderado por el organizador; por eso el encabezado lo dice. Mobile (< 768 px): versión compacta, 4
// chips tocables y 2 mensajes (las dos versiones salen en el SSR y la media query muestra una u otra, sin saltos).
// Analítica: se_wall_react {emoji}.
import { useWallDemo } from '../../../composables/useWallDemo.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { SEMINAR_WALL_COUNTS, SEMINAR_WALL_POSTS } from './seminariosLanding.js'

const props = defineProps({
  emojis: { type: Array, required: true },
  maxLength: { type: Number, required: true },
})

const { pick, message, error, bumped, tapped, counts, posts, publish, tap, onEmojiKey } = useWallDemo({
  emojis: props.emojis,
  baseCounts: SEMINAR_WALL_COUNTS,
  basePosts: SEMINAR_WALL_POSTS,
  mineTint: 'var(--se-cordon-claro)',
  onReact: (emoji) => trackEvent('se_wall_react', { emoji }),
})
</script>

<template>
  <div class="sw se-card" data-testid="seminar-wall">
    <div class="sw-head">
      <p class="se-h3">Quiénes van</p>
      <p class="se-meta">Lo ven solo quienes tienen entrada</p>
    </div>

    <ul class="sw-counts sw-wide" aria-label="Reacciones">
      <li v-for="r in counts.slice(0, 6)" :key="r.emoji" class="sw-count" :class="{ 'is-bump': bumped === r.emoji }">
        <span aria-hidden="true">{{ r.emoji }}</span><span class="se-tabular" aria-hidden="true">{{ r.n }}</span>
        <span class="lp-sr-only">{{ r.n }} con {{ r.emoji }}</span>
      </li>
    </ul>
    <div class="sw-counts sw-compact">
      <button
        v-for="r in counts.slice(0, 4)"
        :key="r.emoji"
        type="button"
        class="sw-count sw-chip se-focus"
        :class="{ 'is-bump': bumped === r.emoji, 'is-on': tapped === r.emoji }"
        :aria-pressed="tapped === r.emoji ? 'true' : 'false'"
        :aria-label="`Reaccionar con ${r.emoji}, ${r.n}`"
        @click="tap(r.emoji)"
      >
        <span aria-hidden="true">{{ r.emoji }}</span><span class="se-tabular" aria-hidden="true">{{ r.n }}</span>
      </button>
    </div>

    <div class="sw-compose sw-wide">
      <p id="sw-pick-label" class="se-meta">Tu reacción</p>
      <div class="sw-emojis" role="radiogroup" aria-labelledby="sw-pick-label">
        <button
          v-for="(e, i) in props.emojis"
          :key="e"
          type="button"
          role="radio"
          class="sw-emoji se-focus"
          :class="{ 'is-on': pick === e }"
          :aria-checked="pick === e ? 'true' : 'false'"
          :tabindex="pick === e ? 0 : -1"
          @click="pick = e"
          @keydown="onEmojiKey($event, i)"
        >{{ e }}</button>
      </div>
      <form class="sw-form" @submit.prevent="publish">
        <input
          v-model="message"
          class="se-field sw-input"
          :maxlength="props.maxLength"
          aria-label="Mensaje corto para los demás asistentes"
          placeholder="¡Nos vemos en el café!"
          data-testid="seminar-wall-input"
          @input="error = ''"
        />
        <button type="submit" class="se-btn se-btn-solid sw-send" data-testid="seminar-wall-publish">Publicar</button>
      </form>
      <p v-if="error" class="sw-error" role="status">{{ error }}</p>
    </div>

    <TransitionGroup name="sw-post" tag="ul" class="sw-posts">
      <li v-for="p in posts" :key="p.id" class="sw-post">
        <span class="sw-avatar" :style="{ background: p.tint }" aria-hidden="true">{{ p.emoji }}</span>
        <div class="sw-body">
          <p class="sw-name">{{ p.name }} <span class="se-meta">· {{ p.when }}</span></p>
          <p v-if="p.role" class="se-meta sw-role">{{ p.role }}</p>
          <p class="sw-text">{{ p.text }}</p>
        </div>
      </li>
    </TransitionGroup>
    <p class="se-example sw-example">Demo con datos de ejemplo: aquí no se publica nada.</p>
  </div>
</template>

<style scoped>
.sw {
  min-width: 0;
  padding: 18px;
}
.sw-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px 12px;
}
.sw-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.sw-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--se-filete);
  border-radius: 2px;
  background: var(--se-papel);
  font-size: 15px;
}
.sw-count .se-tabular {
  font-size: 13px;
  font-weight: 700;
}
.sw-count.is-bump {
  animation: sw-bump 400ms var(--se-ease);
}
@keyframes sw-bump {
  50% {
    transform: translateY(-4px);
  }
}
.sw-chip {
  min-height: 44px;
  font: inherit;
  cursor: pointer;
}
.sw-chip.is-on {
  border-color: var(--se-cordon);
  background: var(--se-cordon-claro);
}
.sw-compact {
  display: flex;
}
.sw-wide {
  display: none;
}
.sw-compose {
  margin-top: 16px;
}
.sw-emojis {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.sw-emoji {
  width: 40px;
  height: 40px;
  border: 1px solid var(--se-filete);
  border-radius: 2px;
  background: #ffffff;
  font-size: 18px;
  cursor: pointer;
}
.sw-emoji.is-on {
  border-color: var(--se-grafito);
  box-shadow: inset 0 -3px 0 var(--se-cordon);
}
.sw-form {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.sw-input {
  flex: 1 1 auto;
  min-width: 0;
}
.sw-send {
  min-height: 44px;
  padding: 0 16px;
  justify-content: center;
}
.sw-error {
  margin-top: 6px;
  font-size: 13px;
  color: var(--se-text-2);
}
.sw-posts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}
.sw-post {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--se-filete);
  border-left: 3px solid var(--se-cordon);
  border-radius: 2px;
  background: #ffffff;
}
.sw-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--se-filete);
  border-radius: 2px;
  font-size: 17px;
}
.sw-name {
  font-family: var(--se-font);
  font-weight: 700;
  font-size: 15px;
}
.sw-role {
  margin-top: 1px;
}
.sw-text {
  margin-top: 4px;
  font-size: 14px;
  line-height: 21px;
  color: var(--se-text-2);
}
.sw-example {
  margin-top: 10px;
}
.sw-post-enter-active {
  transition: opacity 260ms var(--se-ease), transform 260ms var(--se-ease);
}
.sw-post-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.sw-post-leave-active {
  display: none;
}
@media (min-width: 768px) {
  .sw {
    padding: 22px;
  }
  .sw-wide {
    display: block;
  }
  .sw-counts.sw-wide {
    display: flex;
  }
  .sw-compact {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sw-count.is-bump {
    animation: none;
  }
  .sw-post-enter-active {
    transition: none;
  }
}
</style>

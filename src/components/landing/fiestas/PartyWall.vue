<script setup>
// "Quiénes van" (SPEC_landing_fiestas §4.6): piel sticker sobre la lógica de la demo del muro (useWallDemo, la misma de
// WallDemo en /organizadores): los mismos FEED_EMOJIS, mensajes de hasta FEED_MESSAGE_MAX caracteres y conteos de mayor
// a menor (por props desde attendee-community.mjs). Los conteos son stickers circle y los mensajes stickers pill con su
// nombre. Demo local: no publica nada. El muro real lo ven solo quienes tienen entrada (página de su orden o de su
// entrada), por eso el encabezado lo dice. Mobile (< 768 px): versión compacta, 4 chips tocables y 2 mensajes. Las dos
// versiones salen en el SSR y la media query muestra una u otra (no un ref que cambia al montar: la isla hidrata al
// entrar en pantalla y el cambio de alto se vería, CLS §7).
// F11: la reacción nueva salta. Analítica: fi_wall_react {emoji}.
import { useWallDemo } from '../../../composables/useWallDemo.js'
import { trackEvent } from '../../../composables/useGoogleAnalytics.js'
import { PARTY_WALL_COUNTS, PARTY_WALL_POSTS } from './fiestasLanding.js'

const props = defineProps({
  emojis: { type: Array, required: true },
  maxLength: { type: Number, required: true },
})

const { pick, message, error, bumped, tapped, counts, posts, publish, tap, onEmojiKey } = useWallDemo({
  emojis: props.emojis,
  baseCounts: PARTY_WALL_COUNTS,
  basePosts: PARTY_WALL_POSTS,
  mineTint: 'var(--brand-lime)',
  onReact: (emoji) => trackEvent('fi_wall_react', { emoji }),
})
</script>

<template>
  <div class="pw" data-testid="party-wall">
    <div class="pw-head">
      <p class="pw-title fi-display">Quiénes van</p>
      <p class="fi-meta">Lo ven solo quienes tienen entrada</p>
    </div>

    <ul class="pw-counts pw-wide" aria-label="Reacciones">
      <li
        v-for="(r, i) in counts.slice(0, 6)"
        :key="r.emoji"
        class="fi-sticker fi-sticker--circle fi-tone-crema pw-count"
        :class="{ 'is-bump': bumped === r.emoji }"
        :style="{ '--tilt': `${[-4, 3, -2, 4, -3, 2][i]}deg` }"
      >
        <span class="fi-sticker-paper" aria-hidden="true"></span>
        <span class="fi-sticker-ink" aria-hidden="true"></span>
        <span class="fi-sticker-body pw-count-body">
          <span aria-hidden="true">{{ r.emoji }}</span><span class="fi-tabular" aria-hidden="true">{{ r.n }}</span>
          <span class="lp-sr-only">{{ r.n }} con {{ r.emoji }}</span>
        </span>
      </li>
    </ul>
    <div class="pw-counts pw-compact">
      <button
        v-for="r in counts.slice(0, 4)"
        :key="r.emoji"
        type="button"
        class="pw-chip"
        :class="{ 'is-bump': bumped === r.emoji, 'is-on': tapped === r.emoji }"
        :aria-pressed="tapped === r.emoji ? 'true' : 'false'"
        :aria-label="`Reaccionar con ${r.emoji}, ${r.n}`"
        @click="tap(r.emoji)"
      >
        <span aria-hidden="true">{{ r.emoji }}</span><span class="fi-tabular" aria-hidden="true">{{ r.n }}</span>
      </button>
    </div>

    <div class="pw-compose pw-wide">
      <p id="pw-pick-label" class="pw-compose-title">Tu reacción</p>
      <div class="pw-emojis" role="radiogroup" aria-labelledby="pw-pick-label">
        <button
          v-for="(e, i) in props.emojis"
          :key="e"
          type="button"
          role="radio"
          class="pw-emoji"
          :class="{ 'is-on': pick === e }"
          :aria-checked="pick === e ? 'true' : 'false'"
          :tabindex="pick === e ? 0 : -1"
          @click="pick = e"
          @keydown="onEmojiKey($event, i)"
        >{{ e }}</button>
      </div>
      <form class="pw-form" @submit.prevent="publish">
        <input
          v-model="message"
          class="fi-field pw-input"
          :maxlength="props.maxLength"
          aria-label="Mensaje corto para los demás asistentes"
          placeholder="¡Nos vemos el sábado!"
          data-testid="party-wall-input"
          @input="error = ''"
        />
        <button type="submit" class="fi-btn fi-btn-tinta pw-send" data-testid="party-wall-publish">Publicar</button>
      </form>
      <p v-if="error" class="pw-error" role="status">{{ error }}</p>
    </div>

    <TransitionGroup name="pw-post" tag="ul" class="pw-posts">
      <li v-for="(p, i) in posts" :key="p.id" class="pw-post" :style="{ '--tilt': `${i % 2 ? 0.8 : -0.8}deg` }">
        <span class="pw-avatar" :style="{ background: p.tint }" aria-hidden="true">{{ p.emoji }}</span>
        <div class="pw-post-body">
          <p class="pw-meta"><strong>{{ p.name }}</strong> <span>· {{ p.when }}</span></p>
          <p class="pw-text">{{ p.text }}</p>
        </div>
      </li>
    </TransitionGroup>
    <p class="fi-example pw-example">Demo con datos de ejemplo: aquí no se publica nada.</p>
  </div>
</template>

<style scoped>
.pw {
  min-width: 0;
}
.pw-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px 12px;
}
.pw-title {
  font-size: 30px;
  line-height: 32px;
}
.pw-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 18px;
}
.pw-count {
  width: 76px;
  padding: 10px;
}
.pw-count-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 20px;
  line-height: 22px;
}
.pw-count-body .fi-tabular {
  font-size: 13px;
  font-weight: 700;
}
.pw-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 14px;
  border: 2px solid var(--fi-tinta);
  border-radius: 999px;
  background: var(--fi-crema);
  box-shadow: 2px 2px 0 var(--fi-tinta);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
}
.pw-chip .fi-tabular {
  font-size: 13px;
  font-weight: 700;
}
.pw-chip.is-on {
  background: var(--fi-amarillo);
}
.pw-chip:focus-visible,
.pw-emoji:focus-visible {
  outline: 3px solid var(--fi-cobalto);
  outline-offset: 2px;
}
.is-bump {
  animation: fi-bump 240ms var(--ease-out);
}
.pw-compose {
  margin-top: 20px;
  padding: 14px;
  border: 2px solid var(--fi-tinta);
  border-radius: 16px;
  background: #fff;
}
.pw-compose-title {
  font-size: 13px;
  font-weight: 700;
}
.pw-emojis {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
  margin-top: 8px;
}
.pw-emoji {
  height: 40px;
  border: 2px solid transparent;
  border-radius: 10px;
  background: var(--fi-crema);
  font-size: 18px;
  cursor: pointer;
}
.pw-emoji.is-on {
  border-color: var(--fi-tinta);
  background: var(--fi-amarillo);
}
.pw-form {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.pw-input {
  flex: 1;
  min-width: 0;
  font-size: 15px;
}
.pw-send {
  min-height: 44px;
  padding: 0 16px;
  font-size: 14px;
}
.pw-error {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
}
.pw-posts {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 22px;
}
.pw-post {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 16px 12px 10px;
  border: 2px solid var(--fi-tinta);
  border-radius: 28px;
  background: var(--fi-crema);
  box-shadow: 3px 3px 0 var(--fi-tinta);
  transform: rotate(var(--tilt));
}
.pw-avatar {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--fi-tinta);
  border-radius: 50%;
  font-size: 17px;
}
.pw-post-body {
  min-width: 0;
}
.pw-meta {
  font-size: 13px;
}
.pw-meta strong {
  font-weight: 700;
}
.pw-meta span {
  color: var(--fi-text-3);
}
.pw-text {
  font-size: 15px;
  line-height: 21px;
  overflow-wrap: anywhere;
}
.pw-example {
  margin-top: 14px;
}
.pw-post-enter-active {
  animation: fi-pop 360ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.pw-post-leave-active {
  display: none;
}
/* Versión completa (≥ 768 px) o compacta: 4 chips tocables y solo los 2 primeros mensajes */
.pw-compact {
  display: none;
}
@media (max-width: 767px) {
  .pw-wide,
  .pw-post:nth-child(n + 3) {
    display: none;
  }
  .pw-compact {
    display: flex;
  }
  .pw-post {
    transform: rotate(calc(var(--tilt) / 1.5));
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-bump,
  .pw-post-enter-active {
    animation: none;
  }
}
</style>

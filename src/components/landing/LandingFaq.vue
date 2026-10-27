<script setup>
// Preguntas frecuentes de las landings rediseñadas (SPEC_landing_productores §5.8): acordeón con una pregunta abierta
// a la vez y altura animada con grid-rows (.ev-collapse, como el FAQ de la página del evento). El HTML sale del SSR,
// así las respuestas están en la página aunque no haya JS; el JSON-LD FAQPage lo arma la página. Las respuestas
// cerradas van con inert (solo se ocultan con opacidad): así no las leen los lectores ni se tabulan sus links.
import { ref } from 'vue'
import { TERMS_NOTE } from '../../data/producerFaq'

const props = defineProps({
  items: { type: Array, required: true }, // [{ q, a, terms? }]
  idPrefix: { type: String, required: false },
})

const prefix = props.idPrefix || 'faq'
const open = ref(-1)
const toggle = (i) => {
  open.value = open.value === i ? -1 : i
}
</script>

<template>
  <div class="lf" data-testid="landing-faq">
    <div v-for="(item, i) in props.items" :key="item.q" class="lf-item">
      <h3 class="lf-h">
        <button
          type="button"
          class="lf-q"
          :aria-expanded="open === i ? 'true' : 'false'"
          :aria-controls="`${prefix}-a-${i}`"
          :id="`${prefix}-q-${i}`"
          @click="toggle(i)"
        >
          <span>{{ item.q }}</span>
          <svg class="lf-icon" :class="{ 'is-open': open === i }" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </h3>
      <div :id="`${prefix}-a-${i}`" class="ev-collapse" :class="{ 'is-open': open === i }" role="region" :aria-labelledby="`${prefix}-q-${i}`" :inert="open !== i">
        <div>
          <p class="lf-a">
            {{ item.a }}
            <a v-if="item.terms" :href="TERMS_NOTE.href" class="lf-terms">{{ TERMS_NOTE.text }}</a>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lf {
  border-top: 1px solid var(--border-strong);
}
.lf-item {
  border-bottom: 1px solid var(--border-strong);
}
.lf-h {
  margin: 0;
  font: inherit;
}
.lf-q {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  color: var(--text-1);
  text-align: left;
  cursor: pointer;
}
.lf-q:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
  border-radius: 4px;
}
.lf-icon {
  flex: 0 0 auto;
  color: var(--text-2);
  transition: transform var(--dur-2) var(--ease-in-out);
}
.lf-icon.is-open {
  transform: rotate(45deg);
}
.lf-a {
  max-width: 640px;
  margin: 0 0 20px;
  font-size: 15px;
  line-height: 24px;
  color: var(--text-2);
}
.lf-terms {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3);
  text-decoration: underline;
}
@media (min-width: 768px) {
  .lf-q {
    padding: 22px 0;
    font-size: 17px;
  }
  .lf-a {
    font-size: 16px;
    line-height: 26px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lf-icon {
    transition-duration: 1ms;
  }
}
</style>

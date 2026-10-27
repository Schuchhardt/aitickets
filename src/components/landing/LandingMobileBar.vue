<script setup>
// Barra CTA inferior en mobile (SPEC_landing_productores §6, misma idea que la de la página del evento): aparece cuando
// el CTA del hero ([data-hero-cta]) sale de la pantalla y se esconde cuando el cierre ([data-final-cta]) entra, para no
// duplicar el CTA; sigue escondida pasado el cierre, para no tapar el footer. Solo bajo 768 px.
// variant="pill": la versión flotante y oscura de la landing de stand-up (SPEC_landing_standup §3), con el CTA lima.
// variant="pill-light": la misma píldora en blanco con el CTA tinta, para la landing de academias
// (SPEC_landing_academias §3.10). title, subtitle y ctaLabel cambian los textos (por defecto, los de publicar).
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  publishHref: { type: String, required: true },
  /** 'bar' (por defecto, barra blanca a todo el ancho) | 'pill' (flotante, oscura) | 'pill-light' (flotante, blanca) */
  variant: { type: String, required: false },
  title: { type: String, required: false },
  subtitle: { type: String, required: false },
  ctaLabel: { type: String, required: false },
})

const heroGone = ref(false)
const finalVisible = ref(false)
let observer = null

onMounted(() => {
  const hero = document.querySelector('[data-hero-cta]')
  const final = document.querySelector('[data-final-cta]')
  if (!('IntersectionObserver' in window) || !hero) return
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === hero) heroGone.value = !entry.isIntersecting && entry.boundingClientRect.top < 0
      // El cierre cuenta como alcanzado mientras está en pantalla o ya quedó arriba (footer)
      else finalVisible.value = entry.isIntersecting || entry.boundingClientRect.top < 0
    }
  })
  observer.observe(hero)
  if (final) observer.observe(final)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <Transition name="lmb">
    <div
      v-if="heroGone && !finalVisible"
      class="lmb"
      :class="{ 'lmb-pill': props.variant === 'pill', 'lmb-pill lmb-pill-light': props.variant === 'pill-light' }"
      data-testid="landing-mobile-bar"
    >
      <div class="lmb-copy">
        <p class="lmb-title">{{ props.title || 'Gratis para publicar' }}</p>
        <p class="lmb-sub">{{ props.subtitle || '0% de comisión para ti' }}</p>
      </div>
      <a
        :href="props.publishHref"
        class="ev-btn lmb-cta"
        :class="props.variant === 'pill' ? 'lmb-cta-lime' : props.variant === 'pill-light' ? 'lmb-cta-ink' : 'ev-btn-primary'"
        data-cta="publish"
        data-section="mobile_bar"
      >{{ props.ctaLabel || 'Publicar función' }}</a>
    </div>
  </Transition>
</template>

<style scoped>
.lmb {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.92);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--border);
  font-family: "Prompt", system-ui, sans-serif;
}
.lmb-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.lmb-sub {
  font-size: 12px;
  color: var(--text-2);
}
.lmb-cta {
  flex: 0 0 auto;
  font-size: 15px;
  text-decoration: none;
}
.lmb-pill {
  left: 12px;
  right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom));
  padding: 8px 8px 8px 20px;
  border: 1px solid rgba(244, 237, 228, 0.14);
  border-radius: 999px;
  background: rgba(23, 18, 15, 0.92);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
}
.lmb-pill .lmb-title {
  font-size: 14px;
  color: #f4ede4;
}
.lmb-pill .lmb-sub {
  color: #b5aba0;
}
.lmb-cta-lime {
  min-height: 44px;
  border: 0;
  border-radius: 999px;
  background: var(--brand-lime);
  color: #0e0b09;
}
.lmb-cta-lime:focus-visible {
  box-shadow: 0 0 0 3px #0e0b09, 0 0 0 6px var(--brand-lime);
}
.lmb-pill-light {
  border-color: rgba(27, 23, 18, 0.1);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 10px 30px rgba(27, 23, 18, 0.12);
}
.lmb-pill-light .lmb-title {
  font-size: 13px;
  color: #1b1712;
}
.lmb-pill-light .lmb-sub {
  color: #6f665c;
}
.lmb-cta-ink {
  min-height: 48px;
  border: 0;
  border-radius: 999px;
  background: #1b1712;
  color: #fbf7f0;
}
.lmb-cta-ink:focus-visible {
  box-shadow: 0 0 0 3px #fff, 0 0 0 5px #1b1712;
}
.lmb-pill.lmb-enter-from,
.lmb-pill.lmb-leave-to {
  transform: translateY(calc(100% + 24px));
}
.lmb-enter-active,
.lmb-leave-active {
  transition: transform var(--dur-3) var(--ease-out);
}
.lmb-enter-from,
.lmb-leave-to {
  transform: translateY(100%);
}
@media (min-width: 768px) {
  .lmb {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lmb-enter-active,
  .lmb-leave-active {
    transition-duration: 1ms;
  }
}
</style>

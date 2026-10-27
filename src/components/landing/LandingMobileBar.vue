<script setup>
// Barra CTA inferior en mobile (SPEC_landing_productores §6, misma idea que la de la página del evento): aparece cuando
// el CTA del hero ([data-hero-cta]) sale de la pantalla y se esconde cuando el cierre ([data-final-cta]) entra, para no
// duplicar el CTA; sigue escondida pasado el cierre, para no tapar el footer. Solo bajo 768 px.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  publishHref: { type: String, required: true },
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
    <div v-if="heroGone && !finalVisible" class="lmb" data-testid="landing-mobile-bar">
      <div class="lmb-copy">
        <p class="lmb-title">Gratis para publicar</p>
        <p class="lmb-sub">0% de comisión para ti</p>
      </div>
      <a :href="props.publishHref" class="ev-btn ev-btn-primary lmb-cta" data-cta="publish" data-section="mobile_bar">Publicar función</a>
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

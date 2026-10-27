<script setup>
// Header de la landing de productores (SPEC_landing_productores §4). Sticky: transparente arriba y, pasados 8 px de
// scroll, blanco al 92 % con blur y borde. El botón "Publicar función" solo aparece cuando el CTA del hero
// ([data-hero-cta]) salió de la pantalla, para no tener dos CTA iguales a la vista. En mobile: logo, Ingresar y menú.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu, X } from 'lucide-vue-next'
import logoLight from '../../images/logo.png'
import { fetchSession } from '../../lib/sessionHints.js'

const props = defineProps({
  publishHref: { type: String, required: true },
})

const scrolled = ref(false)
const heroGone = ref(false)
const menuOpen = ref(false)
const menuButton = ref(null)
const sheet = ref(null)
// Con sesión de productor, "Ingresar" lleva directo al panel (igual que AppHeader)
const producer = ref(null)
const accountHref = computed(() => (producer.value ? '/dashboard' : '/organizadores/login'))
const accountLabel = computed(() => (producer.value ? 'Ir a mi panel' : 'Ingresar'))

const links = [
  { href: '/eventos', label: 'Eventos' },
  { href: '#precios', label: 'Precios' },
]

let observer = null
const onScroll = () => {
  scrolled.value = window.scrollY > 8
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) nextTick(() => sheet.value?.querySelector('a')?.focus())
}
function closeMenu({ restoreFocus = false } = {}) {
  menuOpen.value = false
  if (restoreFocus) menuButton.value?.focus()
}
function onKeydown(e) {
  if (e.key === 'Escape' && menuOpen.value) closeMenu({ restoreFocus: true })
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('keydown', onKeydown)
  const heroCta = document.querySelector('[data-hero-cta]')
  if (heroCta && 'IntersectionObserver' in window) {
    // Sale de pantalla hacia arriba (no cuenta cuando todavía está más abajo del pliegue)
    observer = new IntersectionObserver(([entry]) => {
      heroGone.value = !entry.isIntersecting && entry.boundingClientRect.top < 0
    })
    observer.observe(heroCta)
  } else {
    heroGone.value = true
  }
  fetchSession().then((s) => {
    producer.value = s?.producer || null
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  document.removeEventListener('keydown', onKeydown)
  observer?.disconnect()
})
</script>

<template>
  <header class="lh" :class="{ 'is-scrolled': scrolled || menuOpen }" data-testid="landing-header">
    <div class="lh-inner">
      <a href="/" class="lh-logo" aria-label="AI Tickets, inicio">
        <img :src="logoLight.src" alt="" width="152" height="32" />
      </a>

      <nav class="lh-nav" aria-label="Principal">
        <a v-for="l in links" :key="l.href" :href="l.href" class="lh-link">{{ l.label }}</a>
        <a :href="accountHref" class="lh-link">{{ accountLabel }}</a>
        <a
          :href="props.publishHref"
          class="lh-cta"
          :class="{ 'is-visible': heroGone }"
          :aria-hidden="heroGone ? 'false' : 'true'"
          :tabindex="heroGone ? 0 : -1"
          data-cta="publish"
          data-section="header"
          data-testid="landing-header-cta"
        >Publicar función</a>
      </nav>

      <div class="lh-mobile">
        <a :href="accountHref" class="lh-link lh-link-strong">{{ accountLabel }}</a>
        <button
          ref="menuButton"
          type="button"
          class="lh-menu-btn"
          :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          aria-controls="landing-menu"
          @click="toggleMenu"
        >
          <X v-if="menuOpen" :size="18" aria-hidden="true" />
          <Menu v-else :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>

    <Transition name="lh-sheet">
      <div v-if="menuOpen" id="landing-menu" ref="sheet" class="lh-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="lh-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/mis-entradas" class="lh-sheet-link" @click="closeMenu()">Mis entradas</a>
        <a :href="accountHref" class="lh-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="ev-btn ev-btn-primary lh-sheet-cta" data-cta="publish" data-section="header_menu">Publicar función</a>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.lh {
  position: sticky;
  top: 0;
  z-index: 40;
  background: rgba(255, 255, 255, 0);
  border-bottom: 1px solid transparent;
  transition: background-color var(--dur-2) var(--ease-out), border-color var(--dur-2) var(--ease-out);
}
.lh.is-scrolled {
  background: rgba(255, 255, 255, 0.92);
  border-bottom-color: var(--border);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}
.lh-inner {
  max-width: 1120px;
  height: 56px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.lh-logo {
  display: inline-flex;
  border-radius: 6px;
}
.lh-logo img {
  height: 28px;
  width: auto;
}
.lh-logo:focus-visible,
.lh-link:focus-visible,
.lh-sheet-link:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 3px;
}
.lh-nav {
  display: none;
  align-items: center;
  gap: 28px;
}
.lh-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
  text-decoration: none;
  border-radius: 4px;
  transition: color var(--dur-1) var(--ease-out);
}
.lh-link:hover,
.lh-link-strong {
  color: var(--text-1);
}
.lh-cta {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 16px;
  border-radius: var(--r-pill);
  background: var(--brand-ink);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  opacity: 0;
  transform: translateY(-4px);
  pointer-events: none;
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out), background-color var(--dur-1);
}
.lh-cta.is-visible {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.lh-cta:hover {
  background: #222;
}
.lh-cta:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px #fff, 0 0 0 6px var(--brand-lime);
}
.lh-mobile {
  display: flex;
  align-items: center;
  gap: 14px;
}
.lh-menu-btn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface-0);
  color: var(--text-1);
  cursor: pointer;
}
.lh-menu-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px #fff, 0 0 0 6px var(--brand-lime);
}
.lh-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 8px 16px 20px;
  display: flex;
  flex-direction: column;
  background: var(--surface-0);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.08);
}
.lh-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  font-size: 16px;
  font-weight: 500;
  color: var(--text-1);
  text-decoration: none;
}
.lh-sheet-cta {
  margin-top: 16px;
  text-decoration: none;
}
.lh-sheet-enter-active,
.lh-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.lh-sheet-enter-from,
.lh-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (min-width: 768px) {
  .lh-inner {
    height: 68px;
    padding: 0 32px;
  }
  .lh-logo img {
    height: 32px;
  }
  .lh-nav {
    display: flex;
  }
  .lh-mobile,
  .lh-sheet {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .lh,
  .lh-cta,
  .lh-sheet-enter-active,
  .lh-sheet-leave-active {
    transition-duration: 1ms;
  }
}
</style>

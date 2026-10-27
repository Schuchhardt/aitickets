<script setup>
// Header de la landing de academias (SPEC_landing_academias §3.1, header sticky de SPEC_landing_productores §4). Sticky
// sobre el papel; pasados 8 px de scroll, papel translúcido con blur y borde. Links: Cómo funciona (#como), Precio
// (#precio), Ingresar y el botón tinta "Crear mi muestra". En mobile: logo y botón de menú circular. Con sesión de
// productor, "Ingresar" pasa a "Ir a mi panel" (igual que LandingHeader y StandupHeader).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Menu, X } from 'lucide-vue-next'
import logo from '../../../images/logo.png'
import { fetchSession } from '../../../lib/sessionHints.js'

const props = defineProps({
  publishHref: { type: String, required: true },
})

const scrolled = ref(false)
const menuOpen = ref(false)
const menuButton = ref(null)
const sheet = ref(null)
const producer = ref(null)
const accountHref = computed(() => (producer.value ? '/dashboard' : '/organizadores/login'))
const accountLabel = computed(() => (producer.value ? 'Ir a mi panel' : 'Ingresar'))

const links = [
  { href: '#como', label: 'Cómo funciona' },
  { href: '#precio', label: 'Precio' },
]

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
  fetchSession().then((s) => {
    producer.value = s?.producer || null
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <header class="ah" :class="{ 'is-scrolled': scrolled || menuOpen }" data-testid="academy-header">
    <div class="ah-inner">
      <a href="/" class="ah-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="" width="152" height="32" />
      </a>

      <nav class="ah-nav" aria-label="Principal">
        <a v-for="l in links" :key="l.href" :href="l.href" class="ah-link">{{ l.label }}</a>
        <a :href="accountHref" class="ah-link">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="ah-cta" data-cta="publish" data-section="header">Crear mi muestra</a>
      </nav>

      <button
        ref="menuButton"
        type="button"
        class="ah-menu-btn"
        :aria-label="menuOpen ? 'Cerrar menú' : 'Abrir menú'"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        aria-controls="academy-menu"
        @click="toggleMenu"
      >
        <X v-if="menuOpen" :size="18" aria-hidden="true" />
        <Menu v-else :size="18" aria-hidden="true" />
      </button>
    </div>

    <Transition name="ah-sheet">
      <div v-if="menuOpen" id="academy-menu" ref="sheet" class="ah-sheet">
        <a v-for="l in links" :key="l.href" :href="l.href" class="ah-sheet-link" @click="closeMenu()">{{ l.label }}</a>
        <a href="/organizadores" class="ah-sheet-link" @click="closeMenu()">Para organizadores</a>
        <a :href="accountHref" class="ah-sheet-link" @click="closeMenu()">{{ accountLabel }}</a>
        <a :href="props.publishHref" class="ac-btn ac-btn-ink ah-sheet-cta" data-cta="publish" data-section="header_menu">Crear mi muestra</a>
      </div>
    </Transition>
  </header>
</template>

<style scoped>
.ah {
  position: sticky;
  top: 0;
  z-index: 40;
  border-bottom: 1px solid transparent;
  background: rgba(251, 247, 240, 0);
  font-family: "Prompt", system-ui, sans-serif;
  transition: background-color 220ms var(--ease-out), border-color 220ms var(--ease-out);
}
.ah.is-scrolled {
  background: rgba(251, 247, 240, 0.9);
  border-bottom-color: var(--ac-line);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}
.ah-inner {
  max-width: 1200px;
  height: 60px;
  margin: 0 auto;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.ah-logo {
  display: inline-flex;
  border-radius: 6px;
}
.ah-logo img {
  height: 24px;
  width: auto;
}
.ah-logo:focus-visible,
.ah-link:focus-visible,
.ah-sheet-link:focus-visible {
  outline: 2px solid var(--ac-ink);
  outline-offset: 3px;
}
.ah-nav {
  display: none;
  align-items: center;
  gap: 28px;
}
.ah-link {
  font-size: 14px;
  font-weight: 500;
  color: var(--ac-text-3);
  text-decoration: none;
  border-radius: 4px;
  transition: color var(--dur-1) var(--ease-out);
}
.ah-link:hover {
  color: var(--ac-ink);
}
.ah-cta {
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  background: var(--ac-ink);
  color: var(--ac-on-ink-1);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: background-color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.ah-cta:hover {
  background: var(--ac-ink-hover);
  transform: translateY(-1px);
}
.ah-cta:focus-visible,
.ah-menu-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--ac-paper), 0 0 0 5px var(--ac-ink);
}
.ah-menu-btn {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ac-line-strong);
  border-radius: 50%;
  background: var(--ac-card);
  color: var(--ac-ink);
  cursor: pointer;
}
.ah-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  padding: 8px 16px 20px;
  display: flex;
  flex-direction: column;
  background: var(--ac-paper);
  border-bottom: 1px solid var(--ac-line);
  box-shadow: 0 16px 32px rgba(70, 50, 30, 0.12);
}
.ah-sheet-link {
  padding: 14px 0;
  border-bottom: 1px solid var(--ac-line);
  font-size: 16px;
  font-weight: 500;
  color: var(--ac-ink);
  text-decoration: none;
}
.ah-sheet-cta {
  margin-top: 16px;
}
.ah-sheet-enter-active,
.ah-sheet-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.ah-sheet-enter-from,
.ah-sheet-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@media (min-width: 900px) {
  .ah-inner {
    height: 68px;
    padding: 0 40px;
  }
  .ah-logo img {
    height: 28px;
  }
  .ah-nav {
    display: flex;
  }
  .ah-menu-btn,
  .ah-sheet {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ah,
  .ah-cta,
  .ah-sheet-enter-active,
  .ah-sheet-leave-active {
    transition-duration: 1ms;
  }
}
</style>

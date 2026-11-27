<script setup>
// Menú del sitio (content.layout.nav): barra superior, centrada o lateral. En el celular todas se vuelven una barra con
// botón de menú que abre un panel (<dialog class="sn-drawer">, src/lib/siteInteractions.js).
import { computed, inject } from "vue";

const props = defineProps({
  navItems: { type: Array, required: true }, // [{ label, href }]
  navStyle: { type: String, default: "top" }, // top | centered | sidebar
  /** El encabezado va sobre la portada (imagen o video de fondo). */
  over: { type: Boolean, default: false },
  sticky: { type: Boolean, default: false },
});
const sn = inject("sn");

const home = computed(() => sn.base || "/");
const SOCIAL_LABELS = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", x: "X", youtube: "YouTube", whatsapp: "WhatsApp", website: "Web" };
const socials = computed(() => Object.entries(sn.site.socials || {}));
</script>

<template>
  <header
    class="sn-header"
    :class="[`sn-header--${navStyle}`, { 'sn-header--over': over, 'sn-header--sticky': sticky && navStyle !== 'sidebar' }]"
  >
    <div class="sn-wrap sn-header-inner">
      <a :href="home" class="sn-logo">
        <img v-if="sn.state.theme.logo_url" :src="sn.state.theme.logo_url" :alt="sn.state.name" height="40" />
        <span v-else v-bind="sn.ed('site.title', 'Nombre de tu productora')">{{ sn.state.name }}</span>
      </a>
      <p v-if="navStyle === 'sidebar' && sn.state.tagline" class="sn-sidebar-tagline">{{ sn.state.tagline }}</p>
      <nav class="sn-nav" aria-label="Secciones">
        <a v-for="item in navItems" :key="item.href + item.label" :href="item.href" class="sn-nav-link">{{ item.label }}</a>
        <a href="#eventos" class="sn-btn sn-btn--sm sn-nav-cta">Entradas</a>
      </nav>
      <ul v-if="navStyle === 'sidebar' && socials.length" class="sn-sidebar-socials">
        <li v-for="[key, url] in socials" :key="key">
          <a :href="url" target="_blank" rel="noopener noreferrer nofollow">{{ SOCIAL_LABELS[key] || key }}</a>
        </li>
      </ul>
      <button type="button" class="sn-menu-btn" data-sn-open="sn-menu" aria-haspopup="dialog" aria-controls="sn-menu">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <span class="sr-only">Abrir menú</span>
      </button>
    </div>

    <dialog id="sn-menu" class="sn-dialog sn-drawer" aria-label="Menú">
      <div class="sn-dialog-box">
        <div class="sn-drawer-top">
          <span class="sn-logo"><span>{{ sn.state.name }}</span></span>
          <button type="button" class="sn-dialog-close" data-sn-close aria-label="Cerrar menú">×</button>
        </div>
        <nav class="sn-drawer-nav" aria-label="Secciones">
          <a v-for="item in navItems" :key="item.href + item.label" :href="item.href">{{ item.label }}</a>
        </nav>
        <a href="#eventos" class="sn-btn">Ver eventos y entradas</a>
      </div>
    </dialog>
  </header>
</template>

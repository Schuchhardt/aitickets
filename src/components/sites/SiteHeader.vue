<script setup>
// Encabezado de un sitio de productor. Se renderiza en el servidor (sin hidratar).
defineProps({
  site: { type: Object, required: true }, // PublicSiteProps (src/lib/sites.ts)
  base: { type: String, default: "" }, // "" en dominio propio, "/o/<slug>" en aitickets.cl
  variant: { type: String, default: "light" }, // light | dark | transparent
});
</script>

<template>
  <header
    class="site-font w-full"
    :class="{
      'bg-[var(--site-bg)] border-b border-black/5': variant === 'light',
      'bg-black/40 backdrop-blur text-white': variant === 'dark',
      'absolute top-0 left-0 right-0 z-20 text-white': variant === 'transparent',
    }"
  >
    <div class="max-w-6xl mx-auto px-5 lg:px-8 py-4 flex items-center justify-between gap-4">
      <a :href="base || '/'" class="flex items-center gap-3 min-w-0">
        <img
          v-if="site.theme.logo_url"
          :src="site.theme.logo_url"
          :alt="site.name"
          class="h-10 w-auto max-w-[160px] object-contain"
          height="40"
        />
        <span v-else class="text-lg font-bold truncate">{{ site.name }}</span>
      </a>
      <nav class="flex shrink-0 items-center gap-4 sm:gap-5 text-sm font-medium">
        <a :href="`${base || '/'}#eventos`" class="py-2 hover:opacity-70 transition-opacity">Eventos</a>
        <a v-if="site.contact_form_enabled" :href="`${base}/contacto`" class="py-2 hover:opacity-70 transition-opacity">Contacto</a>
      </nav>
    </div>
  </header>
</template>

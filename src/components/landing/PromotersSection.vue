<script setup>
import { Link2, Tag, BarChart3, ArrowRight } from 'lucide-vue-next'
import FadeInSection from '../Hero/FadeInSection.vue'
import { formatCLP } from '../Reservation/pricing.js'

// Ejemplo ilustrativo de la tabla "Ventas por canal" de las métricas del evento (dashboard/events/[id]/analytics).
// Datos ficticios: se rotulan como tales.
const rows = [
  { name: 'Link de campaña', source: 'Publicidad en Instagram', tickets: 37, revenue: 37 * 8000 },
  { name: 'Link de Pedro', source: 'Comediante del line-up', tickets: 23, revenue: 23 * 8000 },
  { name: 'Link de Ana', source: 'Promotora', tickets: 11, revenue: 11 * 8000 },
  { name: 'Directo', source: 'Sin link', tickets: 9, revenue: 9 * 8000 },
]
const max = Math.max(...rows.map((r) => r.tickets))
</script>

<template>
  <section class="relative py-24 font-[Prompt] bg-black text-white overflow-hidden">
    <div class="container mx-auto px-4 md:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      <div class="text-center lg:text-left">
        <FadeInSection>
          <span class="inline-flex items-center gap-2 text-black font-semibold text-sm bg-lime-400 px-4 py-1 rounded-full">
            <Link2 class="h-4 w-4" /> Links con seguimiento
          </span>
        </FadeInSection>
        <FadeInSection :delay="100">
          <h2 class="text-3xl md:text-4xl font-bold mt-4 mb-4 font-[Unbounded] leading-tight">
            ¿Quién está vendiendo <span class="text-lime-400">tus entradas?</span>
          </h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-white/80 text-lg max-w-xl mx-auto lg:mx-0">
            Crea un link para cada integrante del line-up, promotor o campaña. Cada compra queda asociada al link con que llegó el comprador,
            y en las métricas del evento ves órdenes, entradas e ingresos por canal. Sin capturas de pantalla ni reportes a mano.
          </p>
        </FadeInSection>
        <ul class="mt-8 space-y-4 text-left max-w-xl mx-auto lg:mx-0">
          <FadeInSection :delay="250">
            <li class="flex gap-3">
              <BarChart3 class="h-5 w-5 text-lime-400 shrink-0 mt-0.5" />
              <span class="text-white/80 text-sm">Compara canales y decide dónde poner tu próxima publicación o tu presupuesto de publicidad.</span>
            </li>
          </FadeInSection>
          <FadeInSection :delay="300">
            <li class="flex gap-3">
              <Tag class="h-5 w-5 text-lime-400 shrink-0 mt-0.5" />
              <span class="text-white/80 text-sm">Súmale códigos de descuento por porcentaje o monto, con fecha límite y cupos, para preventas, colaboraciones o la última semana.</span>
            </li>
          </FadeInSection>
        </ul>
        <FadeInSection :delay="350">
          <a href="/ventas-por-promotor" data-cta="learn_promoters" data-section="promoters" class="inline-flex items-center gap-2 mt-8 text-lime-400 font-semibold hover:underline">
            Cómo medir las ventas de cada promotor <ArrowRight class="h-4 w-4" />
          </a>
        </FadeInSection>
      </div>

      <FadeInSection direction="right" :delay="200">
        <figure class="rounded-2xl bg-white/[0.04] border border-white/10 p-5 sm:p-6 max-w-xl mx-auto w-full">
          <figcaption class="flex items-center justify-between text-xs text-white/50 mb-4">
            <span>Ventas por canal · Stand-up del jueves</span>
            <span class="px-2 py-0.5 rounded-full border border-white/15">Datos de ejemplo</span>
          </figcaption>
          <ul class="space-y-4">
            <li v-for="r in rows" :key="r.name">
              <div class="flex items-baseline justify-between gap-3 text-sm">
                <span class="font-semibold">{{ r.name }} <span class="text-white/40 font-normal">· {{ r.source }}</span></span>
                <span class="text-white/80 whitespace-nowrap">{{ r.tickets }} entradas</span>
              </div>
              <div class="mt-1.5 h-2 rounded-full bg-white/10 overflow-hidden">
                <div class="h-full rounded-full bg-lime-400" :style="{ width: `${(r.tickets / max) * 100}%` }"></div>
              </div>
              <p class="text-xs text-white/40 mt-1">{{ formatCLP(r.revenue) }} en ventas</p>
            </li>
          </ul>
        </figure>
      </FadeInSection>
    </div>
  </section>
</template>

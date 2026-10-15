<script setup>
import { CalendarDays, Copy, UserCog, Gift, BellRing, MessageCircleQuestion } from 'lucide-vue-next'
import FadeInSection from '../Hero/FadeInSection.vue'

// Verificado: MAX_FUNCTIONS = 60 (producer-api/tools/schedule.ts), duplicate_event (lifecycle.ts + botón en el panel),
// roles de permissions.ts, cortesías (CourtesyTicketsForm), aviso por cambios (update_event_functions) y recordatorio automático.
const items = [
  {
    icon: CalendarDays,
    title: 'Varias fechas, un solo evento',
    text: 'Hasta 60 funciones por evento, con entradas para una función específica o válidas para todas. Si cambias un horario, avisamos por email a quienes ya compraron.',
  },
  {
    icon: Copy,
    title: 'Duplica la próxima semana',
    text: 'Duplica el evento y conserva descripción, imagen, lugar, tipos de entrada y preguntas frecuentes. Solo agregas las fechas nuevas.',
  },
  {
    icon: UserCog,
    title: 'Cada persona con su rol',
    text: 'Invita a tu equipo como Puerta, Marketing, Finanzas o Solo lectura, y limita qué eventos ve cada uno.',
  },
  {
    icon: Gift,
    title: 'Cortesías bajo control',
    text: 'Envía cortesías por email desde el panel. No cuentan como venta y entran por la puerta como cualquier entrada.',
  },
  {
    icon: BellRing,
    title: 'Asistentes avisados',
    text: 'Cada comprador recibe su entrada con QR al instante y un recordatorio por email antes de la función.',
  },
  {
    icon: MessageCircleQuestion,
    title: 'Menos mensajes por Instagram',
    text: 'La página de tu evento tiene un asistente que responde horarios, lugar, edad mínima y más con la información que cargaste.',
  },
]
</script>

<template>
  <section class="py-24 font-[Prompt] bg-gradient-to-b from-slate-200 to-lime-200">
    <div class="container mx-auto px-4 md:px-8">
      <div class="text-center mb-14 max-w-3xl mx-auto">
        <FadeInSection>
          <span class="inline-block text-lime-400 font-medium text-sm bg-black px-4 py-1 rounded-full">Funciones recurrentes</span>
        </FadeInSection>
        <FadeInSection :delay="100">
          <h2 class="text-3xl md:text-4xl font-bold mt-3 mb-4 font-[Unbounded]">Muchas funciones. Una sola configuración.</h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-gray-600">
            Si produces todos los jueves, tienes una obra en cartelera o programas talleres cada mes, no tienes que empezar de cero con cada show.
          </p>
        </FadeInSection>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <FadeInSection v-for="(item, i) in items" :key="item.title" :delay="i * 80">
          <div class="p-6 rounded-xl bg-white border border-gray-100 shadow-sm h-full">
            <div class="bg-black rounded-full w-11 h-11 flex items-center justify-center mb-4">
              <component :is="item.icon" class="h-5 w-5 text-lime-400" />
            </div>
            <h3 class="text-lg font-semibold mb-2 font-[Unbounded]">{{ item.title }}</h3>
            <p class="text-gray-600 text-sm">{{ item.text }}</p>
          </div>
        </FadeInSection>
      </div>
    </div>
  </section>
</template>

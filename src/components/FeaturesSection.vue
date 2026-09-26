<script setup>
import {
  CalendarDays,
  MessageSquare,
  Bot,
  TrendingUp,
  QrCode,
  BarChart3,
  Ticket,
  Bell,
  HelpCircle
} from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';

const producerFeatures = [
  {
    icon: CalendarDays,
    title: 'Funciones múltiples',
    description: 'Un evento con todas sus fechas y horarios. Para shows recurrentes, usa "Duplicar evento" y listo.'
  },
  {
    icon: MessageSquare,
    title: 'Comunicación automática',
    description: 'Recordatorio por email 24 h antes de la función y aviso automático a tus asistentes si cambia algo del evento.'
  },
  {
    icon: Bot,
    title: 'Asistente IA en tu página',
    description: 'Responde las dudas de los compradores con la información y preguntas frecuentes de tu evento.'
  },
  {
    icon: TrendingUp,
    title: 'Posts con IA',
    description: 'Genera publicaciones para Instagram y Facebook a partir de tu evento y publícalas desde el panel.'
  },
  {
    icon: QrCode,
    title: 'Check-in con QR',
    description: 'Tu equipo escanea las entradas desde el celular. Si se cae la señal, sigue validando con la lista descargada y sincroniza después.'
  },
  {
    icon: BarChart3,
    title: 'Métricas claras',
    description: 'Visitas, ventas, canal de origen (UTM), ciudad y hora peak de cada evento. Exporta tus órdenes a CSV.'
  }
];

const attendeeFeatures = [
  {
    icon: Ticket,
    title: 'Compra simple',
    description: 'Paga con Webpay (vía Flow) y recibe tu entrada con código QR por email al instante.'
  },
  {
    icon: Bell,
    title: 'Siempre informado',
    description: 'Recordatorio 24 h antes de la función y aviso por email si cambia algo del evento.'
  },
  {
    icon: HelpCircle,
    title: 'Respuestas al instante',
    description: 'Pregúntale al asistente con IA de la página del evento: horarios, lugar, edad mínima y más.'
  }
];

const tags = [
  'Stand-up',
  'Comedia',
  'Teatro independiente',
  'Música en vivo',
  'Talleres',
  'Temporadas con varias funciones'
];

// Próximamente (no prometer como disponible): WhatsApp, cupones de descuento,
// MercadoPago, dominio propio, campañas de Meta Ads gestionadas, mapa de asientos, POS.
const comingSoon = ['WhatsApp', 'Cupones de descuento', 'MercadoPago', 'Dominio propio'];
</script>

<template>
  <section class="py-24 font-[Prompt] bg-gradient-to-b from-slate-200 to-lime-200">
    <div class="container mx-auto px-4 md:px-8">
      <div class="text-center mb-16">
        <FadeInSection>
          <span class="inline-block text-lime-400 font-[Prompt] font-medium text-sm bg-black px-4 py-1 rounded-full">
            Todo lo que necesitas
          </span>
        </FadeInSection>

        <FadeInSection :delay="100">
          <h2 class="text-3xl md:text-4xl font-bold mt-2 mb-4 font-[Unbounded]">Deja de hacer malabares</h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-gray-500 max-w-2xl mx-auto">
            Venta de entradas, comunicación con asistentes, posts con IA y check-in.
            Todo desde un solo lugar, sin necesidad de ser experto en tecnología.
          </p>
        </FadeInSection>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-16">
        <!-- Organizers -->
        <div>
          <FadeInSection direction="right">
            <h3 class="text-2xl font-bold mb-8 flex items-center font-[Unbounded]">
              <span class="bg-black text-white p-1 mr-2">Para</span>
              <span>Organizadores</span>
            </h3>
          </FadeInSection>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <FadeInSection
              v-for="(feature, index) in producerFeatures"
              :key="'producer-' + index"
              :delay="index * 100"
              direction="up"
            >
              <div class="p-6 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow group h-full">
                <div class="bg-lime-400/10 rounded-full w-12 h-12 flex items-center justify-center mb-4 group-hover:bg-lime-400/20 transition-colors">
                  <component :is="feature.icon" class="h-6 w-6 text-lime-400" />
                </div>
                <h4 class="text-lg font-semibold mb-2 font-[Unbounded]">{{ feature.title }}</h4>
                <p class="text-gray-500 text-sm">{{ feature.description }}</p>
              </div>
            </FadeInSection>
          </div>
        </div>

        <!-- Attendees -->
        <div>
          <FadeInSection direction="left">
            <h3 class="text-2xl font-bold mb-8 flex items-center font-[Unbounded]">
              <span class="bg-black text-white p-1 mr-2">Para</span>
              <span>Asistentes</span>
            </h3>
          </FadeInSection>

          <div class="grid grid-cols-1 gap-8">
            <FadeInSection
              v-for="(feature, index) in attendeeFeatures"
              :key="'attendee-' + index"
              :delay="index * 100"
              direction="up"
            >
              <div class="p-6 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-shadow group">
                <div class="bg-lime-400/10 rounded-full w-12 h-12 flex items-center justify-center mb-4 group-hover:bg-lime-400/20 transition-colors">
                  <component :is="feature.icon" class="h-6 w-6 text-lime-400" />
                </div>
                <h4 class="text-lg font-semibold mb-2 font-[Unbounded]">{{ feature.title }}</h4>
                <p class="text-gray-500 text-sm">{{ feature.description }}</p>
              </div>
            </FadeInSection>
          </div>

          <FadeInSection :delay="400" direction="up">
            <div class="mt-8 p-6 rounded-xl bg-gradient-to-br from-lime-400/10 to-lime-400/5 border border-lime-400/20">
              <h4 class="text-lg font-semibold mb-2 font-[Unbounded]">Ideal para funciones recurrentes</h4>
              <p class="text-gray-600 mb-4">
                Pensado para productores chicos y medianos que hacen funciones todas las semanas.
              </p>
              <div class="flex flex-wrap gap-2">
                <span v-for="tag in tags" :key="tag" class="text-xs bg-white px-3 py-1 rounded-full">{{ tag }}</span>
              </div>
              <p class="text-gray-500 text-xs mt-4">
                Próximamente: {{ comingSoon.join(' · ') }}.
              </p>
            </div>
          </FadeInSection>
        </div>
      </div>
    </div>
  </section>
</template>


<script setup>
import {
  CalendarDays,
  MessageSquare,
  Globe,
  TrendingUp,
  QrCode,
  BarChart3,
  Ticket,
  Bell,
  Gift
} from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';

const producerFeatures = [
  {
    icon: CalendarDays,
    title: 'Funciones múltiples',
    description: 'Gestiona temporadas completas con múltiples horarios, sedes y aforos desde un solo lugar.'
  },
  {
    icon: MessageSquare,
    title: 'Comunicación automática',
    description: 'Notifica cambios, envía recordatorios y responde preguntas frecuentes por WhatsApp y email.'
  },
  {
    icon: Globe,
    title: 'Tu dominio propio',
    description: 'Vende bajo tucirco.cl o entradas.tuteatro.com. Más confianza, mejor conversión.'
  },
  {
    icon: TrendingUp,
    title: 'Marketing que funciona',
    description: 'Promoción en Meta y Google Ads optimizada para llenar las funciones con menos demanda.'
  },
  {
    icon: QrCode,
    title: 'Check-in profesional',
    description: 'QR que funciona sin internet, escaneo en 2 segundos y control de aforo en tiempo real.'
  },
  {
    icon: BarChart3,
    title: 'Métricas claras',
    description: 'Ventas por función, conversión por canal, horas pico y todo lo que necesitas para decidir.'
  }
];

const attendeeFeatures = [
  {
    icon: Ticket,
    title: 'Compra simple',
    description: 'WebPay, MercadoPago o transferencia. Recibe tu entrada al instante por email y WhatsApp.'
  },
  {
    icon: Bell,
    title: 'Siempre informado',
    description: 'Recordatorios antes de la función y avisos inmediatos si hay cambios o reprogramaciones.'
  },
  {
    icon: Gift,
    title: 'Extras y upgrades',
    description: 'Accede a VIP, packs familiares, fotos con el elenco y más beneficios exclusivos.'
  }
];

const tags = [
  'Circos',
  'Teatros',
  'Ferias culturales',
  'Museos',
  'Festivales',
  'Experiencias inmersivas'
];
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
            Venta de entradas, comunicación con asistentes, marketing y check-in. 
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
              <h4 class="text-lg font-semibold mb-2 font-[Unbounded]">Ideal para eventos con funciones múltiples</h4>
              <p class="text-gray-600 mb-4">
                Diseñado especialmente para productores que manejan temporadas, múltiples horarios y sedes diferentes.
              </p>
              <div class="flex flex-wrap gap-2">
                <span v-for="tag in tags" :key="tag" class="text-xs bg-white px-3 py-1 rounded-full">{{ tag }}</span>
              </div>
            </div>
          </FadeInSection>
        </div>
      </div>
    </div>
  </section>
</template>


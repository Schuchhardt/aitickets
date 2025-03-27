<script setup>
import {
  Lightbulb,
  BarChart3,
  Ticket,
  Users,
  CreditCard,
  Calendar,
  QrCode,
  Gift
} from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';

const producerFeatures = [
  {
    icon: Calendar,
    title: 'Gestión de eventos',
    description: 'Crea y gestiona eventos fácilmente desde tu panel de control con todos los detalles necesarios.'
  },
  {
    icon: QrCode,
    title: 'Venta de entradas',
    description: 'Venta directa a través de WebPay y MercadoPago con validación de entradas mediante QR.'
  },
  {
    icon: Users,
    title: 'Equipo colaborativo',
    description: 'Asigna permisos y roles para que tu equipo pueda gestionar el evento de forma compartida.'
  },
  {
    icon: Lightbulb,
    title: 'Marketing con IA',
    description: 'Promoción automática en Meta, Google y TikTok optimizada con inteligencia artificial.'
  },
  {
    icon: CreditCard,
    title: 'Modelo de créditos',
    description: 'Compra anticipada de créditos por evento que solo se descuentan si se vende una entrada.'
  },
  {
    icon: BarChart3,
    title: 'Analítica avanzada',
    description: 'Métricas de ventas, tasa de conversión, fuente de tráfico y más en tiempo real.'
  }
];

const attendeeFeatures = [
  {
    icon: Ticket,
    title: 'Compra fácil',
    description: 'Procesos de compra fluidos a través de Web, WhatsApp o Facebook.'
  },
  {
    icon: Lightbulb,
    title: 'Recomendaciones',
    description: 'Sugerencias personalizadas según tus gustos y asistencias anteriores.'
  },
  {
    icon: Gift,
    title: 'Sistema de puntos',
    description: 'Gana puntos por asistir, invitar amigos y participar en eventos.'
  }
];

const tags = [
  'Festivales',
  'Fiestas electrónicas',
  'Charlas tech',
  'Ferias',
  'Experiencias inmersivas'
];
</script>

<template>
  <section class="py-24 font-[Prompt] bg-gradient-to-b from-slate-200 to-lime-200">
    <div class="container mx-auto px-4 md:px-8">
      <div class="text-center mb-16">
        <FadeInSection>
          <span class="inline-block text-lime-400 font-[Prompt] font-medium text-sm bg-black px-4 py-1 rounded-full">
            Características
          </span>
        </FadeInSection>

        <FadeInSection :delay="100">
          <h2 class="text-3xl md:text-4xl font-bold mt-2 mb-4 font-[Unbounded]">Una plataforma para todos</h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-gray-500 max-w-2xl mx-auto">
            AI Tickets ofrece herramientas específicas tanto para productores de eventos como para asistentes, 
            creando un ecosistema completo para la gestión y disfrute de eventos.
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
              <h4 class="text-lg font-semibold mb-2 font-[Unbounded]">Enfoque en Comunidad</h4>
              <p class="text-gray-600 mb-4">
                Preguntamos a los asistentes qué eventos quieren ver y conectamos a los organizadores con su comunidad ideal.
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


<template>
  <section class="py-24 font-[Prompt] bg-gradient-to-b from-slate-200 to-lime-200">
    <div class="container mx-auto px-4 md:px-8">
      <div class="text-center mb-16">
        <FadeInSection>
          <span class="text-lime-400 font-medium text-sm">CARACTERÍSTICAS</span>
        </FadeInSection>
        <FadeInSection :delay="100">
          <h2 class="text-3xl md:text-4xl font-bold mt-2 mb-4 font-[Unbounded]">Todo lo que necesitas para vender más</h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-gray-500 max-w-2xl mx-auto">
            AI Tickets fue diseñado para facilitar la gestión, promoción y análisis de tus eventos en un solo lugar. 
            Simplifica el trabajo, automatiza procesos y enfócate en hacer crecer tu comunidad.
          </p>
        </FadeInSection>
      </div>

      <div>
        <FadeInSection direction="right">
          <h3 class="text-2xl font-bold mb-8 flex items-center font-[Unbounded]">
            <span class="bg-black text-white p-1 mr-2">Pensado para</span>
            <span>Productores</span>
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
    </div>
  </section>
</template>

<script setup>
import {
  Lightbulb,
  BarChart3,
  ShoppingCart,
  Users,
  CreditCard,
  Calendar
} from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';

const producerFeatures = [
  {
    icon: Calendar,
    title: 'Gestión de eventos',
    description: 'Crea y gestiona eventos fácilmente desde tu panel de control con todos los detalles necesarios.'
  },
  {
    icon: ShoppingCart,
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
</script>

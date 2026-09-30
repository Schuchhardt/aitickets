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
          <h2 class="text-3xl md:text-4xl font-bold mt-2 mb-4 font-[Unbounded]">Todo lo que necesitas para vender más</h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-gray-500 max-w-2xl mx-auto">
            Pensado para stand-up, teatro independiente y productoras chicas y medianas con funciones recurrentes.
            Vende, promociona y controla el acceso desde un solo lugar, sin ser experto en tecnología.
          </p>
        </FadeInSection>
      </div>

      <div>
        <FadeInSection direction="right">
          <h3 class="text-xl sm:text-2xl font-bold mb-8 flex flex-wrap items-center gap-y-2 font-[Unbounded]">
            <span class="bg-black text-white p-1 mr-2 whitespace-nowrap">Pensado para</span>
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
  Calendar,
  Globe
} from 'lucide-vue-next';
import FadeInSection from './Hero/FadeInSection.vue';

const producerFeatures = [
  {
    icon: Calendar,
    title: 'Eventos con varias funciones',
    description: 'Una página con todas tus fechas y horarios, y cupos por función si los necesitas. Usa "Duplicar evento" para tus shows recurrentes.'
  },
  {
    icon: ShoppingCart,
    title: 'Venta online y entradas QR',
    description: 'Vende con Webpay y tarjetas. Tus asistentes reciben su entrada con código QR por email al instante.'
  },
  {
    icon: Users,
    title: 'Equipo y check-in',
    description: 'Suma a tu equipo con roles (admin, editor, validador) y valida entradas escaneando el QR desde el celular.'
  },
  {
    icon: Lightbulb,
    title: 'Posts y asistente con IA',
    description: 'Genera posts para Instagram y Facebook con IA, y un asistente en tu página responde las dudas de los compradores.'
  },
  {
    icon: CreditCard,
    title: '0% de comisión para ti',
    description: 'El comprador paga un cargo por servicio de 10% + IVA. Te transferimos lo recaudado 48–72 h después de cada función.'
  },
  {
    icon: BarChart3,
    title: 'Analítica por evento',
    description: 'Visitas, ventas, canal de origen (UTM), ciudad y hora peak de tu público. Exporta tus órdenes a CSV.'
  },
  {
    icon: Globe,
    title: 'Web de eventos gratis con tu dominio',
    description: 'Tu productora tiene su propia web con todos tus eventos, sin costo. Úsala en aitickets.cl o conecta tu dominio.'
  }
];
</script>

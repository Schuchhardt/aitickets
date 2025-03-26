<template>
    <section class="py-20 bg-gradient-to-t from-slate-200 to-lime-200 font-[Prompt]">
      <div class="container mx-auto px-4 md:px-8">
        <div class="text-center mb-16">
          <FadeInSection>
          <span class="inline-block text-lime-400 font-[Prompt] font-medium text-sm bg-black px-4 py-1 rounded-full">
            Beneficios
          </span>
        </FadeInSection>
          <FadeInSection :delay="100">
            <h2 class="text-3xl md:text-4xl font-bold mt-2 mb-4 font-[Unbounded]">
              ¿Por qué elegir AI Tickets?
            </h2>
          </FadeInSection>
          <FadeInSection :delay="200">
            <p class="text-gray-500 max-w-2xl mx-auto">
              Nuestra plataforma ofrece una serie de ventajas únicas tanto para organizadores como para asistentes.
            </p>
          </FadeInSection>
        </div>
  
        <div class="grid grid-cols-1 md:grid-cols-2 gap-12 xl:gap-24">
          <!-- Venta y promoción inteligente -->
          <FadeInSection direction="right">
            <div class="relative bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <div class="absolute -top-5 left-8 bg-lime-400 text-white w-10 h-10 rounded-full flex items-center justify-center">
                <Zap class="h-5 w-5" />
              </div>
              <h3 class="text-xl font-bold mb-4 mt-4 font-[Unbounded]">
                Venta y promoción inteligente
              </h3>
              <p class="text-gray-600 mb-6">
                Nuestra IA analiza datos en tiempo real para optimizar tus campañas de marketing, 
                aprendiendo del comportamiento de los usuarios para maximizar las ventas.
              </p>
              <ul class="space-y-3">
                <li v-for="(item, i) in smartBenefits" :key="i" class="flex items-start">
                  <span class="bg-lime-400/10 text-lime-400 rounded-full p-1 mr-3 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                  <span class="text-sm text-gray-600">{{ item }}</span>
                </li>
              </ul>
            </div>
          </FadeInSection>
  
          <!-- Enfoque en comunidad -->
          <FadeInSection direction="left" :delay="150">
            <div class="relative bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <div class="absolute -top-5 left-8 bg-lime-400 text-white w-10 h-10 rounded-full flex items-center justify-center">
                <Users class="h-5 w-5" />
              </div>
              <h3 class="text-xl font-bold mb-4 mt-4 font-[Unbounded]">
                Enfoque en comunidad
              </h3>
              <p class="text-gray-600 mb-6">
                Conectamos a productores con su comunidad ideal, preguntando directamente a los 
                asistentes qué eventos quieren ver y facilitando su creación.
              </p>
              <ul class="space-y-3">
                <li v-for="(item, i) in communityBenefits" :key="i" class="flex items-start">
                  <span class="bg-lime-400/10 text-lime-400 rounded-full p-1 mr-3 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                  <span class="text-sm text-gray-600">{{ item }}</span>
                </li>
              </ul>
            </div>
          </FadeInSection>
        </div>
      </div>
    </section>
  </template>
  
  <script setup>
  import { Zap, Users } from 'lucide-vue-next';
  import FadeInSection from './Hero/FadeInSection.vue';
  
  const smartBenefits = [
    'Promoción automatizada en Meta, Google y TikTok',
    'Optimización continua de campañas publicitarias',
    'Análisis de datos para mejores resultados',
    'Segmentación precisa de audiencias'
  ];
  
  const communityBenefits = [
    'Feedback directo de los asistentes',
    'Creación de eventos basados en demanda real',
    'Conexión entre organizadores y público',
    'Mayor tasa de asistencia y satisfacción'
  ];
  </script>
  
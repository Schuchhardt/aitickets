<template>
    <section class="py-20 bg-gradient-to-t from-slate-200 to-lime-200 font-[Prompt]">
      <div class="container mx-auto px-4 md:px-8">
        <div class="text-center mb-16">
          <FadeInSection>
          <span class="inline-block text-lime-400 font-[Prompt] font-medium text-sm bg-black px-4 py-1 rounded-full">
            Resultados reales
          </span>
        </FadeInSection>
          <FadeInSection :delay="100">
            <h2 class="text-3xl md:text-4xl font-bold mt-2 mb-4 font-[Unbounded]">
              El costo de seguir igual es alto
            </h2>
          </FadeInSection>
          <FadeInSection :delay="200">
            <p class="text-gray-500 max-w-2xl mx-auto">
              Cada función con asientos vacíos es dinero que ya no vuelve. 
              Cada hora en tareas manuales es tiempo que podrías dedicar a crear mejor contenido.
            </p>
          </FadeInSection>
        </div>
  
        <div class="grid grid-cols-1 md:grid-cols-2 gap-12 xl:gap-24">
          <!-- El problema -->
          <FadeInSection direction="right">
            <div class="relative bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <div class="absolute -top-5 left-8 bg-pink-500 text-white w-10 h-10 rounded-full flex items-center justify-center">
                <AlertTriangle class="h-5 w-5" />
              </div>
              <h3 class="text-xl font-bold mb-4 mt-4 font-[Unbounded]">
                ¿Te suena familiar?
              </h3>
              <p class="text-gray-600 mb-6">
                Estos problemas le cuestan miles de pesos a productores cada temporada. 
                Y lo peor... tienen solución.
              </p>
              <ul class="space-y-3">
                <li v-for="(item, i) in problems" :key="i" class="flex items-start">
                  <span class="bg-pink-500/10 text-pink-500 rounded-full p-1 mr-3 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </span>
                  <span class="text-sm text-gray-600">{{ item }}</span>
                </li>
              </ul>
            </div>
          </FadeInSection>
  
          <!-- La solución -->
          <FadeInSection direction="left" :delay="150">
            <div class="relative bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
              <div class="absolute -top-5 left-8 bg-lime-400 text-white w-10 h-10 rounded-full flex items-center justify-center">
                <Zap class="h-5 w-5" />
              </div>
              <h3 class="text-xl font-bold mb-4 mt-4 font-[Unbounded]">
                Con AI Tickets logras
              </h3>
              <p class="text-gray-600 mb-6">
                Imagina tener un equipo que vende, comunica y gestiona mientras tú 
                te enfocas en lo que realmente importa: crear experiencias increíbles.
              </p>
              <ul class="space-y-3">
                <li v-for="(item, i) in solutions" :key="i" class="flex items-start">
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

        <!-- Métricas -->
        <FadeInSection :delay="300">
          <div class="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div class="p-6">
              <div class="text-4xl font-bold text-lime-500 font-[Unbounded]">+25%</div>
              <div class="text-gray-600 text-sm mt-2">más asistentes en funciones flojas</div>
            </div>
            <div class="p-6">
              <div class="text-4xl font-bold text-lime-500 font-[Unbounded]">15 hrs</div>
              <div class="text-gray-600 text-sm mt-2">ahorradas por semana</div>
            </div>
            <div class="p-6">
              <div class="text-4xl font-bold text-lime-500 font-[Unbounded]">98%</div>
              <div class="text-gray-600 text-sm mt-2">asistentes notificados a tiempo</div>
            </div>
            <div class="p-6">
              <div class="text-4xl font-bold text-lime-500 font-[Unbounded]">2 seg</div>
              <div class="text-gray-600 text-sm mt-2">tiempo de check-in promedio</div>
            </div>
          </div>
        </FadeInSection>
      </div>
    </section>
  </template>
  
  <script setup>
  import { Zap, AlertTriangle } from 'lucide-vue-next';
  import FadeInSection from './Hero/FadeInSection.vue';
  
  const problems = [
    '30-40% de asientos vacíos en funciones "flojas"',
    '+15 horas semanales en tareas manuales',
    'Clientes frustrados por mala comunicación',
    'Dinero en publicidad sin saber qué funciona',
    'Estrés operativo que mata la creatividad'
  ];
  
  const solutions = [
    'Vende entradas mientras duermes',
    'Avisa a todos si algo cambia (en segundos)',
    'Llena las funciones difíciles automáticamente',
    'Sabe exactamente qué está funcionando',
    'Todo esto sin contratar a nadie'
  ];
  </script>
  
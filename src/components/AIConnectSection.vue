<template>
  <section id="ia" class="relative py-24 font-[Prompt] bg-black text-white overflow-hidden scroll-mt-16">
    <div class="absolute inset-0 pointer-events-none" aria-hidden="true">
      <div class="absolute -top-32 -right-32 w-[28rem] h-[28rem] rounded-full bg-lime-400/20 blur-3xl"></div>
      <div class="absolute -bottom-40 -left-24 w-[24rem] h-[24rem] rounded-full bg-lime-400/10 blur-3xl"></div>
    </div>

    <div class="relative container mx-auto px-4 md:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <!-- Texto -->
        <div class="text-center lg:text-left">
          <FadeInSection>
            <span class="inline-flex items-center gap-2 text-black font-semibold text-sm bg-lime-400 px-4 py-1 rounded-full">
              <Bot class="h-4 w-4" /> Nuevo · Exclusivo de AI Tickets
            </span>
          </FadeInSection>
          <FadeInSection :delay="100">
            <h2 class="text-3xl md:text-4xl font-bold mt-4 mb-4 font-[Unbounded] leading-tight">
              Tu ticketera,
              <span class="text-lime-400">dentro de tu IA</span>
            </h2>
          </FadeInSection>
          <FadeInSection :delay="200">
            <p class="text-white/80 text-lg max-w-xl mx-auto lg:mx-0">
              Conecta AI Tickets a Claude, ChatGPT o Cursor y gestiona tus eventos conversando: crea funciones y entradas,
              lanza códigos de descuento, pregunta cómo van las ventas y arma tu campaña en redes. Sin abrir el panel.
            </p>
          </FadeInSection>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8 text-left">
            <FadeInSection v-for="(item, i) in items" :key="item.title" :delay="250 + i * 75">
              <div class="flex gap-3 p-4 rounded-xl bg-white/5 border border-white/10 h-full">
                <component :is="item.icon" class="h-5 w-5 text-lime-400 shrink-0 mt-0.5" />
                <div>
                  <p class="font-semibold text-sm">{{ item.title }}</p>
                  <p class="text-white/60 text-xs mt-1">{{ item.text }}</p>
                </div>
              </div>
            </FadeInSection>
          </div>

          <FadeInSection :delay="600">
            <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4 mt-8">
              <a href="/organizadores/registro?utm_source=aitickets&utm_medium=landing&utm_campaign=ia"
                class="px-6 py-3 font-bold font-[Unbounded] bg-lime-400 text-black rounded-lg hover:bg-lime-300 transition w-full sm:w-auto group">
                Conecta tu IA gratis
                <ArrowRight class="ml-2 inline-block h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
              <span class="text-white/50 text-sm">En 1 minuto. Sin código.</span>
            </div>
            <div class="flex flex-wrap items-center justify-center lg:justify-start gap-2 mt-6 text-xs text-white/60">
              <span>Funciona con</span>
              <span v-for="c in clients" :key="c" class="px-2.5 py-1 rounded-full border border-white/15 bg-white/5 text-white/80">{{ c }}</span>
            </div>
          </FadeInSection>
        </div>

        <!-- Conversación de ejemplo -->
        <FadeInSection direction="right" :delay="200">
          <div class="rounded-2xl bg-white/[0.04] border border-white/10 shadow-2xl backdrop-blur p-4 sm:p-6 max-w-xl mx-auto w-full">
            <div class="flex items-center gap-2 pb-4 border-b border-white/10 mb-4">
              <span class="w-2.5 h-2.5 rounded-full bg-white/20"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-white/20"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-white/20"></span>
              <span class="ml-2 text-xs text-white/50">Tu asistente · conectado a AI Tickets</span>
            </div>
            <div class="space-y-4 text-sm">
              <div class="flex justify-end">
                <p class="bg-lime-400 text-black rounded-2xl rounded-br-sm px-4 py-2 max-w-[85%]">¿Cómo va la venta de “Stand-up de Viernes”?</p>
              </div>
              <div class="flex gap-2">
                <span class="shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center"><Sparkles class="h-4 w-4 text-lime-400" /></span>
                <div class="bg-white/10 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] space-y-2">
                  <p>Vas en <strong>142 de 200</strong> entradas (71%) y <strong>$1.704.000</strong> vendidos. Esta semana vendiste un 38% más que la anterior.</p>
                  <p class="text-white/70">Instagram convierte el doble que TikTok. Faltan 9 días: te propongo un código de última semana.</p>
                  <p class="text-[11px] text-white/40 font-mono">get_event_performance ✓</p>
                </div>
              </div>
              <div class="flex justify-end">
                <p class="bg-lime-400 text-black rounded-2xl rounded-br-sm px-4 py-2 max-w-[85%]">Dale. 15% hasta el jueves, y arma un post para Instagram.</p>
              </div>
              <div class="flex gap-2">
                <span class="shrink-0 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center"><Sparkles class="h-4 w-4 text-lime-400" /></span>
                <div class="bg-white/10 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] space-y-2">
                  <p>Listo: creé <strong class="font-mono">ULTIMASEMANA15</strong> (15%, vence el jueves 23:59) y dejé el post en borrador con imagen y link de seguimiento. ¿Lo publico?</p>
                  <p class="text-[11px] text-white/40 font-mono">create_discount_code ✓ · generate_image ✓ · create_social_post ✓</p>
                </div>
              </div>
            </div>
          </div>
        </FadeInSection>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ArrowRight, Bot, Sparkles, CalendarPlus, Tag, LineChart, Megaphone } from 'lucide-vue-next'
import FadeInSection from './Hero/FadeInSection.vue'

const items = [
  { icon: CalendarPlus, title: 'Crea eventos y entradas', text: 'Funciones, precios, preventas y cupos con una frase.' },
  { icon: Tag, title: 'Descuentos al instante', text: 'Códigos para promotores, influencers o última semana.' },
  { icon: LineChart, title: 'Pregunta cómo va', text: 'Ventas, ritmo, conversión y qué canal vende más.' },
  { icon: Megaphone, title: 'Marketing con IA', text: 'Posts, imágenes y links con seguimiento, listos para publicar.' },
]

const clients = ['Claude', 'ChatGPT', 'Cursor', 'VS Code', 'n8n / Zapier']
</script>

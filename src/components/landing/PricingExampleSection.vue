<script setup>
import { ArrowRight } from 'lucide-vue-next'
import FadeInSection from '../Hero/FadeInSection.vue'
import { computeFeeSplit, SERVICE_FEE_PERCENT_LABEL, IVA_PERCENT_LABEL } from '../../../netlify/lib/fees.mjs'
import { formatCLP } from '../Reservation/pricing.js'

// Calculado con la misma función que el checkout (fees.mjs): nunca escribir montos a mano.
const PRICE = 10000
const buyer = computeFeeSplit(PRICE)
const absorbed = computeFeeSplit(PRICE, { absorbed: true })
</script>

<template>
  <section class="py-24 font-[Prompt] bg-gradient-to-b from-lime-200 to-slate-200">
    <div class="container mx-auto px-4 md:px-8">
      <div class="text-center mb-12 max-w-3xl mx-auto">
        <FadeInSection>
          <span class="inline-block text-lime-400 font-medium text-sm bg-black px-4 py-1 rounded-full">Precio transparente</span>
        </FadeInSection>
        <FadeInSection :delay="100">
          <h2 class="text-3xl md:text-4xl font-bold mt-3 mb-4 font-[Unbounded]">Publica sin mensualidad. Se cobra solo cuando vendes.</h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-gray-600">
            Sin comisión para ti: el comprador paga un cargo por servicio de {{ SERVICE_FEE_PERCENT_LABEL }} del valor de la entrada, más IVA ({{ IVA_PERCENT_LABEL }}) sobre ese cargo.
            Si prefieres mostrar un precio final, puedes absorberlo. Las entradas gratis no pagan cargo.
          </p>
        </FadeInSection>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        <FadeInSection :delay="100">
          <div class="rounded-2xl bg-black text-white p-6 h-full">
            <p class="text-lime-400 text-sm font-semibold">El comprador paga el cargo (por defecto)</p>
            <dl class="mt-4 space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-white/70">Entrada</dt><dd>{{ formatCLP(PRICE) }}</dd></div>
              <div class="flex justify-between"><dt class="text-white/70">Cargo por servicio ({{ SERVICE_FEE_PERCENT_LABEL }})</dt><dd>{{ formatCLP(buyer.feeNet) }}</dd></div>
              <div class="flex justify-between"><dt class="text-white/70">IVA del cargo ({{ IVA_PERCENT_LABEL }})</dt><dd>{{ formatCLP(buyer.feeIva) }}</dd></div>
              <div class="flex justify-between border-t border-white/15 pt-2 font-semibold"><dt>Paga el comprador</dt><dd>{{ formatCLP(buyer.total) }}</dd></div>
            </dl>
            <p class="mt-4 text-2xl font-bold font-[Unbounded] text-lime-400">Recibes {{ formatCLP(buyer.producerNet) }}</p>
          </div>
        </FadeInSection>
        <FadeInSection :delay="200">
          <div class="rounded-2xl bg-white border border-gray-200 p-6 h-full">
            <p class="text-gray-900 text-sm font-semibold">Tú absorbes el cargo</p>
            <dl class="mt-4 space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-gray-500">Precio final para el comprador</dt><dd>{{ formatCLP(absorbed.total) }}</dd></div>
              <div class="flex justify-between"><dt class="text-gray-500">Cargo + IVA incluidos</dt><dd>−{{ formatCLP(absorbed.fee) }}</dd></div>
            </dl>
            <p class="mt-4 text-2xl font-bold font-[Unbounded]">Recibes {{ formatCLP(absorbed.producerNet) }}</p>
            <p class="mt-2 text-xs text-gray-500">Se configura por evento.</p>
          </div>
        </FadeInSection>
      </div>
      <p class="text-center mt-8">
        <a href="/precios" data-cta="pricing" data-section="pricing" class="inline-flex items-center gap-2 font-semibold underline">
          Calcula cuánto recibes con tus precios <ArrowRight class="h-4 w-4" />
        </a>
      </p>
    </div>
  </section>
</template>

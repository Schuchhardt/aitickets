<script setup>
import { QrCode, WifiOff, KeyRound, Gift } from 'lucide-vue-next'
import FadeInSection from '../Hero/FadeInSection.vue'

// Verificado: ValidateQR.vue (validación offline con la lista descargada), rol "Puerta" (permissions.ts),
// create_checkin_link (/puerta/<token>, sin cuenta, vence solo; hoy se crea desde el conector de IA),
// cortesías con tipo "Cortesía". No se anuncia transferencia de entradas por el asistente: no existe.
const items = [
  { icon: QrCode, title: 'Check-in desde el celular', text: 'Tu equipo escanea el QR de cada entrada desde el navegador del teléfono. Una entrada usada no vuelve a entrar.' },
  { icon: WifiOff, title: 'Sigue funcionando sin señal', text: 'Si se cae la conexión, valida con la lista descargada y sincroniza cuando vuelve.' },
  { icon: KeyRound, title: 'Puerta sin contraseñas', text: 'Dale a tu equipo el rol Puerta, o crea un link temporal desde tu asistente de IA: no necesita cuenta, solo ve nombre y tipo de entrada, y vence solo.' },
  { icon: Gift, title: 'Cortesías e invitados', text: 'Las cortesías llegan con su propio QR y se validan igual que una entrada pagada.' },
]
</script>

<template>
  <section class="py-24 font-[Prompt] bg-white">
    <div class="container mx-auto px-4 md:px-8">
      <div class="text-center mb-14 max-w-3xl mx-auto">
        <FadeInSection>
          <span class="inline-block text-lime-400 font-medium text-sm bg-black px-4 py-1 rounded-full">El día del evento</span>
        </FadeInSection>
        <FadeInSection :delay="100">
          <h2 class="text-3xl md:text-4xl font-bold mt-3 mb-4 font-[Unbounded]">La venta termina en la puerta.</h2>
        </FadeInSection>
        <FadeInSection :delay="200">
          <p class="text-gray-600">Menos fricción en el momento de más presión: que tu equipo reciba a la gente sin planillas ni listas de último minuto.</p>
        </FadeInSection>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <FadeInSection v-for="(item, i) in items" :key="item.title" :delay="i * 80">
          <div class="p-6 rounded-xl border border-gray-200 h-full">
            <component :is="item.icon" class="h-6 w-6 text-black mb-4" />
            <h3 class="font-semibold mb-2 font-[Unbounded] text-base">{{ item.title }}</h3>
            <p class="text-gray-600 text-sm">{{ item.text }}</p>
          </div>
        </FadeInSection>
      </div>
      <p class="text-center mt-8">
        <a href="/entradas-con-qr" data-cta="learn_checkin" data-section="door" class="font-semibold underline hover:text-lime-600">Cómo funciona el control de acceso con QR</a>
      </p>
    </div>
  </section>
</template>

<script setup>
// Credencial de PVC (SPEC_landing_seminarios §1): tarjeta blanca 260×372 (200×286 con `small`), radio 12, filete grafito,
// la ranura arriba recortada con una máscara, el cordón turquesa (dos bandas de 14 px que suben y salen por arriba de su
// contenedor) con su clip metálico, la banda del tipo con su trama (sólida turquesa, sólida grafito, rayas o contorno:
// nunca solo color), el nombre en Archivo Expanded, la organización, el día y un QR decorativo (SVG precalculado,
// aria-hidden) o la foto autorizada del testimonio. Sello "ejemplo" abajo a la izquierda.
// Es un recurso gráfico, no una función del producto: imprimir credenciales con nombre es "Pronto" (§0.7).
// Es .vue (y no .astro como dice la spec) para que la misma credencial sirva en las secciones Astro sin hidratar y
// dentro de la mesa de acreditación (AccreditationDesk), donde cambia con cada caso.
// swing: el contenedor lleva data-se-swing y seminariosLanding.client.js lo balancea (C4) al entrar en pantalla.
import { computed } from 'vue'
import { CREDENTIAL_TYPES, DECOR_QR_PATH } from './seminariosLanding.js'

const props = defineProps({
  name: { type: String, required: true },
  org: { type: String, required: true },
  /** asistente | expositora | estudiante | cortesia | organizadora */
  type: { type: String, default: 'asistente' },
  day: { type: String, required: true },
  /** LandingPhoto { src, width, height, sources } del testimonio (producerSocialProof.ts): reemplaza al QR */
  photo: { type: Object, required: false },
  swing: { type: Boolean, default: false },
  small: { type: Boolean, default: false },
  /** 200×286 bajo 1024 px y 260×372 desde ahí (por CSS: sin saltos al hidratar) */
  responsive: { type: Boolean, default: false },
  /** Largo del cordón sobre la tarjeta, en px */
  cord: { type: Number, default: 120 },
  example: { type: Boolean, default: true },
})
const kind = computed(() => CREDENTIAL_TYPES[props.type] ?? CREDENTIAL_TYPES.asistente)
</script>

<template>
  <div class="se-cred" :class="{ 'is-small': props.small, 'is-responsive': props.responsive }" :style="{ '--cord': `${props.cord}px` }" :data-se-swing="props.swing ? '' : undefined">
    <svg class="se-cred-cord" :viewBox="`0 0 60 ${props.cord}`" preserveAspectRatio="none" aria-hidden="true">
      <path :d="`M4 0 L18 0 L33 ${props.cord - 14} L27 ${props.cord - 14} Z`" fill="var(--se-cordon)" />
      <path :d="`M42 0 L56 0 L33 ${props.cord - 14} L27 ${props.cord - 14} Z`" fill="var(--se-cordon)" opacity="0.86" />
      <rect x="24" :y="props.cord - 18" width="12" height="18" rx="2" fill="#b9c0c4" stroke="#7d868b" stroke-width="1" />
    </svg>
    <div class="se-cred-card">
      <p class="se-cred-band" :class="`is-${kind.pattern}`"><span>{{ kind.label }}</span></p>
      <div class="se-cred-body">
        <p class="se-cred-name">{{ props.name }}</p>
        <p class="se-cred-org">{{ props.org }}</p>
        <p class="se-meta se-cred-day">{{ props.day }}</p>
        <div class="se-cred-foot">
          <span v-if="props.example" class="se-example">ejemplo</span>
          <picture v-if="props.photo">
            <source v-for="source in props.photo.sources" :key="source.type" :type="source.type" :srcset="source.srcset" sizes="80px" />
            <img class="se-cred-photo" :src="props.photo.src" alt="" :width="props.photo.width" :height="props.photo.height" loading="lazy" decoding="async" />
          </picture>
          <svg v-else class="se-cred-qr" viewBox="-1 -1 23 23" shape-rendering="crispEdges" aria-hidden="true">
            <path :d="DECOR_QR_PATH" fill="var(--se-grafito)" />
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

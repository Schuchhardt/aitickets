<script setup>
import { ref, onMounted, defineProps } from "vue";
import QRCode from "qrcode";

const props = defineProps({
  code: String, // Código QR desde la BD
});

const qrSrc = ref("");

onMounted(async () => {
  if (props.code) {
    console.log("Generando QR para:", props.code); // Debugging en consola
    try {
      qrSrc.value = await QRCode.toDataURL(props.code); // Genera la imagen
    } catch (err) {
      console.error("Error generando QR:", err);
    }
  } else {
    console.error("No se recibió código QR válido.");
  }
});
</script>

<template>
  <div v-if="qrSrc" class="mt-4 text-center">
    <img :src="qrSrc" alt="Código QR" class="mx-auto w-48 h-48" />
  </div>
  <p v-else class="text-red-600">Código QR no disponible.</p>
</template>

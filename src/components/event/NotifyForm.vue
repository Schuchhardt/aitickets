<script setup>
// "Avisarme…" de los estados sin venta (agotado, venta por abrir): solo email + un botón.
import { ref, onMounted } from "vue";
import { joinWaitlist, rememberedBuyer } from "./checkoutApi.js";
import { isValidEmail } from "../Reservation/pricing.js";

const props = defineProps({
  event: { type: Object, required: true },
  kind: { type: String, required: true }, // 'sold_out' | 'sale_opens'
  cta: { type: String, required: true },
  secondary: { type: Boolean, default: false },
});

const email = ref("");
const error = ref("");
const busy = ref(false);
const done = ref(false);
const shake = ref(0);

onMounted(() => {
  email.value = rememberedBuyer()?.email || "";
});

async function submit() {
  if (busy.value) return;
  if (!isValidEmail(email.value.trim())) {
    error.value = "Revisa tu email, parece incompleto.";
    shake.value++;
    return;
  }
  error.value = "";
  busy.value = true;
  const res = props.event?.is_demo ? { ok: true } : await joinWaitlist(props.event, { email: email.value, kind: props.kind });
  busy.value = false;
  if (res.ok) done.value = true;
  else error.value = res.network ? "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo." : res.data?.message || "Algo falló de nuestro lado. Inténtalo en unos segundos.";
}
</script>

<template>
  <p v-if="done" class="done" role="status">Listo. Te escribimos a {{ email.trim() }}.</p>
  <form v-else class="notify" novalidate @submit.prevent="submit">
    <label class="sr-only" :for="`notify-${kind}-${event.id}`">Email</label>
    <input
      :id="`notify-${kind}-${event.id}`"
      v-model="email"
      class="ev-field"
      :class="error ? (shake % 2 ? 'ev-shake-a' : 'ev-shake-b') : ''"
      type="email"
      inputmode="email"
      autocomplete="email"
      placeholder="tu@email.com"
      :aria-invalid="error ? 'true' : 'false'"
      :aria-describedby="error ? `notify-err-${kind}-${event.id}` : undefined"
      @input="error = ''"
    />
    <p v-if="error" :id="`notify-err-${kind}-${event.id}`" class="ev-error" role="alert">{{ error }}</p>
    <button type="submit" class="ev-btn w-full" :class="secondary ? 'ev-btn-secondary' : 'ev-btn-primary'" :aria-busy="busy ? 'true' : 'false'" :disabled="busy">
      <span v-if="busy" class="ev-spinner" :class="{ 'ev-spinner-dark': secondary }" aria-hidden="true"></span>
      {{ cta }}
    </button>
  </form>
</template>

<style scoped>
.notify {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.notify .ev-error {
  margin-top: -4px;
}
.done {
  font-size: 15px;
  font-weight: 500;
  line-height: 22px;
  word-break: break-word;
}
</style>

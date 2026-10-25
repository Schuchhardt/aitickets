<script setup>
// "Mis entradas" sin sesión: el asistente escribe su email y le llega un link de acceso (/api/buyer/access-link).
// Con orderId (página de una orden) no pide el email: el link va al comprador de esa orden.
import { ref } from "vue";

const props = defineProps({
  orderId: { type: String, required: false },
  maskedEmail: { type: String, required: false },
});

const email = ref("");
const state = ref("idle"); // idle | sending | sent | error
const message = ref("");

async function submit() {
  if (state.value === "sending") return;
  if (!props.orderId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    state.value = "error";
    message.value = "Revisa tu email, parece incompleto.";
    return;
  }
  state.value = "sending";
  message.value = "";
  try {
    const res = await fetch("/api/buyer/access-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(props.orderId ? { orderId: props.orderId } : { email: email.value.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    state.value = res.ok ? "sent" : "error";
    message.value = data.message || (res.ok ? "Listo, revisa tu correo." : "No pudimos enviar el link. Inténtalo en unos minutos.");
  } catch {
    state.value = "error";
    message.value = "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.";
  }
}
</script>

<template>
  <div class="font-[Prompt]">
    <p v-if="state === 'sent'" class="flex items-start gap-2 rounded-xl bg-lime-50 border border-lime-200 px-4 py-3 text-sm text-lime-900" role="status">
      <svg class="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      <span>{{ message }}</span>
    </p>

    <form v-else-if="orderId" class="flex flex-col sm:flex-row sm:items-center gap-3" @submit.prevent="submit">
      <p class="flex-1 text-sm text-gray-600">
        Guarda tus entradas en este dispositivo: te enviamos un link de acceso a <strong class="text-gray-900">{{ maskedEmail }}</strong>.
      </p>
      <button type="submit" class="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:border-gray-900 transition disabled:opacity-50" :disabled="state === 'sending'">
        {{ state === "sending" ? "Enviando…" : "Enviarme el link" }}
      </button>
      <p v-if="state === 'error'" class="text-sm text-red-600 sm:basis-full" role="alert">{{ message }}</p>
    </form>

    <form v-else class="space-y-3" novalidate @submit.prevent="submit">
      <label for="buyer-access-email" class="block text-sm font-medium text-gray-700">Email con el que compraste o te inscribiste</label>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          id="buyer-access-email"
          v-model="email"
          type="email"
          inputmode="email"
          autocomplete="email"
          autocapitalize="off"
          spellcheck="false"
          maxlength="254"
          required
          placeholder="tu@email.com"
          class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none focus:border-gray-900 focus:ring-2 focus:ring-lime-300"
          :aria-invalid="state === 'error' ? 'true' : 'false'"
          @input="state === 'error' && (state = 'idle')"
        />
        <button type="submit" class="rounded-lg bg-black px-5 py-3 text-sm font-semibold font-[Unbounded] text-white hover:bg-gray-800 transition disabled:opacity-50" :disabled="state === 'sending'">
          {{ state === "sending" ? "Enviando…" : "Enviarme el link" }}
        </button>
      </div>
      <p v-if="state === 'error'" class="text-sm text-red-600" role="alert">{{ message }}</p>
      <p v-else class="text-xs text-gray-500">Te llega un link de acceso (sin contraseña). Este dispositivo queda con la sesión iniciada.</p>
    </form>
  </div>
</template>

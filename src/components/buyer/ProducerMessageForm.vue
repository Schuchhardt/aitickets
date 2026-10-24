<script setup>
// "¿Tienes una pregunta? Escríbele a la productora" en la página de la orden (/order/<id>#mensaje).
// El mensaje le llega por correo a la productora con Reply-To = asistente y queda en su panel. API: /api/orders/message.
import { ref, onMounted, nextTick } from "vue";

const MAX = 2000;

const props = defineProps({
  orderId: { type: String, required: true },
  organizerName: { type: String, required: false },
  email: { type: String, required: false },
});

const open = ref(false);
const text = ref("");
const state = ref("idle"); // idle | sending | sent | error
const feedback = ref("");
const textarea = ref(null);
const who = props.organizerName || "la productora";

async function expand() {
  open.value = true;
  await nextTick();
  textarea.value?.focus({ preventScroll: true });
}

onMounted(() => {
  // Link "Escríbele a la productora" del correo de entradas
  if (window.location.hash === "#mensaje") expand();
});

async function submit() {
  if (state.value === "sending") return;
  if (text.value.trim().length < 2) {
    state.value = "error";
    feedback.value = "Escribe tu mensaje.";
    return;
  }
  state.value = "sending";
  feedback.value = "";
  try {
    const res = await fetch("/api/orders/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: props.orderId, message: text.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "No pudimos enviar tu mensaje. Inténtalo de nuevo.");
    state.value = "sent";
    feedback.value = data.message || "Listo, recibieron tu mensaje.";
    text.value = "";
  } catch (err) {
    state.value = "error";
    feedback.value = err.message || "No pudimos conectar. Inténtalo de nuevo.";
  }
}
</script>

<template>
  <section id="mensaje" class="rounded-2xl bg-white border border-gray-200 font-[Prompt] scroll-mt-24">
    <button
      v-if="!open"
      type="button"
      class="flex w-full items-center justify-between gap-3 p-5 text-left"
      aria-controls="mensaje-form"
      :aria-expanded="open"
      @click="expand"
    >
      <span>
        <span class="block font-semibold text-gray-900">¿Tienes una pregunta?</span>
        <span class="block text-sm text-gray-500">Escríbele a {{ who }}</span>
      </span>
      <svg class="h-5 w-5 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
    </button>

    <div v-else id="mensaje-form" class="p-5">
      <p class="font-semibold text-gray-900">Escríbele a {{ who }}</p>
      <p v-if="state === 'sent'" class="mt-3 flex items-start gap-2 rounded-xl bg-lime-50 border border-lime-200 px-4 py-3 text-sm text-lime-900" role="status">
        <svg class="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        <span>{{ feedback }}</span>
      </p>
      <form v-else class="mt-3 space-y-2" @submit.prevent="submit">
        <label for="mensaje-texto" class="sr-only">Tu mensaje</label>
        <textarea
          id="mensaje-texto"
          ref="textarea"
          v-model="text"
          rows="4"
          :maxlength="MAX"
          placeholder="Por ejemplo: ¿se puede entrar con niños? ¿Hay estacionamiento?"
          class="w-full resize-y rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-2 focus:ring-lime-300"
          @input="state === 'error' && (state = 'idle')"
        ></textarea>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-gray-500">{{ email ? `Te responderán a ${email}.` : "Te responderán a tu correo." }}</p>
          <button type="submit" class="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50" :disabled="state === 'sending'">
            {{ state === "sending" ? "Enviando…" : "Enviar mensaje" }}
          </button>
        </div>
        <p v-if="state === 'error'" class="text-sm text-red-600" role="alert">{{ feedback }}</p>
      </form>
    </div>
  </section>
</template>

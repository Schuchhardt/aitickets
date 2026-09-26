<script setup>
// Formulario de contacto del sitio del productor. POST /api/sites/contact.
// Antiabuso: honeypot (campo "hp" oculto), tiempo mínimo de llenado (startedAt), límite por IP en el
// servidor y Turnstile cuando el sitio se ve bajo aitickets.cl (turnstileSiteKey presente).
import { ref, reactive, onMounted, computed } from "vue";

const props = defineProps({
  siteSlug: { type: String, required: true },
  turnstileSiteKey: { type: String, default: "" },
  isDemo: { type: Boolean, default: false },
});

const form = reactive({ name: "", email: "", phone: "", message: "", hp: "" });
const startedAt = ref(Date.now());
const status = ref("idle"); // idle | sending | sent | error
const errorMessage = ref("");
const turnstileToken = ref("");
const turnstileWidgetId = ref(null);

const messageLength = computed(() => form.message.trim().length);

onMounted(() => {
  startedAt.value = Date.now();
  if (!props.turnstileSiteKey) return;
  const render = () => {
    if (!window.turnstile || turnstileWidgetId.value !== null) return false;
    turnstileWidgetId.value = window.turnstile.render("#site-contact-turnstile", {
      sitekey: props.turnstileSiteKey,
      callback: (token) => {
        turnstileToken.value = token;
      },
      "expired-callback": () => {
        turnstileToken.value = "";
      },
    });
    return true;
  };
  if (!render()) {
    const timer = setInterval(() => {
      if (render()) clearInterval(timer);
    }, 300);
    setTimeout(() => clearInterval(timer), 15000);
  }
});

function resetTurnstile() {
  if (window.turnstile && turnstileWidgetId.value !== null) {
    window.turnstile.reset(turnstileWidgetId.value);
    turnstileToken.value = "";
  }
}

async function submit() {
  errorMessage.value = "";
  if (form.name.trim().length < 2) return (errorMessage.value = "Escribe tu nombre.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return (errorMessage.value = "Escribe un correo válido.");
  if (messageLength.value < 10) return (errorMessage.value = "El mensaje debe tener al menos 10 caracteres.");
  if (messageLength.value > 5000) return (errorMessage.value = "El mensaje no puede superar los 5.000 caracteres.");
  if (props.turnstileSiteKey && !turnstileToken.value) return (errorMessage.value = "Completa la verificación de seguridad.");

  status.value = "sending";
  try {
    const res = await fetch("/api/sites/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteSlug: props.siteSlug,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        message: form.message.trim(),
        turnstileToken: turnstileToken.value || undefined,
        hp: form.hp,
        startedAt: startedAt.value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "No pudimos enviar tu mensaje. Inténtalo de nuevo.");
    }
    status.value = "sent";
  } catch (err) {
    status.value = "error";
    errorMessage.value = err?.message || "No pudimos enviar tu mensaje. Inténtalo de nuevo.";
    resetTurnstile();
  }
}
</script>

<template>
  <div class="site-font">
    <div v-if="status === 'sent'" class="rounded-2xl border border-current/15 p-6" role="status">
      <p class="text-lg font-bold">¡Mensaje enviado!</p>
      <p class="mt-2 opacity-80">
        {{ isDemo ? "Este es un sitio de demostración: el mensaje no se envió a nadie." : "Te responderán directamente a tu correo." }}
      </p>
    </div>

    <form v-else data-testid="site-contact-form" class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <!-- Honeypot: los humanos no lo ven -->
      <div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">
        <label>No completar <input v-model="form.hp" type="text" name="website" tabindex="-1" autocomplete="off" /></label>
      </div>

      <label class="flex flex-col gap-1 text-sm font-medium">
        Nombre
        <input v-model="form.name" type="text" name="name" required maxlength="120" autocomplete="name"
          class="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-base font-normal focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]" />
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">
        Correo
        <input v-model="form.email" type="email" name="email" required maxlength="254" autocomplete="email"
          class="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-base font-normal focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]" />
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">
        Teléfono (opcional)
        <input v-model="form.phone" type="tel" name="phone" maxlength="40" autocomplete="tel"
          class="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-base font-normal focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]" />
      </label>
      <label class="flex flex-col gap-1 text-sm font-medium">
        Mensaje
        <textarea v-model="form.message" name="message" required rows="6" maxlength="5000"
          class="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-base font-normal focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]"></textarea>
        <span class="text-xs font-normal opacity-60 self-end">{{ messageLength }}/5000</span>
      </label>

      <div v-if="turnstileSiteKey" id="site-contact-turnstile"></div>

      <p v-if="errorMessage" class="text-sm text-red-600" role="alert">{{ errorMessage }}</p>

      <button
        type="submit"
        data-testid="site-contact-submit"
        :disabled="status === 'sending'"
        class="self-start rounded-full bg-[var(--site-primary)] text-[var(--site-bg)] px-6 py-3 font-bold disabled:opacity-60"
      >
        {{ status === "sending" ? "Enviando…" : "Enviar mensaje" }}
      </button>
      <p class="text-xs opacity-60">
        Tu mensaje y tus datos se envían al organizador para que te responda. Ver
        <a href="https://aitickets.cl/privacy" class="underline" target="_blank" rel="noopener">aviso de privacidad</a>.
      </p>
    </form>
  </div>
</template>

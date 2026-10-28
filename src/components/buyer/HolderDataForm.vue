<script setup>
// "Completa tus datos" en /ticket/<id>: la persona de esta entrada escribe su nombre y responde las preguntas por
// persona del evento (events.checkout_fields, src/lib/checkoutFields.mjs). Llega aquí desde el correo de su entrada
// cuando quien compró la invitó. Abierto si falta algo obligatorio; si no, "Editar mis datos" lo abre. Guarda con
// POST /api/tickets/holder (mismas reglas que el checkout). Faltar datos no invalida el QR.
import { ref, computed, nextTick } from "vue";
import QuestionFields from "../event/QuestionFields.vue";
import { validateHolderUpdate, answerFor } from "../../lib/checkoutFields.mjs";

const props = defineProps({
  ticketId: { type: String, required: true },
  /** events.checkout_fields normalizado */
  fields: { type: Object, required: true },
  name: { type: String, default: "" },
  answers: { type: Array, required: false },
  /** Lo que falta ('Nombre' o el texto de cada pregunta) */
  missing: { type: Array, required: false },
});

const questions = computed(() => (props.fields?.questions || []).filter((q) => q.per === "attendee"));
const nameRequired = computed(() => props.fields?.attendee_names === "required");
const open = ref((props.missing || []).length > 0);
const pending = ref([...(props.missing || [])]);
const form = ref({
  name: props.name || "",
  answers: Object.fromEntries(questions.value.map((q) => [q.id, answerFor(props.answers, q) || undefined]).filter(([, v]) => v)),
});
const busy = ref(false);
const error = ref("");
const saved = ref(false);
const root = ref(null);

async function save() {
  if (busy.value) return;
  saved.value = false;
  const check = validateHolderUpdate(props.fields, form.value);
  if (check.error) {
    error.value = check.error;
    await nextTick();
    root.value?.querySelector(check.field === "name" ? "#holder-data-name" : "[data-testid='question'] input, [data-testid='question'] select, [data-testid='question'] button")?.focus();
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const res = await fetch("/api/tickets/holder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: props.ticketId, name: form.value.name, answers: form.value.answers }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      error.value = data?.message || "No pudimos guardar tus datos. Intenta de nuevo.";
      return;
    }
    pending.value = Array.isArray(data.missing) ? data.missing : [];
    saved.value = true;
    open.value = false;
  } catch {
    error.value = "No pudimos guardar tus datos. Revisa tu conexión e intenta de nuevo.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section ref="root" class="rounded-2xl border bg-white p-4" :class="pending.length ? 'border-amber-300' : 'border-gray-200'" data-testid="holder-data">
    <template v-if="open">
      <h2 class="text-base font-semibold text-gray-900">Completa tus datos</h2>
      <p class="mt-1 text-sm text-gray-600">La productora pide estos datos de cada asistente. Tu entrada sirve igual mientras tanto.</p>
      <form class="mt-4 space-y-4" novalidate @submit.prevent="save">
        <div>
          <label class="ev-label" for="holder-data-name">Nombre y apellido<span v-if="!nameRequired" class="font-normal text-gray-500"> (opcional)</span></label>
          <input id="holder-data-name" v-model="form.name" class="ev-field" type="text" autocomplete="name" autocapitalize="words" maxlength="120" :readonly="busy" data-testid="holder-data-name" @input="error = ''" />
        </div>
        <QuestionFields v-if="questions.length" :questions="questions" :answers="form.answers" id-prefix="holder-data-q" :disabled="busy" @change="error = ''" />
        <p v-if="error" class="ev-error" role="alert">{{ error }}</p>
        <button type="submit" class="w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white disabled:opacity-60" :disabled="busy" data-testid="holder-data-save">
          {{ busy ? "Guardando..." : "Guardar mis datos" }}
        </button>
      </form>
    </template>
    <template v-else>
      <p v-if="saved && !pending.length" class="text-sm font-semibold text-gray-900" role="status">Listo, tus datos quedaron guardados.</p>
      <p v-else-if="pending.length" class="text-sm text-amber-900">Te falta completar: {{ pending.join(", ") }}.</p>
      <p v-else class="text-sm text-gray-700">Tus datos están completos.</p>
      <button type="button" class="mt-2 text-sm font-semibold underline" data-testid="holder-data-edit" @click="open = true">{{ pending.length ? "Completar mis datos" : "Editar mis datos" }}</button>
    </template>
  </section>
</template>

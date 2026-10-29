<script setup>
// Preguntas frecuentes del evento (detalle del evento y formulario de edición del panel). Crear y editar una
// pregunta se hace en un modal; las sugerencias con IA se revisan en la lista antes de agregarlas.
// API: /api/events/faqs (se guarda al instante, no depende del botón "Guardar" del formulario).
import { ref, computed, nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import SkeletonRows from "./SkeletonRows.vue";
import { Sparkles, X } from "lucide-vue-next";

const props = defineProps({
  eventId: { type: Number, required: true },
});

const QUESTION_MAX = 500;
const ANSWER_MAX = 3000;

const faqs = ref([]);
const loading = ref(true);
const saving = ref(false);
const listError = ref("");

// Modal de crear / editar
const modalOpen = ref(false);
const editingId = ref(null);
const form = ref({ question: "", answer: "" });
const formError = ref("");
const questionInput = ref(null);
let lastFocus = null;

async function fetchFaqs() {
  loading.value = true;
  try {
    const res = await fetch(`/api/events/faqs?eventId=${props.eventId}`);
    const data = await res.json();
    if (res.ok) {
      faqs.value = data.faqs || [];
    }
  } catch (e) {
    console.error("Error loading FAQs:", e);
  } finally {
    loading.value = false;
  }
}

function openModal(faq = null) {
  lastFocus = typeof document !== "undefined" ? document.activeElement : null;
  editingId.value = faq?.id ?? null;
  form.value = { question: faq?.question || "", answer: faq?.answer || "" };
  formError.value = "";
  modalOpen.value = true;
}

function closeModal() {
  if (saving.value) return;
  modalOpen.value = false;
}

const canSave = computed(() => Boolean(form.value.question.trim() && form.value.answer.trim()) && !saving.value);

async function saveFaq() {
  if (!canSave.value) return;
  saving.value = true;
  formError.value = "";

  try {
    const payload = {
      eventId: props.eventId,
      question: form.value.question.trim(),
      answer: form.value.answer.trim(),
    };

    if (editingId.value) {
      payload.action = "update";
      payload.id = editingId.value;
    }

    const res = await fetch("/api/events/faqs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "No se pudo guardar la pregunta");
    }
    saving.value = false;
    closeModal();
    await fetchFaqs();
  } catch (e) {
    formError.value = e.message || "No se pudo guardar la pregunta";
  } finally {
    saving.value = false;
  }
}

async function deleteFaq(id) {
  if (!confirm("¿Eliminar esta pregunta frecuente?")) return;
  listError.value = "";

  try {
    const res = await fetch("/api/events/faqs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: props.eventId,
        action: "delete",
        id,
      }),
    });

    if (res.ok) {
      await fetchFaqs();
    } else {
      listError.value = "No se pudo eliminar la pregunta";
    }
  } catch (e) {
    console.error("Error deleting FAQ:", e);
    listError.value = "No se pudo eliminar la pregunta";
  }
}

function onModalKey(e) {
  if (e.key === "Escape") closeModal();
  // Cmd/Ctrl + Enter guarda desde cualquier campo
  else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveFaq();
}

watch(modalOpen, async (open) => {
  if (typeof document === "undefined") return;
  if (open) {
    document.addEventListener("keydown", onModalKey);
    document.documentElement.style.overflow = "hidden";
    await nextTick();
    questionInput.value?.focus();
  } else {
    document.removeEventListener("keydown", onModalKey);
    document.documentElement.style.overflow = "";
    lastFocus?.focus?.();
  }
});

onBeforeUnmount(() => {
  if (typeof document === "undefined") return;
  document.removeEventListener("keydown", onModalKey);
  if (modalOpen.value) document.documentElement.style.overflow = "";
});

// Sugerencias con IA (no se guardan hasta que el productor las agrega)
const aiOpen = ref(false);
const aiGuide = ref("");
const aiBusy = ref(false);
const aiError = ref("");
const suggestions = ref([]);
const selectedCount = computed(() => suggestions.value.filter((s) => s.selected).length);

async function generateFaqs() {
  aiBusy.value = true;
  aiError.value = "";
  try {
    const res = await fetch("/api/events/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "faqs", eventId: props.eventId, guide: aiGuide.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "No se pudieron generar las preguntas");
    suggestions.value = (data.faqs || []).map((f) => ({ ...f, selected: true }));
    if (!suggestions.value.length) aiError.value = "La IA no propuso preguntas nuevas.";
  } catch (e) {
    aiError.value = e.message;
  } finally {
    aiBusy.value = false;
  }
}

async function addSuggestions() {
  aiBusy.value = true;
  aiError.value = "";
  try {
    for (const s of suggestions.value.filter((x) => x.selected)) {
      const res = await fetch("/api/events/faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: props.eventId, question: s.question, answer: s.answer }),
      });
      if (!res.ok) throw new Error("No se pudieron guardar todas las preguntas");
      s.saved = true;
    }
    suggestions.value = [];
    aiOpen.value = false;
  } catch (e) {
    aiError.value = e.message;
    suggestions.value = suggestions.value.filter((s) => !s.saved);
  } finally {
    aiBusy.value = false;
    await fetchFaqs();
  }
}

onMounted(fetchFaqs);
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div class="p-4 sm:p-6 border-b border-gray-100 flex flex-wrap justify-between items-center gap-3">
      <h3 class="font-bold text-lg">Preguntas Frecuentes</h3>
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          @click="aiOpen = !aiOpen"
          class="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg"
          :class="aiOpen ? 'bg-black text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'"
        >
          <Sparkles size="15" /> Generar con IA
        </button>
        <button
          type="button"
          @click="openModal()"
          class="text-sm text-black font-medium hover:underline cursor-pointer"
        >
          + Agregar
        </button>
      </div>
    </div>

    <!-- Sugerencias con IA -->
    <div v-if="aiOpen" class="p-4 sm:p-6 bg-purple-50/40 border-b border-purple-100 space-y-3">
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          v-model="aiGuide"
          type="text"
          maxlength="1000"
          @keydown.enter.prevent="generateFaqs"
          placeholder="Guía opcional (ej: es para mayores de 18, hay guardarropía, no se permite ingresar comida)"
          class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button
          type="button"
          :disabled="aiBusy"
          @click="generateFaqs"
          class="flex items-center justify-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-60"
        >
          <span v-if="aiBusy && !suggestions.length" class="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"></span>
          {{ aiBusy && !suggestions.length ? "Generando..." : suggestions.length ? "Generar otras" : "Generar preguntas" }}
        </button>
      </div>
      <p class="text-xs text-gray-500">Usa los datos del evento y evita repetir las preguntas que ya tienes. Revisa las respuestas antes de agregarlas.</p>

      <div v-if="suggestions.length" class="space-y-2">
        <label
          v-for="(s, i) in suggestions"
          :key="i"
          class="flex gap-3 p-3 bg-white rounded-lg border cursor-pointer"
          :class="s.selected ? 'border-black' : 'border-gray-200 opacity-60'"
        >
          <input v-model="s.selected" type="checkbox" class="mt-1 w-4 h-4 rounded border-gray-300" />
          <span class="min-w-0">
            <span class="block font-medium text-gray-900 text-sm">{{ s.question }}</span>
            <span class="block text-sm text-gray-500 mt-0.5">{{ s.answer }}</span>
          </span>
        </label>
        <button
          type="button"
          :disabled="aiBusy || !selectedCount"
          @click="addSuggestions"
          class="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-50"
        >
          {{ aiBusy ? "Agregando..." : `Agregar ${selectedCount} pregunta${selectedCount === 1 ? "" : "s"}` }}
        </button>
      </div>
      <p v-if="aiError" class="text-sm text-red-600">{{ aiError }}</p>
    </div>

    <!-- FAQ List -->
    <div v-if="loading" class="p-4 sm:p-6">
      <SkeletonRows variant="lines" :rows="5" label="Cargando preguntas" />
    </div>

    <div v-else-if="faqs.length === 0" class="p-6 sm:p-8 text-center text-gray-500">
      No hay preguntas frecuentes. Agrega una para que aparezca en la página del evento.
    </div>

    <div v-else class="divide-y divide-gray-100">
      <div
        v-for="faq in faqs"
        :key="faq.id"
        class="p-4 hover:bg-gray-50 transition"
      >
        <div class="flex justify-between items-start gap-4">
          <div class="flex-1 min-w-0">
            <p class="font-bold text-gray-900 break-words">{{ faq.question }}</p>
            <p class="text-sm text-gray-500 mt-1 break-words whitespace-pre-line">{{ faq.answer }}</p>
          </div>
          <div class="flex gap-2 shrink-0">
            <button
              type="button"
              @click="openModal(faq)"
              class="py-1 text-xs text-gray-500 hover:text-black cursor-pointer"
            >
              Editar
            </button>
            <button
              type="button"
              @click="deleteFaq(faq.id)"
              class="py-1 text-xs text-red-500 hover:text-red-700 cursor-pointer"
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </div>
    <p v-if="listError" class="px-4 pb-4 text-sm text-red-600" role="alert">{{ listError }}</p>

    <!-- Modal: crear / editar una pregunta (fixed; sin Teleport para no complicar la hidratación de la isla) -->
    <div
      v-if="modalOpen"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="faq-modal-title"
      data-testid="faq-modal"
      @click.self="closeModal"
    >
      <form
        class="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-gray-200 p-5 sm:p-6 relative font-[Prompt]"
        @submit.prevent="saveFaq"
      >
        <button
          type="button"
          class="absolute right-4 top-4 p-1 rounded text-gray-400 hover:text-gray-700 disabled:opacity-50"
          aria-label="Cerrar"
          :disabled="saving"
          @click="closeModal"
        >
          <X size="18" />
        </button>
        <h4 id="faq-modal-title" class="text-lg font-bold font-[Unbounded] pr-8">
          {{ editingId ? "Editar pregunta" : "Nueva pregunta" }}
        </h4>
        <p class="text-sm text-gray-500 mt-1">Se muestra en la página del evento y el asistente IA la usa para responder.</p>

        <div class="mt-5 space-y-4">
          <div>
            <label for="faq-question" class="block text-sm font-medium text-gray-700 mb-1">Pregunta</label>
            <input
              id="faq-question"
              ref="questionInput"
              v-model="form.question"
              type="text"
              :maxlength="QUESTION_MAX"
              placeholder="Ej: ¿Puedo llevar niños?"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <div>
            <label for="faq-answer" class="block text-sm font-medium text-gray-700 mb-1">Respuesta</label>
            <textarea
              id="faq-answer"
              v-model="form.answer"
              :maxlength="ANSWER_MAX"
              placeholder="Escribe la respuesta..."
              rows="5"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black resize-y"
            />
            <p class="text-xs text-gray-400 text-right tabular-nums">{{ form.answer.length }}/{{ ANSWER_MAX }}</p>
          </div>
          <p v-if="formError" class="text-sm text-red-600" role="alert">{{ formError }}</p>
        </div>

        <div class="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            :disabled="saving"
            @click="closeModal"
            class="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            :disabled="!canSave"
            class="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ saving ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar pregunta" }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { Sparkles } from "lucide-vue-next";

const props = defineProps({
  eventId: { type: Number, required: true },
});

const faqs = ref([]);
const loading = ref(true);
const saving = ref(false);

// Form state
const showForm = ref(false);
const editingId = ref(null);
const form = ref({ question: "", answer: "" });

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

async function saveFaq() {
  if (!form.value.question.trim() || !form.value.answer.trim()) return;
  saving.value = true;

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

    if (res.ok) {
      resetForm();
      await fetchFaqs();
    }
  } catch (e) {
    console.error("Error saving FAQ:", e);
  } finally {
    saving.value = false;
  }
}

async function deleteFaq(id) {
  if (!confirm("¿Eliminar esta pregunta frecuente?")) return;

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
    }
  } catch (e) {
    console.error("Error deleting FAQ:", e);
  }
}

function startEdit(faq) {
  editingId.value = faq.id;
  form.value.question = faq.question;
  form.value.answer = faq.answer;
  showForm.value = true;
}

function resetForm() {
  editingId.value = null;
  form.value = { question: "", answer: "" };
  showForm.value = false;
}

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
          @click="showForm = !showForm; editingId = null; form = { question: '', answer: '' }"
          class="text-sm text-black font-medium hover:underline cursor-pointer"
        >
          {{ showForm ? "Cancelar" : "+ Agregar" }}
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

    <!-- Add/Edit Form -->
    <div v-if="showForm" class="p-4 sm:p-6 bg-gray-50 border-b border-gray-100">
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Pregunta</label>
          <input
            v-model="form.question"
            type="text"
            placeholder="Ej: ¿Puedo llevar niños?"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Respuesta</label>
          <textarea
            v-model="form.answer"
            placeholder="Escribe la respuesta..."
            rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none"
          />
        </div>
        <div class="flex gap-2">
          <button
            @click="saveFaq"
            :disabled="saving || !form.question.trim() || !form.answer.trim()"
            class="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ saving ? "Guardando..." : editingId ? "Actualizar" : "Guardar" }}
          </button>
          <button
            @click="resetForm"
            class="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>

    <!-- FAQ List -->
    <div v-if="loading" class="p-6 sm:p-8 text-center text-gray-500">
      Cargando...
    </div>

    <div v-else-if="faqs.length === 0 && !showForm" class="p-6 sm:p-8 text-center text-gray-500">
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
            <p class="text-sm text-gray-500 mt-1 break-words">{{ faq.answer }}</p>
          </div>
          <div class="flex gap-2 shrink-0">
            <button
              @click="startEdit(faq)"
              class="py-1 text-xs text-gray-500 hover:text-black cursor-pointer"
            >
              Editar
            </button>
            <button
              @click="deleteFaq(faq.id)"
              class="py-1 text-xs text-red-500 hover:text-red-700 cursor-pointer"
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

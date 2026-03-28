<script setup>
import { ref, onMounted } from "vue";

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

onMounted(fetchFaqs);
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div class="p-6 border-b border-gray-100 flex justify-between items-center">
      <h3 class="font-bold text-lg">Preguntas Frecuentes</h3>
      <button
        @click="showForm = !showForm; editingId = null; form = { question: '', answer: '' }"
        class="text-sm text-black font-medium hover:underline cursor-pointer"
      >
        {{ showForm ? "Cancelar" : "+ Agregar" }}
      </button>
    </div>

    <!-- Add/Edit Form -->
    <div v-if="showForm" class="p-6 bg-gray-50 border-b border-gray-100">
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
    <div v-if="loading" class="p-8 text-center text-gray-500">
      Cargando...
    </div>

    <div v-else-if="faqs.length === 0 && !showForm" class="p-8 text-center text-gray-500">
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
            <p class="font-bold text-gray-900">{{ faq.question }}</p>
            <p class="text-sm text-gray-500 mt-1">{{ faq.answer }}</p>
          </div>
          <div class="flex gap-2 shrink-0">
            <button
              @click="startEdit(faq)"
              class="text-xs text-gray-500 hover:text-black cursor-pointer"
            >
              Editar
            </button>
            <button
              @click="deleteFaq(faq.id)"
              class="text-xs text-red-500 hover:text-red-700 cursor-pointer"
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

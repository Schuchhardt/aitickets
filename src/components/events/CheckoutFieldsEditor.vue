<script setup>
// "Qué pedir al comprar" en los formularios de crear y editar evento (events.checkout_fields,
// src/lib/checkoutFields.mjs): nombre y correo de cada asistente, datos de empresa y preguntas al inscribirse.
// Edita el objeto que recibe (v-model); el servidor lo normaliza al guardar.
import { computed } from 'vue'
import { Plus, Trash2, Users, Building2, MessageSquare } from 'lucide-vue-next'
import { MAX_QUESTIONS, QUESTION_TYPE_LABELS, COMPANY_RECEIPT_NOTE } from '../../lib/checkoutFields.mjs'

const model = defineModel({ type: Object, required: true })

if (!Array.isArray(model.value.questions)) model.value.questions = []
if (!model.value.attendee_names) model.value.attendee_names = 'off'

const canAdd = computed(() => model.value.questions.length < MAX_QUESTIONS)
let seq = 0
function addQuestion() {
  if (!canAdd.value) return
  const used = new Set(model.value.questions.map((q) => q.id))
  let id
  do id = `q${Date.now().toString(36)}${seq++}`
  while (used.has(id))
  model.value.questions.push({ id, label: '', type: 'text', options: [], required: false, optionsText: '' })
}
const removeQuestion = (i) => model.value.questions.splice(i, 1)
// Opciones de "Elegir una opción": una por línea
const optionsText = (q) => (typeof q.optionsText === 'string' ? q.optionsText : (q.options || []).join('\n'))
function setOptions(q, text) {
  q.optionsText = text
  q.options = text.split('\n').map((o) => o.trim()).filter(Boolean)
}
</script>

<template>
  <div class="p-4 rounded-xl border border-gray-200 space-y-5" data-testid="checkout-fields-editor">
    <div>
      <p class="text-sm font-semibold text-gray-900">Qué pedir al comprar</p>
      <p class="text-xs text-gray-500 mt-1">Además del nombre y correo de quien compra.</p>
    </div>

    <div>
      <label class="text-sm font-medium text-gray-800 flex items-center gap-1.5" for="cf-attendee-names"><Users size="16" /> Nombre de cada asistente</label>
      <p class="text-xs text-gray-500 mt-1">En compras de varias entradas (o una mesa), pide nombre y correo de cada persona. Cada QR llega a su correo.</p>
      <select id="cf-attendee-names" v-model="model.attendee_names" class="mt-2 w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none bg-white text-sm" data-testid="cf-attendee-names">
        <option value="off">No pedir</option>
        <option value="optional">Pedir (se pueden dejar en blanco)</option>
        <option value="required">Pedir el nombre de cada uno (obligatorio)</option>
      </select>
    </div>

    <label class="flex items-start gap-3 cursor-pointer">
      <input v-model="model.company" type="checkbox" class="mt-0.5 w-4 h-4 rounded border-gray-300" data-testid="cf-company" />
      <span>
        <span class="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Building2 size="16" /> Datos de la empresa</span>
        <span class="block text-xs text-gray-500 mt-1">Ofrece RUT y razón social, opcionales. {{ COMPANY_RECEIPT_NOTE }}</span>
      </span>
    </label>

    <div>
      <p class="text-sm font-medium text-gray-800 flex items-center gap-1.5"><MessageSquare size="16" /> Preguntas al inscribirse</p>
      <p class="text-xs text-gray-500 mt-1">Se responden una vez por compra. Las ves en la lista de asistentes y en el CSV.</p>
      <div v-for="(q, i) in model.questions" :key="q.id" class="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-2" data-testid="cf-question">
        <div class="flex gap-2">
          <input v-model="q.label" type="text" maxlength="140" placeholder="Ej: ¿Tienes alguna alergia?" class="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none text-sm" />
          <button type="button" class="p-2 text-gray-400 hover:text-red-500" aria-label="Quitar pregunta" @click="removeQuestion(i)"><Trash2 size="16" /></button>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <select v-model="q.type" class="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm">
            <option v-for="(label, value) in QUESTION_TYPE_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input v-model="q.required" type="checkbox" class="w-4 h-4 rounded border-gray-300" /> Obligatoria
          </label>
        </div>
        <div v-if="q.type === 'choice'">
          <textarea
            :value="optionsText(q)"
            rows="3"
            placeholder="Una opción por línea"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none text-sm"
            @input="setOptions(q, $event.target.value)"
          ></textarea>
          <p v-if="(q.options || []).length < 2" class="text-xs text-amber-700">Agrega al menos 2 opciones (sin ellas la pregunta no se guarda).</p>
        </div>
      </div>
      <button v-if="canAdd" type="button" class="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-black" data-testid="cf-add-question" @click="addQuestion">
        <Plus size="16" /> Agregar pregunta
      </button>
    </div>
  </div>
</template>

<script setup>
// "Pedir datos adicionales" en los formularios de crear y editar evento (events.checkout_fields,
// src/lib/checkoutFields.mjs). Un interruptor lo activa; apagado, el checkout pide solo nombre y correo de quien
// compra. Prendido: nombre y correo de cada asistente, quién completa los datos de cada persona (quien compra o cada
// invitado desde su correo), datos de empresa y preguntas al inscribirse (una por compra o una por persona).
// Edita el objeto que recibe (v-model); el servidor lo normaliza al guardar.
import { computed, ref } from 'vue'
import { Plus, Trash2, Users, Building2, MessageSquare, Mail, ClipboardList } from 'lucide-vue-next'
import { MAX_QUESTIONS, QUESTION_TYPE_LABELS, COMPANY_RECEIPT_NOTE } from '../../lib/checkoutFields.mjs'

const model = defineModel({ type: Object, required: true })

if (!Array.isArray(model.value.questions)) model.value.questions = []
if (!model.value.attendee_names) model.value.attendee_names = 'off'
if (!model.value.holders) model.value.holders = 'buyer'
for (const q of model.value.questions) if (!q.per) q.per = 'order'

const defaults = () => ({ attendee_names: 'off', holders: 'buyer', company: false, questions: [] })
const hasExtras = (v) => v.attendee_names !== 'off' || v.company === true || v.questions.length > 0

// Interruptor: apagado deja la configuración por defecto (se guarda así). Lo que había se recuerda por si se vuelve
// a prender antes de guardar.
const enabled = ref(hasExtras(model.value))
let stash = null
function toggle() {
  if (enabled.value) {
    stash = JSON.parse(JSON.stringify(model.value))
    Object.assign(model.value, defaults())
    enabled.value = false
  } else {
    if (stash) Object.assign(model.value, stash)
    enabled.value = true
  }
}

// "Quién completa" solo importa si se pide algo de cada persona
const asksPerPerson = computed(() => model.value.attendee_names !== 'off' || model.value.questions.some((q) => q.per === 'attendee'))

const canAdd = computed(() => model.value.questions.length < MAX_QUESTIONS)
let seq = 0
function addQuestion() {
  if (!canAdd.value) return
  const used = new Set(model.value.questions.map((q) => q.id))
  let id
  do id = `q${Date.now().toString(36)}${seq++}`
  while (used.has(id))
  model.value.questions.push({ id, label: '', type: 'text', options: [], required: false, per: 'order', optionsText: '' })
}
const removeQuestion = (i) => model.value.questions.splice(i, 1)
// Opciones de "Elegir una opción": una por línea
const optionsText = (q) => (typeof q.optionsText === 'string' ? q.optionsText : (q.options || []).join('\n'))
function setOptions(q, text) {
  q.optionsText = text
  q.options = text.split('\n').map((o) => o.trim()).filter(Boolean)
}

const ATTENDEE_OPTIONS = [
  { value: 'off', label: 'No', hint: 'Solo quien compra deja sus datos.' },
  { value: 'optional', label: 'Sí, opcional', hint: 'Se pueden dejar en blanco.' },
  { value: 'required', label: 'Sí, obligatorio', hint: 'El nombre de cada uno es obligatorio.' },
]
</script>

<template>
  <div class="rounded-xl border border-gray-200" data-testid="checkout-fields-editor">
    <div class="flex items-start justify-between gap-4 p-4">
      <div class="min-w-0">
        <p id="cfToggleLabel" class="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><ClipboardList size="16" /> Pedir datos adicionales</p>
        <p class="text-xs text-gray-500 mt-1">
          Por defecto solo pedimos nombre y correo de quien compra. Actívalo para pedir los datos de cada asistente, datos de empresa o hacer preguntas al comprar.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        :aria-checked="enabled ? 'true' : 'false'"
        aria-labelledby="cfToggleLabel"
        class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        :class="enabled ? 'bg-black' : 'bg-gray-300'"
        data-testid="cf-toggle"
        @click="toggle"
      >
        <span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" :class="enabled ? 'translate-x-5' : 'translate-x-0.5'"></span>
      </button>
    </div>

    <div v-if="enabled" class="border-t border-gray-200 divide-y divide-gray-100">
      <!-- 1. Datos de cada asistente -->
      <section class="p-4">
        <p class="text-sm font-medium text-gray-900 flex items-center gap-1.5"><Users size="16" /> ¿Pedir nombre y correo de cada asistente?</p>
        <p class="text-xs text-gray-500 mt-1">Cuando alguien compra varias entradas (o una mesa). Así cada QR llega al correo de su dueño y sabes quién viene.</p>
        <div class="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" data-testid="cf-attendee-names">
          <label
            v-for="opt in ATTENDEE_OPTIONS"
            :key="opt.value"
            class="flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors"
            :class="model.attendee_names === opt.value ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400'"
          >
            <input v-model="model.attendee_names" type="radio" :value="opt.value" class="mt-0.5 w-4 h-4 accent-black" :data-testid="`cf-attendee-names-${opt.value}`" />
            <span class="text-sm text-gray-800">{{ opt.label }}<span class="block text-xs text-gray-500">{{ opt.hint }}</span></span>
          </label>
        </div>

        <fieldset v-if="asksPerPerson" class="mt-4 p-3 rounded-lg bg-gray-50 border border-gray-200" data-testid="cf-holders">
          <legend class="sr-only">Quién completa los datos de cada persona</legend>
          <p class="text-sm font-medium text-gray-800 flex items-center gap-1.5"><Mail size="16" /> ¿Quién completa los datos de los demás?</p>
          <p class="text-xs text-gray-500 mt-1">Quien compra siempre completa los suyos.</p>
          <div class="mt-2 space-y-2">
            <label class="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input v-model="model.holders" type="radio" value="buyer" class="mt-0.5 w-4 h-4 accent-black" data-testid="cf-holders-buyer" />
              <span>Quien compra, al pagar <span class="block text-xs text-gray-500">Escribe el nombre, correo y respuestas de todos en el checkout.</span></span>
            </label>
            <label class="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input v-model="model.holders" type="radio" value="invite" class="mt-0.5 w-4 h-4 accent-black" data-testid="cf-holders-invite" />
              <span>Cada invitado, desde su correo <span class="block text-xs text-gray-500">Quien compra solo escribe el correo de cada uno. A cada invitado le llega su entrada y completa sus datos. Su QR sirve igual mientras tanto; en Asistentes ves quién tiene datos pendientes.</span></span>
            </label>
          </div>
        </fieldset>
      </section>

      <!-- 2. Empresa -->
      <section class="p-4">
        <label class="flex items-start gap-3 cursor-pointer">
          <input v-model="model.company" type="checkbox" class="mt-0.5 w-4 h-4 rounded border-gray-300 accent-black" data-testid="cf-company" />
          <span>
            <span class="text-sm font-medium text-gray-900 flex items-center gap-1.5"><Building2 size="16" /> Pedir datos de empresa</span>
            <span class="block text-xs text-gray-500 mt-1">RUT y razón social, opcionales para quien compra. {{ COMPANY_RECEIPT_NOTE }}</span>
          </span>
        </label>
      </section>

      <!-- 3. Preguntas -->
      <section class="p-4">
        <p class="text-sm font-medium text-gray-900 flex items-center gap-1.5"><MessageSquare size="16" /> Preguntas</p>
        <p class="text-xs text-gray-500 mt-1">Ej: talla de polera, alergias, cómo supiste del evento. Las respuestas aparecen en Asistentes y en el CSV.</p>

        <p v-if="!model.questions.length" class="mt-3 text-xs text-gray-400">Aún no agregas preguntas.</p>

        <div v-for="(q, i) in model.questions" :key="q.id" class="mt-3 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-3" data-testid="cf-question">
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <label :for="`cf-q-label-${q.id}`" class="block text-xs font-medium text-gray-600 mb-1">Pregunta {{ i + 1 }}</label>
              <input :id="`cf-q-label-${q.id}`" v-model="q.label" type="text" maxlength="140" placeholder="Ej: ¿Tienes alguna alergia?" class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none text-sm bg-white" />
            </div>
            <button type="button" class="mt-6 p-2 text-gray-400 hover:text-red-500" aria-label="Quitar pregunta" @click="removeQuestion(i)"><Trash2 size="16" /></button>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label :for="`cf-q-type-${q.id}`" class="block text-xs font-medium text-gray-600 mb-1">Tipo de respuesta</label>
              <select :id="`cf-q-type-${q.id}`" v-model="q.type" class="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm">
                <option v-for="(label, value) in QUESTION_TYPE_LABELS" :key="value" :value="value">{{ label }}</option>
              </select>
            </div>
            <div>
              <label :for="`cf-q-per-${q.id}`" class="block text-xs font-medium text-gray-600 mb-1">¿Quién responde?</label>
              <select :id="`cf-q-per-${q.id}`" v-model="q.per" class="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm" data-testid="cf-question-per">
                <option value="order">Quien compra (una vez por compra)</option>
                <option value="attendee">Cada asistente (una vez por entrada)</option>
              </select>
            </div>
          </div>
          <div v-if="q.type === 'choice'">
            <label :for="`cf-q-options-${q.id}`" class="block text-xs font-medium text-gray-600 mb-1">Opciones (una por línea)</label>
            <textarea
              :id="`cf-q-options-${q.id}`"
              :value="optionsText(q)"
              rows="3"
              placeholder="S&#10;M&#10;L"
              class="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black outline-none text-sm bg-white"
              @input="setOptions(q, $event.target.value)"
            ></textarea>
            <p v-if="(q.options || []).length < 2" class="text-xs text-amber-700">Agrega al menos 2 opciones (sin ellas la pregunta no se guarda).</p>
          </div>
          <label class="flex items-center gap-2 text-sm text-gray-700">
            <input v-model="q.required" type="checkbox" class="w-4 h-4 rounded border-gray-300 accent-black" /> Respuesta obligatoria
          </label>
        </div>

        <button v-if="canAdd" type="button" class="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm font-medium text-gray-700 hover:border-black hover:text-black" data-testid="cf-add-question" @click="addQuestion">
          <Plus size="16" /> Agregar pregunta
        </button>
        <p v-else class="mt-3 text-xs text-gray-500">Máximo {{ MAX_QUESTIONS }} preguntas.</p>
      </section>
    </div>
  </div>
</template>

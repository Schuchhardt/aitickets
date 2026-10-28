<script setup>
// Campos de las preguntas al inscribirse (texto corto, una opción, sí o no). Los usan CheckoutExtras (por compra y
// por persona) y el formulario "Completa tus datos" de /ticket/<id> (HolderDataForm). Edita el objeto de respuestas
// que recibe ({ [preguntaId]: valor }) y avisa con `change` para limpiar errores.
defineProps({
  questions: { type: Array, required: true },
  answers: { type: Object, required: true },
  idPrefix: { type: String, required: true },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(["change"]);
</script>

<template>
  <div class="questions">
    <div v-for="q in questions" :key="q.id" data-testid="question">
      <template v-if="q.type === 'yes_no'">
        <p class="ev-label" :id="`${idPrefix}-${q.id}`">{{ q.label }}<span v-if="!q.required" class="optional"> (opcional)</span></p>
        <div class="yesno" role="radiogroup" :aria-labelledby="`${idPrefix}-${q.id}`">
          <button
            v-for="opt in ['Sí', 'No']"
            :key="opt"
            type="button"
            role="radio"
            class="chip"
            :class="{ 'is-on': answers[q.id] === opt }"
            :aria-checked="answers[q.id] === opt ? 'true' : 'false'"
            :disabled="disabled"
            @click="answers[q.id] = opt; emit('change')"
          >{{ opt }}</button>
        </div>
      </template>
      <template v-else-if="q.type === 'choice'">
        <label class="ev-label" :for="`${idPrefix}-${q.id}`">{{ q.label }}<span v-if="!q.required" class="optional"> (opcional)</span></label>
        <select :id="`${idPrefix}-${q.id}`" v-model="answers[q.id]" class="ev-field" :disabled="disabled" @change="emit('change')">
          <option :value="undefined" disabled>Elige una opción</option>
          <option v-for="opt in q.options" :key="opt" :value="opt">{{ opt }}</option>
        </select>
      </template>
      <template v-else>
        <label class="ev-label" :for="`${idPrefix}-${q.id}`">{{ q.label }}<span v-if="!q.required" class="optional"> (opcional)</span></label>
        <input :id="`${idPrefix}-${q.id}`" v-model="answers[q.id]" class="ev-field" type="text" maxlength="300" :readonly="disabled" @input="emit('change')" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.questions {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 8px;
}
.optional {
  font-weight: 400;
  color: var(--text-2);
}
.yesno {
  display: flex;
  gap: 8px;
}
.chip {
  min-width: 64px;
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface-0);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.chip.is-on {
  background: var(--brand-ink);
  border-color: var(--brand-ink);
  color: #fff;
}
</style>

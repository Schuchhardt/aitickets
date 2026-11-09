<script setup>
// "Artistas, elenco o expositores" en los formularios de crear y editar evento (events.performers,
// src/lib/eventPerformers.mjs). La página del evento los muestra en "Participan" y el JSON-LD los publica como
// performer (Google muestra el evento con sus artistas). Edita la lista que recibe (v-model); el servidor la
// normaliza al guardar. Pegar "Ana, Juan; Los Bunkers" agrega uno por nombre.
import { computed, ref } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { MAX_PERFORMERS, MAX_PERFORMER_NAME } from '../../lib/eventPerformers.mjs'

const model = defineModel({ type: Array, required: true })

const draft = ref('')
const canAdd = computed(() => model.value.length < MAX_PERFORMERS)
const sameName = (a, b) => a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es')

function add() {
  const names = draft.value
    .split(/[,;\n]/)
    .map((n) => n.replace(/\s+/g, ' ').trim().slice(0, MAX_PERFORMER_NAME))
    .filter(Boolean)
  for (const name of names) {
    if (model.value.length >= MAX_PERFORMERS) break
    if (!model.value.some((p) => sameName(p.name || '', name))) model.value.push({ name, type: 'person' })
  }
  draft.value = ''
}
const remove = (i) => model.value.splice(i, 1)
</script>

<template>
  <div data-testid="performers-editor">
    <label for="performer-new" class="block text-sm font-medium text-gray-700 mb-1">
      Artistas, elenco o expositores <span class="font-normal text-gray-400">(opcional)</span>
    </label>
    <p class="mb-2 text-xs text-gray-500">
      Aparecen en la página del evento, en "Participan", y ayudan a que Google muestre tu evento con quienes se presentan.
    </p>

    <ul v-if="model.length" class="mb-2 space-y-2">
      <li v-for="(p, i) in model" :key="i" class="flex items-center gap-2" data-testid="performer-row">
        <input
          v-model="p.name"
          type="text"
          :maxlength="MAX_PERFORMER_NAME"
          :aria-label="`Nombre ${i + 1}`"
          class="min-w-0 flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-black focus:border-black outline-none"
        />
        <select
          v-model="p.type"
          :aria-label="`Tipo de ${p.name || 'participante'}`"
          class="px-2 py-2 rounded-lg border border-gray-300 text-sm bg-white focus:ring-2 focus:ring-black focus:border-black outline-none"
        >
          <option value="person">Persona</option>
          <option value="group">Grupo o banda</option>
        </select>
        <button type="button" class="p-2 text-gray-400 hover:text-red-600" :aria-label="`Quitar ${p.name || 'participante'}`" @click="remove(i)">
          <Trash2 size="16" />
        </button>
      </li>
    </ul>

    <div v-if="canAdd" class="flex gap-2">
      <input
        id="performer-new"
        v-model="draft"
        type="text"
        placeholder="Nombre del artista, banda, compañía o expositor"
        class="min-w-0 flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-black focus:border-black outline-none"
        data-testid="performer-input"
        @keydown.enter.prevent="add"
      />
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-sm font-medium text-gray-700 hover:border-black hover:text-black disabled:opacity-50"
        :disabled="!draft.trim()"
        data-testid="performer-add"
        @click="add"
      >
        <Plus size="16" /> Agregar
      </button>
    </div>
    <p v-else class="text-xs text-gray-500">Llegaste al máximo de {{ MAX_PERFORMERS }}.</p>
  </div>
</template>

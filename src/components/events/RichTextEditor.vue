<script setup>
// Editor de la descripción del evento. El valor (v-model) siempre es HTML; se puede editar en modo
// Visual (WYSIWYG), Markdown o HTML. Con `aiContext` muestra "Generar con IA" (/api/events/ai).
import { nextTick, onMounted, ref, watch } from 'vue'
import { Bold, Italic, Underline, Heading2, Heading3, List, ListOrdered, Quote, Link2, RemoveFormatting, Sparkles } from 'lucide-vue-next'
import { htmlToMarkdown, markdownToHtml, sanitizeClient, toEditorHtml } from '../../lib/richTextClient'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '¿De qué trata tu evento?' },
  // { eventId?, draft: () => ({ name, category, description, details? }) }
  aiContext: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])

const MODES = [
  { key: 'visual', label: 'Visual' },
  { key: 'markdown', label: 'Markdown' },
  { key: 'html', label: 'HTML' },
]
const mode = ref('visual')
const editor = ref(null)
const markdown = ref('')
const source = ref('')
// Último HTML emitido, para no reescribir el editor mientras se escribe
let lastEmitted = null

const emitHtml = (html) => {
  lastEmitted = html
  emit('update:modelValue', html)
}

const fillEditor = (html) => {
  if (editor.value) editor.value.innerHTML = sanitizeClient(toEditorHtml(html))
}

onMounted(() => {
  const html = toEditorHtml(props.modelValue)
  fillEditor(html)
  // Descripción antigua en texto plano: se normaliza a HTML para que el resto del flujo la trate igual
  if (html !== props.modelValue) emitHtml(html)
})

watch(() => props.modelValue, (value) => {
  if (value === lastEmitted) return
  if (mode.value === 'visual') fillEditor(value)
  else if (mode.value === 'markdown') markdown.value = htmlToMarkdown(value)
  else source.value = value
})

const setMode = async (next) => {
  if (next === mode.value) return
  const html = props.modelValue || ''
  mode.value = next
  if (next === 'markdown') markdown.value = htmlToMarkdown(html)
  if (next === 'html') source.value = html
  if (next === 'visual') { await nextTick(); fillEditor(html) }
}

// Visual
const onInput = () => emitHtml(editor.value?.innerHTML === '<br>' ? '' : editor.value?.innerHTML || '')
const exec = (command, value = null) => {
  editor.value?.focus()
  document.execCommand(command, false, value)
  onInput()
}
const addLink = () => {
  const url = prompt('URL del enlace (https://...)')
  if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) exec('createLink', url.trim())
}
// Pegar: conserva solo el formato permitido
const onPaste = (e) => {
  const html = e.clipboardData?.getData('text/html')
  const text = e.clipboardData?.getData('text/plain') || ''
  e.preventDefault()
  if (html) document.execCommand('insertHTML', false, sanitizeClient(html))
  else document.execCommand('insertText', false, text)
  onInput()
}
const TOOLBAR = [
  { icon: Bold, title: 'Negrita', run: () => exec('bold') },
  { icon: Italic, title: 'Cursiva', run: () => exec('italic') },
  { icon: Underline, title: 'Subrayado', run: () => exec('underline') },
  { sep: true },
  { icon: Heading2, title: 'Subtítulo', run: () => exec('formatBlock', '<h2>') },
  { icon: Heading3, title: 'Subtítulo pequeño', run: () => exec('formatBlock', '<h3>') },
  { icon: Quote, title: 'Cita', run: () => exec('formatBlock', '<blockquote>') },
  { sep: true },
  { icon: List, title: 'Lista', run: () => exec('insertUnorderedList') },
  { icon: ListOrdered, title: 'Lista numerada', run: () => exec('insertOrderedList') },
  { icon: Link2, title: 'Enlace', run: addLink },
  { icon: RemoveFormatting, title: 'Quitar formato', run: () => { exec('removeFormat'); exec('formatBlock', '<p>') } },
]

// Markdown / HTML
const onMarkdown = () => emitHtml(markdownToHtml(markdown.value))
const onSource = () => emitHtml(source.value)

// IA
const aiOpen = ref(false)
const aiGuide = ref('')
const aiBusy = ref(false)
const aiError = ref('')
const generate = async () => {
  if (props.modelValue && plainText(props.modelValue) && !confirm('Se reemplazará la descripción actual. ¿Continuar?')) return
  aiBusy.value = true
  aiError.value = ''
  try {
    const res = await fetch('/api/events/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'description',
        eventId: props.aiContext?.eventId || null,
        guide: aiGuide.value,
        draft: props.aiContext?.draft?.() || {},
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo generar la descripción')
    lastEmitted = null
    emit('update:modelValue', data.html)
    aiOpen.value = false
  } catch (e) {
    aiError.value = e.message
  } finally {
    aiBusy.value = false
  }
}
const plainText = (html) => String(html).replace(/<[^>]+>/g, '').trim()
</script>

<template>
  <div class="rounded-lg border border-gray-300 focus-within:ring-2 focus-within:ring-black overflow-hidden bg-white">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
      <div class="flex flex-wrap items-center gap-0.5">
        <template v-if="mode === 'visual'">
          <template v-for="(b, i) in TOOLBAR" :key="i">
            <span v-if="b.sep" class="mx-1 h-5 w-px bg-gray-200"></span>
            <button v-else type="button" :title="b.title" @mousedown.prevent @click="b.run"
              class="p-1.5 rounded text-gray-600 hover:bg-gray-200 hover:text-black">
              <component :is="b.icon" size="16" />
            </button>
          </template>
        </template>
        <span v-else-if="mode === 'markdown'" class="px-1 text-xs text-gray-500">**negrita**, *cursiva*, ## subtítulo, - lista, [texto](url)</span>
        <span v-else class="px-1 text-xs text-gray-500">Etiquetas permitidas: p, br, strong, em, u, h2, h3, ul, ol, li, a, blockquote</span>
      </div>
      <div class="flex items-center gap-2">
        <button v-if="aiContext" type="button" @click="aiOpen = !aiOpen"
          class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
          :class="aiOpen ? 'bg-black text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'">
          <Sparkles size="13" /> Generar con IA
        </button>
        <div class="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-xs" role="tablist">
          <button v-for="m in MODES" :key="m.key" type="button" role="tab" :aria-selected="mode === m.key" @click="setMode(m.key)"
            class="rounded px-2 py-0.5 font-medium" :class="mode === m.key ? 'bg-black text-white' : 'text-gray-500 hover:text-black'">
            {{ m.label }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="aiOpen" class="border-b border-purple-100 bg-purple-50/50 p-3 space-y-2">
      <div class="flex flex-col sm:flex-row gap-2">
        <input v-model="aiGuide" type="text" maxlength="1000" @keydown.enter.prevent="generate"
          placeholder="Guía opcional: tono, qué destacar, artistas, público... (ej: tono cercano, destacar que es apto para niños)"
          class="flex-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm outline-none focus:ring-2 focus:ring-black" />
        <button type="button" :disabled="aiBusy" @click="generate"
          class="flex items-center justify-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-60">
          <span v-if="aiBusy" class="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"></span>
          {{ aiBusy ? 'Generando...' : 'Generar' }}
        </button>
      </div>
      <p class="text-xs text-gray-500">Usa el nombre, la categoría, las fechas, el lugar y las entradas del evento. Revisa el resultado antes de guardar.</p>
      <p v-if="aiError" class="text-xs text-red-600">{{ aiError }}</p>
    </div>

    <div v-show="mode === 'visual'" class="relative">
      <div ref="editor" contenteditable="true" class="rich-text min-h-[180px] max-h-[480px] overflow-y-auto px-4 py-3 outline-none text-gray-800"
        :data-placeholder="placeholder" @input="onInput" @paste="onPaste"></div>
    </div>
    <textarea v-if="mode === 'markdown'" v-model="markdown" rows="10" @input="onMarkdown"
      placeholder="Escribe en Markdown..." class="block w-full px-4 py-3 font-mono text-sm outline-none resize-y"></textarea>
    <textarea v-if="mode === 'html'" v-model="source" rows="10" @input="onSource"
      placeholder="<p>Escribe en HTML...</p>" class="block w-full px-4 py-3 font-mono text-sm outline-none resize-y"></textarea>
  </div>
</template>

<style>
.rich-text:empty::before { content: attr(data-placeholder); color: #9ca3af; pointer-events: none; }
.rich-text p { margin: 0 0 0.75em; }
.rich-text h2 { font-size: 1.25rem; font-weight: 700; margin: 1em 0 0.5em; }
.rich-text h3 { font-size: 1.1rem; font-weight: 700; margin: 1em 0 0.5em; }
.rich-text ul { list-style: disc; padding-left: 1.5rem; margin: 0 0 0.75em; }
.rich-text ol { list-style: decimal; padding-left: 1.5rem; margin: 0 0 0.75em; }
.rich-text blockquote { border-left: 3px solid #d1d5db; padding-left: 0.75rem; color: #4b5563; margin: 0 0 0.75em; }
.rich-text a { color: #2563eb; text-decoration: underline; }
.rich-text > :last-child { margin-bottom: 0; }
</style>

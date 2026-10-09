<script setup>
import { ref, computed, onMounted } from 'vue'
import { Copy, Check, ExternalLink, CheckCircle2, PartyPopper } from 'lucide-vue-next'
import AiBrandIcon from '../ai/AiBrandIcon.vue'

// Paso a paso para conectar AI Tickets a Claude y ChatGPT (OAuth, sin llave). Lo usa ApiKeysManager.
// `connections`: apps conectadas por OAuth (de /api/api-keys) para marcar "Conectado".

const props = defineProps({
  mcpUrl: { type: String, required: true },
  connections: { type: Array, default: () => [] },
})

const welcome = ref(false)
const copied = ref('')

onMounted(() => {
  try {
    welcome.value = new URLSearchParams(window.location.search).get('bienvenida') === '1'
  } catch { /* sin URL */ }
})

const isConnected = (patterns) =>
  props.connections.some((c) => patterns.some((p) => String(c.name || '').toLowerCase().includes(p)))

const guides = computed(() => [
  {
    id: 'claude',
    name: 'Claude',
    subtitle: 'claude.ai, app de escritorio y móvil',
    openUrl: 'https://claude.ai/settings/connectors',
    openLabel: 'Abrir Claude',
    connected: isConnected(['claude', 'anthropic']),
    header: 'bg-[#F5F0E8]',
    iconWrap: 'bg-white',
    steps: [
      { title: 'Abre los conectores de Claude', text: 'En claude.ai entra a Ajustes (Settings) → Conectores (Connectors). Usa el botón "Abrir Claude" de abajo.' },
      { title: 'Agrega un conector personalizado', text: 'Haz clic en "Agregar conector personalizado" (Add custom connector).' },
      { title: 'Pega la URL del conector', text: 'Nombre: AI Tickets. URL del servidor remoto MCP:', copy: true },
      { title: 'Conecta y autoriza', text: 'Presiona "Agregar" y luego "Conectar". Se abrirá AI Tickets: inicia sesión, elige los permisos y presiona "Autorizar".' },
      { title: 'Úsalo en un chat', text: 'En un chat nuevo, abre el menú de herramientas (ícono de ajustes junto al cuadro de texto), activa AI Tickets y pregunta: "¿Cómo van mis eventos?"' },
    ],
    note: 'Disponible en los planes Free, Pro y Max. En planes Team o Enterprise, un administrador de tu organización debe agregar el conector primero.',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    subtitle: 'chatgpt.com y app de escritorio',
    openUrl: 'https://chatgpt.com/#settings/Connectors',
    openLabel: 'Abrir ChatGPT',
    connected: isConnected(['chatgpt', 'openai']),
    header: 'bg-gray-900 text-white',
    iconWrap: 'bg-white text-black',
    steps: [
      { title: 'Activa el modo desarrollador', text: 'En chatgpt.com ve a Ajustes → Apps y conectores (Apps & Connectors) → Configuración avanzada y activa "Modo desarrollador" (Developer mode).' },
      { title: 'Crea un conector', text: 'Vuelve a Apps y conectores y presiona "Crear" (Create).' },
      { title: 'Completa los datos', text: 'Nombre: AI Tickets. Descripción: "Gestiona mis eventos y ventas en AI Tickets". Autenticación: OAuth. Marca "Confío en esta aplicación". URL del servidor MCP:', copy: true },
      { title: 'Crea y autoriza', text: 'Presiona "Crear". ChatGPT abrirá AI Tickets: inicia sesión, elige los permisos y presiona "Autorizar".' },
      { title: 'Úsalo en un chat', text: 'En un chat nuevo presiona "+" → Más → Modo desarrollador, selecciona AI Tickets y pregunta: "¿Cómo van mis eventos?"' },
    ],
    note: 'Requiere un plan de pago de ChatGPT que permita el modo desarrollador (por ejemplo Plus, Pro o Business). En cuentas de empresa puede tener que habilitarlo un administrador.',
  },
])

const examplePrompts = [
  '¿Cómo van las ventas de mi próximo evento? Dame 3 acciones para vender más.',
  'Crea un evento "Fiesta de Primavera" el sábado 15 de noviembre a las 22:00 en mi lugar de siempre, con entradas General a $8.000 y VIP a $15.000.',
  'Crea un código PREVENTA20 de 20% de descuento válido hasta el viernes.',
  'Genera una portada para mi evento usando esta imagen de referencia: https://…',
  'Arma una campaña de 3 posts para Instagram y déjalos en borrador.',
  'Muéstrame la vista previa de mi evento en borrador.',
]

const copy = async (text, tag) => {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = tag
    setTimeout(() => { if (copied.value === tag) copied.value = '' }, 2000)
  } catch { /* sin permiso de portapapeles */ }
}
</script>

<template>
  <div class="space-y-6">
    <div v-if="welcome" class="flex items-start gap-3 p-4 rounded-xl bg-lime-50 border border-lime-200" role="status">
      <PartyPopper :size="22" class="text-lime-700 shrink-0 mt-0.5" />
      <div>
        <p class="font-bold text-gray-900">¡Tu cuenta está lista! Último paso: conecta tu IA</p>
        <p class="text-sm text-gray-700">Elige Claude o ChatGPT y sigue los pasos. Toma unos 2 minutos y no necesitas copiar ninguna llave.</p>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <section v-for="g in guides" :key="g.id" class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col" :data-testid="`ai-guide-${g.id}`">
        <div class="p-5 flex items-center gap-4" :class="g.header">
          <span class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm" :class="g.iconWrap">
            <AiBrandIcon :brand="g.id" :colored="g.id === 'claude'" class="w-7 h-7" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="font-bold text-lg leading-tight">Conecta {{ g.name }}</h2>
            <p class="text-sm opacity-70">{{ g.subtitle }}</p>
          </div>
          <span v-if="g.connected" class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 text-green-800 text-xs font-semibold">
            <CheckCircle2 :size="14" /> Conectado
          </span>
        </div>

        <ol class="p-5 space-y-4 flex-1">
          <li v-for="(s, i) in g.steps" :key="s.title" class="flex gap-3">
            <span class="shrink-0 w-7 h-7 rounded-full bg-black text-white text-sm font-bold flex items-center justify-center">{{ i + 1 }}</span>
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-gray-900 text-sm">{{ s.title }}</p>
              <p class="text-sm text-gray-600 mt-0.5">{{ s.text }}</p>
              <div v-if="s.copy" class="mt-2 flex items-stretch gap-2">
                <code class="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-900 text-gray-100 text-xs font-mono break-all">{{ mcpUrl }}</code>
                <button type="button" @click="copy(mcpUrl, g.id)"
                  class="shrink-0 px-3 rounded-lg bg-black text-white text-xs font-medium hover:bg-gray-800 flex items-center gap-1">
                  <component :is="copied === g.id ? Check : Copy" :size="14" /> {{ copied === g.id ? 'Copiada' : 'Copiar' }}
                </button>
              </div>
            </div>
          </li>
        </ol>

        <div class="px-5 pb-5 space-y-3">
          <a :href="g.openUrl" target="_blank" rel="noopener"
            class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-black text-white font-medium hover:bg-gray-800 transition">
            {{ g.openLabel }} <ExternalLink :size="16" />
          </a>
          <p class="text-xs text-gray-500">{{ g.note }}</p>
        </div>
      </section>
    </div>

    <section class="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <h2 class="font-bold text-gray-900">Prueba pidiéndole…</h2>
      <p class="text-sm text-gray-500 mb-3">Copia un ejemplo y pégalo en el chat después de conectar.</p>
      <ul class="grid grid-cols-1 md:grid-cols-2 gap-2">
        <li v-for="(p, i) in examplePrompts" :key="i">
          <button type="button" @click="copy(p, `p${i}`)"
            class="w-full h-full text-left flex items-start gap-2 p-3 rounded-lg border border-gray-200 hover:border-gray-400 transition text-sm text-gray-700">
            <component :is="copied === `p${i}` ? Check : Copy" :size="14" class="shrink-0 mt-0.5 text-gray-400" />
            <span class="min-w-0 break-words">{{ p }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

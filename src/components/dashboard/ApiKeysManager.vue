<script setup>
import { ref, computed, onMounted } from 'vue'
import { KeyRound, Copy, Check } from 'lucide-vue-next'

// Llaves de API para conectar el LLM del productor (MCP) o integraciones (REST). Datos vía /api/api-keys.
// La llave en claro solo se muestra una vez, justo después de crearla.

const props = defineProps({
  origin: { type: String, required: true },
})

const SCOPES = [
  { id: 'read', label: 'Ver', help: 'Eventos, entradas, descuentos y estadísticas', locked: true },
  { id: 'write', label: 'Crear y editar', help: 'Eventos (en borrador), entradas, descuentos, imágenes y posts' },
  { id: 'publish', label: 'Publicar', help: 'Publicar/pausar eventos y publicar en redes sociales' },
  { id: 'attendees', label: 'Compradores', help: 'Nombre, email y teléfono de quienes compraron' },
]

const keys = ref([])
const connections = ref([])
const loading = ref(true)
const unavailable = ref(false)
const listError = ref('')

const form = ref({ name: '', scopes: ['read', 'write'], expiresInDays: '' })
const saving = ref(false)
const message = ref('')
const isError = ref(false)
const newKey = ref('')
const copied = ref('')
const busyId = ref(null)
const client = ref('claude-ai')

const mcpUrl = computed(() => `${props.origin}/api/mcp`)
const keyForSnippet = computed(() => newKey.value || 'aitk_TU_LLAVE')

const snippets = computed(() => {
  const k = keyForSnippet.value
  const url = mcpUrl.value
  return {
    'claude-ai': {
      label: 'Claude (web y app)',
      oauth: true,
      hint: 'En claude.ai: Ajustes → Conectores → Agregar conector personalizado. Nombre: AI Tickets. URL:',
      code: url,
      after: 'Al conectar te pedirá iniciar sesión en AI Tickets y elegir los permisos. No necesitas llave.',
    },
    chatgpt: {
      label: 'ChatGPT',
      oauth: true,
      hint: 'En ChatGPT: Ajustes → Apps y conectores → Avanzado → Modo desarrollador → Crear. Autenticación: OAuth. URL:',
      code: url,
      after: 'ChatGPT abrirá AI Tickets para que autorices la conexión. No necesitas llave.',
    },
    'claude-code': {
      label: 'Claude Code',
      hint: 'Ejecuta en tu terminal (o sin --header y autoriza con /mcp en Claude Code):',
      code: `claude mcp add --transport http aitickets ${url} \\\n  --header "Authorization: Bearer ${k}"`,
    },
    'claude-desktop': {
      label: 'Claude Desktop',
      hint: 'Ajustes → Desarrollador → Editar configuración (claude_desktop_config.json) y reinicia Claude:',
      code: JSON.stringify({
        mcpServers: {
          aitickets: {
            command: 'npx',
            args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${AITICKETS_AUTH}'],
            env: { AITICKETS_AUTH: `Bearer ${k}` },
          },
        },
      }, null, 2),
    },
    cursor: {
      label: 'Cursor / Windsurf',
      hint: 'Agrega en ~/.cursor/mcp.json (o en la configuración MCP de tu editor):',
      code: JSON.stringify({ mcpServers: { aitickets: { url, headers: { Authorization: `Bearer ${k}` } } } }, null, 2),
    },
    vscode: {
      label: 'VS Code (Copilot)',
      hint: 'Agrega en .vscode/mcp.json:',
      code: JSON.stringify({ servers: { aitickets: { type: 'http', url, headers: { Authorization: `Bearer ${k}` } } } }, null, 2),
    },
    rest: {
      label: 'API REST (n8n, Make, Zapier)',
      hint: `Cada herramienta es POST ${props.origin}/api/v1/<herramienta>. Catálogo completo en GET ${props.origin}/api/v1.`,
      code: `curl -X POST ${props.origin}/api/v1/get_event_performance \\\n  -H "Authorization: Bearer ${k}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"event_id": 123}'`,
    },
  }
})

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : '')
const scopeLabel = (id) => SCOPES.find((s) => s.id === id)?.label || id

const load = async () => {
  loading.value = true
  listError.value = ''
  try {
    const res = await fetch('/api/api-keys')
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudieron cargar las llaves')
    keys.value = data.keys || []
    connections.value = data.connections || []
    unavailable.value = Boolean(data.unavailable)
  } catch (e) {
    listError.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const toggleScope = (id) => {
  if (id === 'read') return
  const s = form.value.scopes
  form.value.scopes = s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
}

const create = async () => {
  message.value = ''
  isError.value = false
  if (!form.value.name.trim()) {
    isError.value = true
    message.value = 'Ponle un nombre a la llave (ej: "Claude de Sebastián").'
    return
  }
  saving.value = true
  try {
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.value.name,
        scopes: form.value.scopes,
        expiresInDays: form.value.expiresInDays === '' ? null : Number(form.value.expiresInDays),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo crear la llave')
    newKey.value = data.key
    keys.value = [data.apiKey, ...keys.value]
    form.value = { name: '', scopes: ['read', 'write'], expiresInDays: '' }
  } catch (e) {
    isError.value = true
    message.value = e.message
  } finally {
    saving.value = false
  }
}

const revoke = async (k) => {
  if (!confirm(`¿Revocar la llave "${k.name}"? Las IAs o integraciones que la usen dejarán de funcionar de inmediato.`)) return
  busyId.value = k.id
  try {
    const res = await fetch(`/api/api-keys?id=${encodeURIComponent(k.id)}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo revocar la llave')
    keys.value = keys.value.filter((x) => x.id !== k.id)
  } catch (e) {
    alert(e.message)
  } finally {
    busyId.value = null
  }
}

const disconnect = async (c) => {
  if (!confirm(`¿Desconectar "${c.name}"? Dejará de tener acceso a AI Tickets de inmediato.`)) return
  busyId.value = c.id
  try {
    const res = await fetch(`/api/api-keys?grant=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo desconectar la app')
    connections.value = connections.value.filter((x) => x.id !== c.id)
  } catch (e) {
    alert(e.message)
  } finally {
    busyId.value = null
  }
}

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
    <!-- Conectar -->
    <section class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div class="p-6 border-b border-gray-100">
        <h2 class="font-bold text-gray-900">Conecta tu asistente</h2>
        <p class="text-sm text-gray-500">
          Servidor MCP: <code class="font-mono text-gray-800">{{ mcpUrl }}</code>
        </p>
      </div>
      <div class="px-6 pt-4 flex flex-wrap gap-2">
        <button v-for="(s, id) in snippets" :key="id" type="button" @click="client = id"
          class="px-3 py-1.5 rounded-full text-sm border transition"
          :class="client === id ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-700 hover:border-gray-400'">
          {{ s.label }}<span v-if="s.oauth" class="ml-1 text-[10px] uppercase tracking-wide opacity-70">sin llave</span>
        </button>
      </div>
      <div class="p-6 space-y-2">
        <p class="text-sm text-gray-600">{{ snippets[client].hint }}</p>
        <div class="relative">
          <pre class="p-4 pr-24 rounded-lg bg-gray-900 text-gray-100 text-xs overflow-x-auto"><code>{{ snippets[client].code }}</code></pre>
          <button type="button" @click="copy(snippets[client].code, client)"
            class="absolute top-2 right-2 px-2 py-1 rounded bg-white/10 text-white text-xs hover:bg-white/20 flex items-center gap-1">
            <component :is="copied === client ? Check : Copy" :size="12" /> {{ copied === client ? 'Copiado' : 'Copiar' }}
          </button>
        </div>
        <p v-if="snippets[client].after" class="text-sm text-gray-600">{{ snippets[client].after }}</p>
        <p v-else-if="!newKey" class="text-sm text-amber-700">Este cliente usa una llave de API: créala más abajo y la configuración se completará sola.</p>
        <p class="text-xs text-gray-400 pt-2">
          Prueba pidiéndole: "¿Cómo van las ventas de mi próximo evento?", "Crea un código PREVENTA20 de 20% hasta el viernes"
          o "Arma una campaña de 3 posts para Instagram".
        </p>
      </div>
    </section>

    <!-- Apps conectadas (OAuth) -->
    <section class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div class="p-6 border-b border-gray-100">
        <h2 class="font-bold text-gray-900">Apps conectadas</h2>
        <p class="text-sm text-gray-500">Asistentes que autorizaste iniciando sesión (Claude, ChatGPT…).</p>
      </div>
      <div v-if="loading" class="p-6 text-sm text-gray-500">Cargando...</div>
      <div v-else-if="!connections.length" class="p-6 text-sm text-gray-500">Aún no conectas ninguna app.</div>
      <ul v-else class="divide-y divide-gray-50">
        <li v-for="c in connections" :key="c.id" class="p-4 px-6 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
          <div>
            <p class="font-medium text-gray-900">{{ c.name }} <span v-if="!c.mine && c.owner" class="text-xs text-gray-400 font-normal">de {{ c.owner }}</span></p>
            <p class="text-xs text-gray-500">
              Conectada {{ fmtDate(c.createdAt) }} · Último uso {{ c.lastUsedAt ? fmtDate(c.lastUsedAt) : 'nunca' }}
            </p>
            <div class="mt-1">
              <span v-for="s in c.scopes" :key="s" class="inline-block mr-1 px-2 py-0.5 rounded bg-gray-100 text-xs">{{ scopeLabel(s) }}</span>
            </div>
          </div>
          <button type="button" :disabled="busyId === c.id" @click="disconnect(c)"
            class="text-sm font-medium text-red-600 hover:underline disabled:opacity-50 self-start sm:self-auto">Desconectar</button>
        </li>
      </ul>
    </section>

    <!-- Llaves de API -->
    <section class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div class="p-6 border-b border-gray-100 flex items-center gap-3">
        <KeyRound :size="20" class="text-gray-700" />
        <div>
          <h2 class="font-bold text-gray-900">Llaves de API</h2>
          <p class="text-sm text-gray-500">Para Claude Code, Claude Desktop, Cursor, VS Code o automatizaciones (n8n, Make, Zapier). La llave actúa como tú, solo en tu organización y con los permisos que elijas.</p>
        </div>
      </div>

      <div v-if="unavailable" class="p-6 text-sm text-amber-700 bg-amber-50">
        Las llaves de API estarán disponibles en unos minutos.
      </div>

      <div v-else-if="newKey" class="p-6 space-y-3 bg-green-50 border-b border-green-100">
        <p class="text-sm font-semibold text-green-800">Tu llave está lista. Cópiala ahora: no la volveremos a mostrar.</p>
        <div class="flex flex-col sm:flex-row gap-2">
          <code class="flex-1 px-3 py-2 rounded-lg bg-white border border-green-200 font-mono text-sm break-all">{{ newKey }}</code>
          <button type="button" @click="copy(newKey, 'key')"
            class="px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-900 transition flex items-center justify-center gap-2">
            <component :is="copied === 'key' ? Check : Copy" :size="16" /> {{ copied === 'key' ? 'Copiada' : 'Copiar' }}
          </button>
        </div>
        <p class="text-xs text-green-700">Trátala como una contraseña. Si se filtra, revócala abajo y crea otra. Las instrucciones de conexión de arriba ya la incluyen.</p>
        <button type="button" class="text-sm underline text-green-800" @click="newKey = ''">Crear otra llave</button>
      </div>

      <form v-else @submit.prevent="create" class="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-gray-100">
        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre</label>
          <input v-model="form.name" type="text" maxlength="80" placeholder="Ej: Cursor de Sebastián" autocomplete="off"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Vence</label>
          <select v-model="form.expiresInDays" class="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black">
            <option value="">Nunca (revócala cuando quieras)</option>
            <option value="30">En 30 días</option>
            <option value="90">En 90 días</option>
            <option value="365">En 1 año</option>
          </select>
        </div>
        <div class="md:col-span-2">
          <span class="block text-xs font-bold text-gray-500 uppercase mb-2">Permisos</span>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label v-for="s in SCOPES" :key="s.id"
              class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition"
              :class="form.scopes.includes(s.id) ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-300'">
              <input type="checkbox" class="mt-1" :checked="form.scopes.includes(s.id)" :disabled="s.locked" @change="toggleScope(s.id)" />
              <span>
                <span class="block text-sm font-semibold text-gray-900">{{ s.label }}</span>
                <span class="block text-xs text-gray-500">{{ s.help }}</span>
              </span>
            </label>
          </div>
        </div>
        <div class="md:col-span-2 flex flex-col sm:flex-row sm:items-center gap-3">
          <button type="submit" :disabled="saving"
            class="px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-900 transition disabled:opacity-60">
            {{ saving ? 'Creando...' : 'Crear llave' }}
          </button>
          <p v-if="message" class="text-sm" :class="isError ? 'text-red-600' : 'text-green-700'" role="status">{{ message }}</p>
        </div>
      </form>

      <div v-if="loading" class="p-6 text-sm text-gray-500">Cargando llaves...</div>
      <div v-else-if="listError" class="p-6 text-sm text-red-600">{{ listError }}</div>
      <div v-else-if="!keys.length" class="p-6 text-sm text-gray-500">Aún no tienes llaves.</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm text-gray-600">
          <thead class="bg-gray-50 text-gray-900 font-semibold border-b border-gray-100">
            <tr>
              <th class="px-4 py-3">Nombre</th>
              <th class="px-4 py-3">Llave</th>
              <th class="px-4 py-3">Permisos</th>
              <th class="px-4 py-3">Último uso</th>
              <th class="px-4 py-3">Vence</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="k in keys" :key="k.id" class="border-b border-gray-50 hover:bg-gray-50">
              <td class="px-4 py-3 text-gray-900 font-medium">
                {{ k.name }}
                <span v-if="!k.mine && k.owner" class="block text-xs text-gray-400">de {{ k.owner }}</span>
              </td>
              <td class="px-4 py-3 font-mono text-xs whitespace-nowrap">{{ k.prefix }}…</td>
              <td class="px-4 py-3">
                <span v-for="s in k.scopes" :key="s" class="inline-block mr-1 mb-1 px-2 py-0.5 rounded bg-gray-100 text-xs">{{ scopeLabel(s) }}</span>
              </td>
              <td class="px-4 py-3 text-xs whitespace-nowrap">{{ k.lastUsedAt ? fmtDate(k.lastUsedAt) : 'Nunca' }}</td>
              <td class="px-4 py-3 text-xs whitespace-nowrap">{{ k.expiresAt ? fmtDate(k.expiresAt) : 'Nunca' }}</td>
              <td class="px-4 py-3 text-right">
                <button type="button" :disabled="busyId === k.id" @click="revoke(k)"
                  class="text-sm font-medium text-red-600 hover:underline disabled:opacity-50">Revocar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

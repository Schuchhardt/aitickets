<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Link2, Copy, Check, RefreshCw, ExternalLink, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-vue-next'
import { apiRequest, copyText, notifySiteUpdated } from './siteApi.js'

const props = defineProps({
  initialJson: { type: String, required: true },
  freeUrl: { type: String, required: true },
})

const init = JSON.parse(props.initialJson)
const domain = ref(init.domain || { domain: null, status: 'none', records: [] })
const provider = ref(init.provider || 'none')
const input = ref('')
const busy = ref(false)
const checking = ref(false)
const message = ref('')
const isError = ref(false)
const pollTimedOut = ref(false)
const openGuide = ref('')

const POLL_EVERY_MS = 10_000
const POLL_MAX_MS = 10 * 60_000
let pollTimer = null
let pollStarted = 0

const STATUS_LABEL = {
  none: 'Sin dominio',
  pending_provider: 'Solicitud recibida',
  pending_dns: 'Esperando DNS',
  pending_ssl: 'Generando certificado HTTPS',
  active: 'Activo',
  failed: 'Error',
  removing: 'Desconectando…',
}
const STATUS_CLASS = {
  pending_provider: 'bg-blue-100 text-blue-800',
  pending_dns: 'bg-amber-100 text-amber-800',
  pending_ssl: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  removing: 'bg-gray-100 text-gray-700',
}

const status = computed(() => domain.value?.status || 'none')
const step = computed(() => {
  if (status.value === 'none') return 1
  if (status.value === 'active') return 3
  return 2
})
const isPending = computed(() => ['pending_dns', 'pending_ssl', 'removing'].includes(status.value))
const hasApexRecord = computed(() => (domain.value?.records || []).some((r) => r.name === '@'))
const exampleRecord = computed(() => (domain.value?.records || [])[0] || { type: 'CNAME', name: 'entradas', value: 'aitickets.netlify.app' })

function flash(text, error = false) {
  message.value = text
  isError.value = error
}

function apply(data) {
  if (data?.domain) domain.value = data.domain
  if (data?.provider) provider.value = data.provider
}

async function connect() {
  if (!input.value.trim()) return flash('Escribe tu dominio.', true)
  busy.value = true
  message.value = ''
  try {
    const data = await apiRequest('/api/sites/domain', { method: 'POST', body: { domain: input.value } })
    apply(data)
    input.value = ''
    flash(data.message || 'Dominio guardado.')
    startPolling()
    notifySiteUpdated()
  } catch (e) {
    flash(e.message, true)
  } finally {
    busy.value = false
  }
}

async function retry() {
  if (!domain.value?.domain) return
  input.value = domain.value.domain
  await connect()
}

async function refresh({ silent = false } = {}) {
  if (!silent) checking.value = true
  try {
    const before = status.value
    const data = await apiRequest('/api/sites/domain')
    apply(data)
    if (status.value !== before) {
      notifySiteUpdated()
      if (status.value === 'active') flash('¡Tu dominio ya está activo!')
    }
  } catch (e) {
    if (!silent) flash(e.message, true)
  } finally {
    checking.value = false
    if (!isPending.value) stopPolling()
  }
}

async function disconnect() {
  if (!window.confirm(`¿Desconectar ${domain.value.domain}? Tu sitio seguirá disponible en ${props.freeUrl}.`)) return
  busy.value = true
  try {
    const data = await apiRequest('/api/sites/domain', { method: 'DELETE' })
    apply(data)
    flash(data.message || 'Dominio desconectado.')
    notifySiteUpdated()
  } catch (e) {
    flash(e.message, true)
  } finally {
    busy.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimedOut.value = false
  if (!isPending.value) return
  pollStarted = Date.now()
  pollTimer = setInterval(() => {
    if (Date.now() - pollStarted > POLL_MAX_MS) {
      stopPolling()
      pollTimedOut.value = true
      return
    }
    if (!document.hidden) refresh({ silent: true })
  }, POLL_EVERY_MS)
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

const copied = ref('')
async function copy(value) {
  if (await copyText(value)) {
    copied.value = value
    setTimeout(() => { if (copied.value === value) copied.value = '' }, 2000)
  }
}

onMounted(() => {
  if (isPending.value) {
    refresh({ silent: true })
    startPolling()
  }
})
onBeforeUnmount(stopPolling)

const GUIDES = computed(() => {
  const r = exampleRecord.value
  return [
    {
      key: 'nic',
      title: 'Dominio .cl (NIC Chile)',
      steps: [
        'NIC Chile no guarda tus registros DNS: en nic.cl > "Mis dominios" revisa qué "Servidores de nombre (DNS)" usa tu dominio.',
        'Entra al panel de ese proveedor (tu hosting, Cloudflare, GoDaddy, etc.) y crea allí los registros de la tabla.',
        'Si usas los DNS de tu hosting y no encuentras dónde, pídeles que creen los registros por ti: basta con enviarles la tabla.',
      ],
    },
    {
      key: 'godaddy',
      title: 'GoDaddy',
      steps: [
        'Entra a "Mis productos", busca tu dominio y abre "DNS".',
        `Toca "Agregar registro nuevo": Tipo ${r.type}, Nombre ${r.name}, Valor ${r.value}, TTL 1 hora.`,
        'Agrega también el registro TXT de la tabla (Tipo TXT, con el mismo Nombre y Valor que ves arriba).',
        r.name === '@' ? 'Si ya existe un registro A con nombre @, edítalo en vez de crear otro.' : 'Si ya existe un registro con ese nombre, edítalo en vez de crear otro.',
      ],
    },
    {
      key: 'cloudflare',
      title: 'Cloudflare',
      steps: [
        'Abre tu dominio y entra a "DNS" > "Records" > "Add record".',
        `Tipo ${r.type}, Name ${r.name}, ${r.type === 'A' ? 'IPv4 address' : 'Target'} ${r.value}.`,
        'Agrega también el registro TXT de la tabla (Type TXT, con el Name y Content que ves arriba).',
        'Importante: deja "Proxy status" en "DNS only" (nube gris). Con la nube naranja no podemos emitir el certificado.',
      ],
    },
  ]
})
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
    <div class="p-6 border-b border-gray-100 flex items-start justify-between gap-4">
      <div>
        <h3 class="font-bold text-lg flex items-center gap-2"><Link2 size="18" /> Dominio propio</h3>
        <p class="text-sm text-gray-500 mt-1">Muestra tu sitio en tu propio dominio, por ejemplo <strong>entradas.tuproductora.cl</strong>. Gratis y con HTTPS.</p>
      </div>
      <span v-if="status !== 'none'" class="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap" :class="STATUS_CLASS[status]">
        {{ STATUS_LABEL[status] || status }}
      </span>
    </div>

    <!-- Stepper -->
    <ol class="flex items-center gap-2 px-6 pt-5 text-xs font-semibold text-gray-400">
      <li v-for="(label, i) in ['Tu dominio', 'Configura el DNS', 'Listo']" :key="label" class="flex items-center gap-2">
        <span class="h-6 w-6 rounded-full flex items-center justify-center" :class="step > i ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'">{{ i + 1 }}</span>
        <span :class="step > i ? 'text-gray-900' : ''">{{ label }}</span>
        <span v-if="i < 2" class="w-6 h-px bg-gray-200"></span>
      </li>
    </ol>

    <div class="p-6 space-y-4">
      <p v-if="message" class="text-sm" :class="isError ? 'text-red-600' : 'text-green-700'">{{ message }}</p>

      <!-- Paso 1 -->
      <form v-if="step === 1" class="space-y-3" @submit.prevent="connect">
        <div class="flex flex-col sm:flex-row gap-2">
          <input
            v-model="input"
            type="text"
            inputmode="url"
            autocomplete="off"
            placeholder="entradas.tuproductora.cl"
            class="flex-1 px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black"
            aria-label="Tu dominio"
          />
          <button type="submit" class="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40" :disabled="busy">
            {{ busy ? 'Conectando…' : 'Conectar dominio' }}
          </button>
        </div>
        <p class="text-xs text-gray-500">
          Recomendamos un subdominio como <strong>entradas.</strong> o <strong>www.</strong>: se configura con un registro (más un TXT que prueba que el dominio es tuyo) y no afecta tu correo ni tu sitio actual.
          Debes ser dueño del dominio (se compra en nic.cl u otro registrador).
        </p>
      </form>

      <!-- Paso 2 -->
      <div v-else-if="step === 2" class="space-y-4">
        <p class="text-sm text-gray-800">
          Dominio: <strong>{{ domain.domain }}</strong>
        </p>

        <div v-if="status === 'pending_provider'" class="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900">
          Recibimos tu solicitud. Nuestro equipo la activará pronto y te avisaremos por correo. Mientras tanto, ya puedes crear los registros DNS de abajo.
        </div>
        <div v-else-if="status === 'failed'" class="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900 flex gap-2">
          <AlertTriangle size="16" class="shrink-0 mt-0.5" />
          <span>{{ domain.error || 'No pudimos conectar tu dominio.' }}</span>
        </div>
        <div v-else-if="status === 'pending_ssl'" class="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          ¡Tu DNS ya apunta bien! Estamos generando el certificado de seguridad (HTTPS). Suele tardar unos minutos, a veces hasta una hora.
        </div>
        <div v-else-if="status === 'removing'" class="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-700">
          Estamos desconectando tu dominio. Terminará automáticamente en unos minutos.
        </div>
        <div v-else-if="domain.error" class="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          {{ domain.error }}
        </div>

        <div v-if="status !== 'removing'">
          <p class="text-sm font-semibold mb-2">Crea estos registros en el proveedor de DNS de tu dominio (el TXT prueba que el dominio es tuyo):</p>
          <div class="overflow-x-auto rounded-lg border border-gray-200">
            <table class="min-w-full text-sm">
              <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th class="px-3 py-2 text-left">Tipo</th>
                  <th class="px-3 py-2 text-left">Nombre</th>
                  <th class="px-3 py-2 text-left">Valor</th>
                  <th class="px-3 py-2 text-left">TTL</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in domain.records" :key="`${r.type}-${r.name}-${r.value}`" class="border-t border-gray-100">
                  <td class="px-3 py-2 font-mono">{{ r.type }}</td>
                  <td class="px-3 py-2">
                    <button type="button" class="inline-flex items-center gap-1 font-mono hover:underline" @click="copy(r.name)">
                      {{ r.name }} <component :is="copied === r.name ? Check : Copy" size="12" class="text-gray-400" />
                    </button>
                  </td>
                  <td class="px-3 py-2">
                    <button type="button" class="inline-flex items-center gap-1 font-mono hover:underline" @click="copy(r.value)">
                      {{ r.value }} <component :is="copied === r.value ? Check : Copy" size="12" class="text-gray-400" />
                    </button>
                  </td>
                  <td class="px-3 py-2 text-gray-500">3600</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-for="r in domain.records.filter((x) => x.note)" :key="`note-${r.name}`" class="text-xs text-gray-500 mt-1">{{ r.note }}</p>
          <p v-if="hasApexRecord" class="text-xs text-amber-700 mt-2">
            Conectar el dominio raíz (sin www) puede afectar tu sitio actual. Si tienes dudas, usa <strong>www.{{ domain.domain }}</strong> o <strong>entradas.{{ domain.domain }}</strong>.
          </p>
        </div>

        <!-- Guías -->
        <div v-if="status !== 'removing'" class="space-y-2">
          <p class="text-sm font-semibold">Guías rápidas</p>
          <div v-for="g in GUIDES" :key="g.key" class="rounded-lg border border-gray-200">
            <button type="button" class="w-full flex items-center justify-between px-4 py-2 text-sm text-left" @click="openGuide = openGuide === g.key ? '' : g.key">
              <span>{{ g.title }}</span>
              <span class="text-gray-400">{{ openGuide === g.key ? '−' : '+' }}</span>
            </button>
            <ol v-if="openGuide === g.key" class="list-decimal pl-9 pr-4 pb-3 space-y-1 text-sm text-gray-700">
              <li v-for="(s, i) in g.steps" :key="i">{{ s }}</li>
            </ol>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            v-if="status !== 'failed' && status !== 'pending_provider'"
            type="button"
            class="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
            :disabled="checking || busy"
            @click="refresh()"
          >
            <component :is="checking ? Loader2 : RefreshCw" size="16" :class="{ 'animate-spin': checking }" /> Verificar ahora
          </button>
          <button v-if="status === 'failed'" type="button" class="px-4 py-2 text-sm bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40" :disabled="busy" @click="retry">
            Reintentar
          </button>
          <button v-if="status !== 'removing'" type="button" class="px-4 py-2 text-sm text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40" :disabled="busy" @click="disconnect">
            {{ status === 'failed' ? 'Usar otro dominio' : 'Cancelar' }}
          </button>
        </div>
        <p v-if="isPending && !pollTimedOut" class="text-xs text-gray-500">Revisamos automáticamente cada 10 segundos. Los cambios de DNS pueden tardar desde minutos hasta algunas horas.</p>
        <p v-if="pollTimedOut" class="text-xs text-gray-600">Seguimos revisando por ti: te avisaremos por correo cuando tu dominio esté listo. Puedes cerrar esta página.</p>
      </div>

      <!-- Paso 3 -->
      <div v-else class="space-y-3">
        <div class="flex items-center gap-2 text-green-800">
          <CheckCircle2 size="20" />
          <p class="text-sm">Tu sitio está activo en <a :href="domain.url" target="_blank" rel="noopener" class="font-semibold underline">{{ domain.url }}</a></p>
          <a :href="domain.url" target="_blank" rel="noopener" class="text-gray-500 hover:text-black"><ExternalLink size="14" /></a>
        </div>
        <div v-if="domain.dnsLostAt" class="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex gap-2">
          <AlertTriangle size="16" class="shrink-0 mt-0.5" />
          <span>{{ domain.error || 'Tu registro DNS dejó de apuntar a AI Tickets.' }} Si no se corrige en 72 horas, desconectaremos el dominio.</span>
        </div>
        <p class="text-xs text-gray-500">No borres el registro DNS: si deja de apuntar a AI Tickets por más de 72 horas, desconectaremos el dominio.</p>
        <button type="button" class="px-4 py-2 text-sm text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40" :disabled="busy" @click="disconnect">
          Desconectar dominio
        </button>
      </div>
    </div>
  </section>
</template>

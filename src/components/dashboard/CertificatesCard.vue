<script setup>
import { ref, computed, onMounted } from 'vue'
import { Award, Download, Send, Copy, Check } from 'lucide-vue-next'

// Certificados de asistencia (/api/events/certificates → get_attendance_certificates / send_attendance_certificates,
// src/lib/certificates.ts): un PDF por cada persona que ingresó, con su nombre, el evento, las fechas y las horas.
// Se descargan todos en un PDF (uno por página) o se envían por correo después del evento: cada persona recibe el link
// a su certificado. Enviar pide confirmación (dos pasos, como en el asistente de IA).

const props = defineProps({
  eventId: { type: Number, required: true },
})

const data = ref(null)
const loading = ref(true)
const error = ref('')
const minSessions = ref(1)
const hours = ref('')
const note = ref('')
const sending = ref(false)
const sendResult = ref('')
const copiedId = ref(null)

const options = () => {
  const o = {}
  if (minSessions.value > 1) o.min_sessions = Number(minSessions.value)
  const h = Number(String(hours.value).replace(',', '.'))
  if (Number.isFinite(h) && h > 0) o.hours = h
  return o
}
const query = (extra = {}) => new URLSearchParams({ event_id: String(props.eventId), ...Object.fromEntries(Object.entries({ ...options(), ...extra }).map(([k, v]) => [k, String(v)])) })

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/events/certificates?${query()}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error?.message || 'No se pudieron cargar los certificados')
    data.value = body.data
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const summary = computed(() => data.value?.summary || null)
const multi = computed(() => (data.value?.functions_total || 0) > 1)
const pdfUrl = computed(() => `/api/events/certificates?${query({ format: 'pdf' })}`)
const lastSend = computed(() => data.value?.sends?.[0] || null)
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : '')

const send = async () => {
  sendResult.value = ''
  error.value = ''
  sending.value = true
  const body = { action: 'send', event_id: props.eventId, ...options(), ...(note.value.trim() ? { note: note.value.trim() } : {}) }
  const post = async (extra = {}) => {
    const res = await fetch('/api/events/certificates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...extra }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error?.message || 'No se pudieron enviar')
    return json.data
  }
  try {
    const first = await post()
    if (first?.status === 'confirmation_required') {
      const lines = [first.summary || '¿Enviar los certificados?', ...(first.warnings || []).map((w) => `⚠️ ${w}`), '¿Enviar ahora?'].join('\n\n')
      if (!window.confirm(lines)) return
      const done = await post({ confirmation_token: first.confirmation_token })
      sendResult.value = `Enviados a ${done.sent} persona${done.sent === 1 ? '' : 's'}.${done.failed ? ` ${done.failed} no se pudieron enviar: inténtalo de nuevo.` : ''}${done.remaining ? ` Faltan ${done.remaining}: vuelve a enviar.` : ''}`
      await load()
    }
  } catch (e) {
    error.value = e.message
  } finally {
    sending.value = false
  }
}

const copy = async (c) => {
  try {
    await navigator.clipboard.writeText(c.certificate_url)
    copiedId.value = c.ticket_id
    setTimeout(() => { copiedId.value = null }, 2000)
  } catch { /* sin permiso de portapapeles */ }
}
</script>

<template>
  <div class="bg-white p-4 sm:p-6 rounded-xl border border-gray-200 shadow-sm" data-testid="certificates-card">
    <h3 class="font-bold text-lg mb-1 flex items-center gap-2"><Award :size="18" /> Certificados de asistencia</h3>
    <p class="text-sm text-gray-500 mb-4">
      Solo para quienes ingresaron (check-in en la puerta). Cada certificado lleva el nombre del titular de la entrada, el
      evento, las fechas y las horas.
    </p>

    <div class="flex flex-wrap items-end gap-3 mb-4">
      <label v-if="multi" class="block">
        <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Pases: mínimo de días con ingreso</span>
        <input v-model.number="minSessions" type="number" min="1" :max="data?.functions_total || 1" @change="load"
          class="w-24 bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
      </label>
      <label class="block">
        <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Horas (opcional)</span>
        <input v-model="hours" type="text" inputmode="decimal" placeholder="Las de las funciones" @change="load"
          class="w-44 bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
      </label>
    </div>

    <p v-if="loading" class="text-sm text-gray-500">Cargando…</p>
    <template v-else-if="summary">
      <p class="text-sm text-gray-700" data-testid="certificates-summary">
        <strong>{{ summary.eligible }}</strong> {{ summary.eligible === 1 ? 'certificado' : 'certificados' }} de {{ summary.checked_in }}
        {{ summary.checked_in === 1 ? 'persona que ingresó' : 'personas que ingresaron' }}.
        <span v-if="summary.below_min_sessions" class="text-gray-500">{{ summary.below_min_sessions }} con menos días que el mínimo.</span>
        <span v-if="summary.missing_name" class="text-gray-500">{{ summary.missing_name }} sin nombre.</span>
      </p>
      <p v-if="lastSend" class="text-xs text-gray-500 mt-1">Último envío: {{ fmtDate(lastSend.sent_at) }}, a {{ lastSend.recipients }} {{ lastSend.recipients === 1 ? 'persona' : 'personas' }}.</p>

      <div class="mt-4 flex flex-wrap gap-2">
        <a v-if="summary.eligible" :href="pdfUrl" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50" data-testid="certificates-download">
          <Download :size="16" /> Descargar todos (PDF)
        </a>
      </div>

      <div v-if="summary.eligible" class="mt-4 border-t border-gray-100 pt-4 space-y-2">
        <template v-if="data.event_ended">
          <label class="block">
            <span class="block text-xs font-bold text-gray-500 uppercase mb-1">Mensaje en el correo (opcional)</span>
            <input v-model="note" type="text" maxlength="500" placeholder="Ej: Gracias por participar. Nos vemos en la próxima edición."
              class="w-full bg-gray-50 border border-gray-200 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-black" />
          </label>
          <button type="button" @click="send" :disabled="sending" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 disabled:opacity-60" data-testid="certificates-send">
            <Send :size="16" /> {{ sending ? 'Enviando…' : summary.already_sent ? 'Enviar a quienes faltan' : 'Enviar por correo' }}
          </button>
          <p class="text-xs text-gray-500">A cada persona le llega el link para descargar su certificado. Te pedimos confirmar antes de enviar.</p>
        </template>
        <p v-else class="text-xs text-gray-500">El envío por correo se activa cuando termina el evento. Mientras, puedes descargarlos.</p>
        <p v-if="sendResult" class="text-sm text-green-700" role="status">{{ sendResult }}</p>
      </div>

      <ul v-if="data.certificates?.length" class="mt-4 divide-y divide-gray-100 text-sm">
        <li v-for="c in data.certificates.slice(0, 30)" :key="c.ticket_id" class="py-2 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <span class="text-gray-900 break-words">{{ c.name }}</span>
            <span class="block text-xs text-gray-500">
              {{ c.ticket_type }}<template v-if="c.sessions_total"> · fue {{ c.sessions_attended }} de {{ c.sessions_total }} días</template><template v-if="c.hours"> · {{ String(c.hours).replace('.', ',') }} h</template><template v-if="c.emailed"> · enviado</template>
            </span>
          </div>
          <button v-if="c.certificate_url" type="button" @click="copy(c)" class="text-xs text-gray-700 hover:underline shrink-0 flex items-center gap-1">
            <component :is="copiedId === c.ticket_id ? Check : Copy" :size="14" /> {{ copiedId === c.ticket_id ? 'Copiado' : 'Copiar link' }}
          </button>
        </li>
      </ul>
      <p v-if="(data.certificates?.length || 0) > 30" class="text-xs text-gray-500 mt-2">Y {{ data.certificates.length - 30 }} más en el PDF.</p>
    </template>
    <p v-if="error" class="mt-2 text-sm text-red-600" role="alert">{{ error }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { MessageCircle, Eye, EyeOff, Mail, Check } from 'lucide-vue-next'

// Mensajes de asistentes (escritos desde la página de su orden) y muro de asistentes (reacciones con emoji y
// mensajes cortos que ven los demás asistentes) de un evento. API: /api/events/community.

const props = defineProps({
  eventId: { type: Number, required: true },
  eventName: { type: String, default: '' },
})

const loading = ref(true)
const loadError = ref('')
const data = ref(null)
const busyId = ref('')
const tab = ref('messages')

const post = async (body) => {
  const res = await fetch('/api/events/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: props.eventId, ...body }) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.message || 'No se pudo completar la acción')
  return json
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`/api/events/community?eventId=${props.eventId}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.message || 'No se pudieron cargar los mensajes')
    data.value = json
    if (!json.messages.length && json.posts.length) tab.value = 'feed'
  } catch (e) {
    loadError.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const messages = computed(() => data.value?.messages || [])
const posts = computed(() => data.value?.posts || [])
const unread = computed(() => messages.value.filter((m) => !m.read_at).length)
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short' }) : '')
const replyHref = (m) => `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${props.eventName || 'tu mensaje'}`)}&body=${encodeURIComponent(`\n\n---\n${m.message}`)}`

const toggleRead = async (m) => {
  busyId.value = m.id
  try {
    const read = !m.read_at
    await post({ action: 'message_read', id: m.id, read })
    m.read_at = read ? new Date().toISOString() : null
  } catch (e) {
    alert(e.message)
  } finally {
    busyId.value = ''
  }
}

const reply = async (m) => {
  if (!m.read_at) await toggleRead(m)
}

const togglePost = async (p) => {
  busyId.value = p.id
  try {
    const status = p.status === 'hidden' ? 'visible' : 'hidden'
    await post({ action: 'post_status', id: p.id, status })
    p.status = status
  } catch (e) {
    alert(e.message)
  } finally {
    busyId.value = ''
  }
}
</script>

<template>
  <section id="mensajes" class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden scroll-mt-24" data-testid="event-community-manager">
    <div class="p-4 md:p-6 border-b border-gray-100">
      <h3 class="font-bold text-lg flex items-center gap-2">
        <MessageCircle size="18" /> Mensajes y muro de asistentes
        <span v-if="unread" class="ml-1 rounded-full bg-lime-400 px-2 py-0.5 text-xs font-bold text-black">{{ unread }} sin leer</span>
      </h3>
      <p class="text-sm text-gray-500 mt-1">
        Quienes tienen entrada pueden escribirte desde la página de su entrada (te llega por correo y queda aquí) y
        reaccionar al evento con un emoji y un mensaje corto que ven los demás asistentes.
      </p>
    </div>

    <div v-if="loading" class="p-6 text-sm text-gray-500">Cargando…</div>
    <div v-else-if="loadError" class="p-4 md:p-6 text-sm text-amber-700 bg-amber-50">{{ loadError }}</div>

    <template v-else-if="data">
      <div class="px-4 md:px-6 pt-4 flex gap-2" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'messages'" class="px-3 py-1 rounded-full text-xs font-semibold border"
          :class="tab === 'messages' ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-gray-400'" @click="tab = 'messages'">
          Mensajes ({{ messages.length }})
        </button>
        <button type="button" role="tab" :aria-selected="tab === 'feed'" class="px-3 py-1 rounded-full text-xs font-semibold border"
          :class="tab === 'feed' ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-gray-400'" @click="tab = 'feed'">
          Muro ({{ posts.length }})
        </button>
      </div>

      <!-- Mensajes -->
      <div v-if="tab === 'messages'" class="p-4 md:p-6">
        <p v-if="!messages.length" class="text-sm text-gray-500">Todavía no te han escrito.</p>
        <ul v-else class="space-y-3" data-track-mask>
          <li v-for="m in messages" :key="m.id" class="rounded-lg border p-4" :class="m.read_at ? 'border-gray-200' : 'border-lime-400 bg-lime-50/40'">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <p class="text-sm"><strong>{{ m.name || 'Asistente' }}</strong> <span class="text-gray-500 break-all">· {{ m.email }}</span></p>
              <p class="text-xs text-gray-400">{{ fmtDate(m.created_at) }}</p>
            </div>
            <p class="mt-2 text-sm text-gray-800 whitespace-pre-line break-words">{{ m.message }}</p>
            <p v-if="!m.delivered" class="mt-2 text-xs text-amber-700">No se pudo enviar el aviso por correo: respóndele desde aquí.</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <a :href="replyHref(m)" class="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800" @click="reply(m)"><Mail size="13" /> Responder por correo</a>
              <button type="button" :disabled="busyId === m.id" class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400 disabled:opacity-50" @click="toggleRead(m)">
                <Check size="13" /> {{ m.read_at ? 'Marcar como no leído' : 'Marcar como leído' }}
              </button>
            </div>
          </li>
        </ul>
      </div>

      <!-- Muro -->
      <div v-else class="p-4 md:p-6">
        <div v-if="data.reactions.length" class="mb-4 flex flex-wrap gap-2">
          <span v-for="r in data.reactions" :key="r.emoji" class="rounded-full border border-gray-200 px-3 py-1 text-sm">{{ r.emoji }} <span class="tabular-nums text-gray-600">{{ r.count }}</span></span>
        </div>
        <p v-if="!posts.length" class="text-sm text-gray-500">Nadie ha reaccionado todavía. El muro aparece en la página de la entrada de cada asistente.</p>
        <ul v-else class="divide-y divide-gray-100" data-track-mask>
          <li v-for="p in posts" :key="p.id" class="py-3 flex items-start gap-3" :class="p.status === 'hidden' ? 'opacity-50' : ''">
            <span class="text-2xl leading-none" aria-hidden="true">{{ p.emoji }}</span>
            <div class="min-w-0 flex-1">
              <p class="text-sm"><strong>{{ p.display_name || 'Asistente' }}</strong> <span class="text-gray-400 break-all">· {{ p.email }}</span></p>
              <p v-if="p.message" class="text-sm text-gray-700 break-words">{{ p.message }}</p>
              <p class="text-xs text-gray-400">{{ fmtDate(p.updated_at || p.created_at) }}<template v-if="p.status === 'hidden'"> · Oculto</template></p>
            </div>
            <button type="button" :disabled="busyId === p.id" class="shrink-0 rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-black disabled:opacity-50" :aria-label="p.status === 'hidden' ? 'Mostrar en el muro' : 'Ocultar del muro'" :title="p.status === 'hidden' ? 'Mostrar en el muro' : 'Ocultar del muro'" @click="togglePost(p)">
              <Eye v-if="p.status === 'hidden'" size="16" />
              <EyeOff v-else size="16" />
            </button>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Tag } from 'lucide-vue-next'

// Códigos de descuento (dashboard). Con eventId: códigos del evento + los de toda la organización;
// sin eventId (página /dashboard/descuentos): todos, y al crear se elige el evento o "Todos mis eventos".

const props = defineProps({
  eventId: { type: Number, required: false },
  events: { type: Array, required: false }, // [{ id, name }] para elegir el alcance (página de la organización)
})

const codes = ref([])
const loading = ref(true)
const unavailable = ref(false)
const listError = ref('')

const emptyForm = () => ({
  code: '',
  kind: 'percent',
  value: '',
  eventId: props.eventId ?? '',
  maxUses: '',
  perBuyerLimit: '',
  startsAt: '',
  endsAt: '',
})
const form = ref(emptyForm())
const saving = ref(false)
const message = ref('')
const isError = ref(false)
const busyId = ref(null)

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' }) : '')
const toIso = (local) => (local ? new Date(local).toISOString() : null)

const statusOf = (c) => {
  const now = Date.now()
  if (!c.active) return { label: 'Inactivo', cls: 'bg-gray-100 text-gray-500' }
  if (c.endsAt && new Date(c.endsAt).getTime() <= now) return { label: 'Expirado', cls: 'bg-red-50 text-red-600' }
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { label: 'Programado', cls: 'bg-blue-50 text-blue-700' }
  if (c.maxUses != null && c.uses >= c.maxUses) return { label: 'Agotado', cls: 'bg-amber-50 text-amber-700' }
  return { label: 'Activo', cls: 'bg-green-100 text-green-700' }
}

const totals = computed(() => codes.value.reduce(
  (acc, c) => ({ orders: acc.orders + c.paidOrders, discount: acc.discount + c.discountTotal, revenue: acc.revenue + c.revenue }),
  { orders: 0, discount: 0, revenue: 0 },
))

const load = async () => {
  loading.value = true
  listError.value = ''
  try {
    const qs = props.eventId ? `?event_id=${props.eventId}` : ''
    const res = await fetch(`/api/discount-codes${qs}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudieron cargar los códigos')
    codes.value = data.codes || []
    unavailable.value = Boolean(data.unavailable)
  } catch (e) {
    listError.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const create = async () => {
  message.value = ''
  isError.value = false
  const f = form.value
  if (!f.code.trim() || f.value === '') {
    isError.value = true
    message.value = 'Completa el código y el valor del descuento.'
    return
  }
  saving.value = true
  try {
    const res = await fetch('/api/discount-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: f.code,
        kind: f.kind,
        value: Number(f.value),
        eventId: f.eventId === '' || f.eventId == null ? null : Number(f.eventId),
        maxUses: f.maxUses === '' ? null : Number(f.maxUses),
        perBuyerLimit: f.perBuyerLimit === '' ? null : Number(f.perBuyerLimit),
        startsAt: toIso(f.startsAt),
        endsAt: toIso(f.endsAt),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo crear el código')
    codes.value = [data.code, ...codes.value]
    form.value = emptyForm()
    message.value = `Código ${data.code.code} creado.`
  } catch (e) {
    isError.value = true
    message.value = e.message
  } finally {
    saving.value = false
  }
}

const toggle = async (c) => {
  if (c.active && !confirm(`¿Desactivar el código ${c.code}? Dejará de aplicarse en nuevas compras.`)) return
  busyId.value = c.id
  try {
    const res = await fetch('/api/discount-codes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, active: !c.active }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || 'No se pudo actualizar el código')
    codes.value = codes.value.map((x) => (x.id === c.id ? data.code : x))
  } catch (e) {
    alert(e.message)
  } finally {
    busyId.value = null
  }
}

const copy = async (code) => {
  try {
    await navigator.clipboard.writeText(code)
  } catch {
    prompt('Copia el código:', code)
  }
}
</script>

<template>
  <section class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" data-testid="discount-codes">
    <div class="p-6 border-b border-gray-100">
      <h3 class="font-bold text-lg flex items-center gap-2"><Tag size="18" /> Códigos de descuento</h3>
      <p class="text-sm text-gray-500 mt-1">
        El descuento se aplica al valor de las entradas; el cargo por servicio se calcula sobre el monto con descuento.
        Recibes el valor de las entradas ya descontado.
      </p>
    </div>

    <div v-if="unavailable" class="p-6 text-sm text-amber-700 bg-amber-50">
      Los códigos de descuento se están activando. Vuelve a intentarlo en unos minutos.
    </div>

    <form v-else @submit.prevent="create" class="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-gray-100">
      <div>
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Código</label>
        <input v-model="form.code" type="text" maxlength="30" placeholder="EJ: PREVENTA10" autocomplete="off"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black uppercase" />
        <p class="text-xs text-gray-400 mt-1">3 a 30 caracteres: letras, números, - o _.</p>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
          <select v-model="form.kind" class="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black">
            <option value="percent">Porcentaje</option>
            <option value="fixed">Monto fijo (CLP)</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase mb-1">{{ form.kind === 'percent' ? 'Porcentaje' : 'Monto' }}</label>
          <input v-model="form.value" type="number" :min="1" :max="form.kind === 'percent' ? 100 : undefined" :step="form.kind === 'percent' ? 0.01 : 1"
            :placeholder="form.kind === 'percent' ? '10' : '5000'"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
        </div>
      </div>
      <div v-if="!eventId">
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Aplica a</label>
        <select v-model="form.eventId" class="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white outline-none focus:ring-2 focus:ring-black">
          <option value="">Todos mis eventos</option>
          <option v-for="e in events || []" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Usos máximos</label>
          <input v-model="form.maxUses" type="number" min="1" placeholder="Sin límite"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Por comprador</label>
          <input v-model="form.perBuyerLimit" type="number" min="1" placeholder="Sin límite"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
        </div>
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Desde (opcional)</label>
        <input v-model="form.startsAt" type="datetime-local"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Hasta (opcional)</label>
        <input v-model="form.endsAt" type="datetime-local"
          class="w-full px-3 py-2 rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-black" />
      </div>
      <div class="md:col-span-2 flex flex-col sm:flex-row sm:items-center gap-3">
        <button type="submit" :disabled="saving"
          class="px-4 py-2 bg-black text-white rounded-lg font-medium hover:bg-gray-900 transition disabled:opacity-60">
          {{ saving ? 'Creando...' : 'Crear código' }}
        </button>
        <p v-if="message" class="text-sm" :class="isError ? 'text-red-600' : 'text-green-700'" role="status">{{ message }}</p>
      </div>
      <p class="md:col-span-2 text-xs text-gray-400">
        Un uso es una compra. Las compras pendientes de pago reservan su uso hasta que vencen.
      </p>
    </form>

    <div v-if="loading" class="p-6 text-sm text-gray-500">Cargando códigos...</div>
    <div v-else-if="listError" class="p-6 text-sm text-red-600">{{ listError }}</div>
    <div v-else-if="!codes.length && !unavailable" class="p-6 text-sm text-gray-500">Aún no tienes códigos de descuento.</div>
    <template v-else-if="codes.length">
      <div class="px-6 py-3 bg-gray-50 text-xs text-gray-600 flex flex-wrap gap-x-6 gap-y-1">
        <span><strong>{{ totals.orders }}</strong> compra(s) pagada(s) con código</span>
        <span>Descuento otorgado: <strong>{{ clp(totals.discount) }}</strong></span>
        <span>Ventas con código: <strong>{{ clp(totals.revenue) }}</strong></span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm text-gray-600">
          <thead class="bg-gray-50 text-gray-900 font-semibold border-b border-gray-100">
            <tr>
              <th class="px-4 py-3">Código</th>
              <th class="px-4 py-3">Descuento</th>
              <th class="px-4 py-3">Aplica a</th>
              <th class="px-4 py-3">Usos</th>
              <th class="px-4 py-3">Vigencia</th>
              <th class="px-4 py-3">Descuento otorgado</th>
              <th class="px-4 py-3">Ventas</th>
              <th class="px-4 py-3">Estado</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in codes" :key="c.id" class="border-b border-gray-50 hover:bg-gray-50">
              <td class="px-4 py-3 font-mono font-semibold text-gray-900 whitespace-nowrap">
                <button type="button" class="hover:underline" title="Copiar" @click="copy(c.code)">{{ c.code }}</button>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">{{ c.label }}</td>
              <td class="px-4 py-3">{{ c.eventId == null ? 'Todos mis eventos' : (c.eventName || 'Este evento') }}</td>
              <td class="px-4 py-3 whitespace-nowrap">
                {{ c.uses }}{{ c.maxUses != null ? ` / ${c.maxUses}` : '' }}
                <span v-if="c.perBuyerLimit != null" class="block text-xs text-gray-400">máx. {{ c.perBuyerLimit }} por comprador</span>
              </td>
              <td class="px-4 py-3 text-xs whitespace-nowrap">
                <template v-if="c.startsAt || c.endsAt">
                  <span v-if="c.startsAt" class="block">Desde {{ fmtDate(c.startsAt) }}</span>
                  <span v-if="c.endsAt" class="block">Hasta {{ fmtDate(c.endsAt) }}</span>
                </template>
                <span v-else class="text-gray-400">Sin límite</span>
              </td>
              <td class="px-4 py-3 whitespace-nowrap">{{ clp(c.discountTotal) }}</td>
              <td class="px-4 py-3 whitespace-nowrap">{{ clp(c.revenue) }}<span class="block text-xs text-gray-400">{{ c.paidOrders }} compra(s)</span></td>
              <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs font-medium whitespace-nowrap" :class="statusOf(c).cls">{{ statusOf(c).label }}</span></td>
              <td class="px-4 py-3 text-right">
                <button type="button" :disabled="busyId === c.id" @click="toggle(c)"
                  class="text-sm font-medium hover:underline disabled:opacity-50" :class="c.active ? 'text-red-600' : 'text-black'">
                  {{ c.active ? 'Desactivar' : 'Activar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

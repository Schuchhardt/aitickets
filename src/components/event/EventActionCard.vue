<script setup>
// Card de acción de la página del evento (§4.4): decide qué mostrar según el estado y renderiza el registro
// gratis inline (RsvpForm) o el resumen/stepper del evento pagado (abre el CheckoutSheet).
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import RsvpForm from "./RsvpForm.vue";
import NotifyForm from "./NotifyForm.vue";
import QuantityStepper from "./QuantityStepper.vue";
import AnimatedNumber from "./AnimatedNumber.vue";
import EventTrust from "./EventTrust.vue";
import {
  formatCLP,
  formatSaleStart,
  formatShortDate,
  formatFunctionShort,
  minFinalPrice,
  stockSummary,
  ticketMax,
  upcomingFunctions,
  placesOf,
} from "./eventView.js";
import { computeTotals, isFeeAbsorbed } from "../Reservation/pricing.js";

const props = defineProps({
  event: { type: Object, required: true },
  state: { type: String, required: true },
  externalUrl: { type: String, default: "" },
  // Órdenes de este navegador (botón "Ver mis entradas")
  ordersCount: { type: Number, default: 0 },
});
const emit = defineEmits(["checkout", "view-orders", "rsvp-state", "review"]);

const rsvp = ref(null);
defineExpose({ focusForm: () => rsvp.value?.focusForm() });

const absorbed = computed(() => isFeeAbsorbed(props.event));
const priceNote = computed(() => (absorbed.value ? "precio final por entrada" : "por entrada, incluye cargo"));
const stock = computed(() => stockSummary(props.event));
const fromPrice = computed(() => minFinalPrice(props.event));

// Pagado simple: 1 función y 1 tipo de entrada => stepper aquí y el sheet abre directo en "Pagar"
const simpleTicket = computed(() => (props.state === "paid_simple" ? props.event.tickets[0] : null));
const qty = ref(1);
const simpleMax = computed(() => (simpleTicket.value ? Math.max(1, ticketMax(simpleTicket.value)) : 1));
const simpleTotal = computed(() => {
  const t = simpleTicket.value;
  if (!t) return 0;
  return computeTotals([{ total: (Number(t.price) || 0) * qty.value, quantity: qty.value }], { feeAbsorbed: absorbed.value }).total;
});
const simpleCta = computed(() => (qty.value > 1 ? `Comprar ${qty.value} entradas` : "Comprar entrada"));

// Pagado con varias funciones/tipos: resumen
const functions = computed(() => upcomingFunctions(props.event));
const places = computed(() => placesOf(functions.value));
const multiSummary = computed(() => {
  const parts = [];
  if (functions.value.length > 1) parts.push(`${functions.value.length} funciones`);
  if (places.value.length > 1) parts.push(`${places.value.length} lugares`);
  if (!parts.length) parts.push(`${props.event.tickets.length} tipos de entrada`);
  return parts.join(" · ");
});
const nextFunction = computed(() => (functions.value.length > 1 ? functions.value[0] : null));

// Venta por abrir: contador si faltan menos de 24 h
const now = ref(Date.now());
let timer = null;
const saleStartsAt = computed(() => (props.event.sale_starts_at ? new Date(props.event.sale_starts_at).getTime() : null));
const countdown = computed(() => {
  if (!saleStartsAt.value) return "";
  const ms = saleStartsAt.value - now.value;
  if (ms <= 0 || ms > 24 * 3600 * 1000) return "";
  const s = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))} : ${pad(Math.floor((s % 3600) / 60))} : ${pad(s % 60)}`;
});
onMounted(() => {
  if (props.state === "upcoming" && saleStartsAt.value) {
    timer = setInterval(() => {
      now.value = Date.now();
      // Abrió la venta: recargar para traer las entradas a la venta
      if (saleStartsAt.value && now.value >= saleStartsAt.value) {
        clearInterval(timer);
        window.location.reload();
      }
    }, 1000);
  }
});
onBeforeUnmount(() => clearInterval(timer));

const organizerName = computed(() => props.event.organization?.name || "");
const organizerUrl = computed(() => props.event.organization?.website || "/eventos");

function buySimple() {
  emit("checkout", { entry: "card", step: 2, selection: { [simpleTicket.value.id]: qty.value } });
}
</script>

<template>
  <section class="card ev-motion" :aria-label="state.startsWith('free') ? 'Confirmar asistencia' : 'Entradas'" data-testid="event-action-card" :data-state="state">
    <!-- Gratis -->
    <template v-if="state === 'free' || state === 'free_full'">
      <p class="meta">
        Gratis<template v-if="state === 'free' && stock?.few"> · <span class="few">Quedan {{ stock.remaining }} {{ stock.remaining === 1 ? "cupo" : "cupos" }}</span></template>
      </p>
      <RsvpForm ref="rsvp" :event="event" :mode="state === 'free_full' ? 'full' : 'form'" :external-url="externalUrl" @state="emit('rsvp-state', $event)" />
    </template>

    <!-- Pagado: 1 función, 1 tipo -->
    <template v-else-if="state === 'paid_simple'">
      <div class="price-row">
        <div>
          <p class="price ev-tabular">{{ formatCLP(simpleTicket.final_price ?? simpleTicket.price) }}</p>
          <p class="price-note">{{ priceNote }}</p>
        </div>
        <QuantityStepper v-model="qty" :min="1" :max="simpleMax" :item-label="`una entrada ${simpleTicket.ticket_name}`" />
      </div>
      <button type="button" class="ev-btn ev-btn-primary w-full" data-testid="buy-button" @click="buySimple">
        {{ simpleCta }}<template v-if="qty > 1"> · <AnimatedNumber :value="simpleTotal" /></template>
      </button>
      <p v-if="stock?.few" class="few-line">Últimas entradas</p>
    </template>

    <!-- Pagado: varias funciones o tipos -->
    <template v-else-if="state === 'paid_multi'">
      <div>
        <p class="price ev-tabular">Desde {{ formatCLP(fromPrice) }}</p>
        <p class="price-note">{{ priceNote }}</p>
      </div>
      <div class="summary">
        <p>{{ multiSummary }}</p>
        <p v-if="nextFunction" class="summary-sub">Próxima: {{ formatFunctionShort(nextFunction) }}<template v-if="nextFunction.venue?.name"> · {{ nextFunction.venue.name }}</template></p>
      </div>
      <button type="button" class="ev-btn ev-btn-primary w-full" data-testid="buy-button" @click="emit('checkout', { entry: 'card', step: 1 })">Elegir entradas</button>
    </template>

    <!-- Venta aún no abre -->
    <template v-else-if="state === 'upcoming'">
      <div>
        <p class="meta">{{ event.sale_starts_at ? `Venta abre el ${formatSaleStart(event.sale_starts_at, event.timezone)}` : "Venta próximamente" }}</p>
        <template v-if="countdown">
          <p class="countdown ev-tabular" aria-live="off">{{ countdown }}</p>
          <p class="price-note">horas · minutos · segundos</p>
        </template>
      </div>
      <NotifyForm :event="event" kind="sale_opens" cta="Avisarme cuando abra" />
    </template>

    <!-- Agotado -->
    <template v-else-if="state === 'sold_out'">
      <p class="headline">Se vendieron todas las entradas.</p>
      <NotifyForm :event="event" kind="sold_out" cta="Avisarme si se liberan" secondary />
    </template>

    <!-- Terminado -->
    <template v-else-if="state === 'ended'">
      <p class="headline">Este evento ya ocurrió.</p>
      <button v-if="!event.is_preview" type="button" class="ev-btn ev-btn-primary w-full" data-testid="review-cta" @click="emit('review')">★ ¿Fuiste? Califica el evento</button>
      <a class="ev-link" :href="organizerUrl" :target="event.organization?.website ? '_blank' : undefined" rel="noopener">
        {{ organizerName ? `Ver próximos eventos de ${organizerName} →` : "Ver otros eventos →" }}
      </a>
    </template>

    <!-- Vista previa de un borrador -->
    <template v-else-if="state === 'preview'">
      <p class="headline">Vista previa</p>
      <p class="price-note">La {{ event.tickets?.length && !event.tickets.some((t) => t.price > 0) ? "inscripción" : "compra" }} se habilita al publicar el evento.</p>
      <button type="button" class="ev-btn ev-btn-primary w-full" disabled>{{ event.tickets?.some((t) => t.price > 0) ? "Comprar entrada" : "Confirmar asistencia" }}</button>
    </template>

    <!-- Venta cerrada -->
    <template v-else>
      <p class="headline">La venta está cerrada.</p>
      <p class="price-note">No hay entradas disponibles en este momento.</p>
    </template>

    <button v-if="ordersCount > 0 && !state.startsWith('free')" type="button" class="ev-link orders-link" @click="emit('view-orders')">
      Ver mis entradas ({{ ordersCount }})
    </button>

    <EventTrust :event="event" />
  </section>
</template>

<style scoped>
.card {
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 20px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-family: "Prompt", system-ui, sans-serif;
  color: var(--text-1);
}
.meta {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
}
.few {
  color: var(--warning-text);
}
.price-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.price {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 26px;
  line-height: 32px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.price-note {
  font-size: 13px;
  line-height: 18px;
  color: var(--text-2);
}
.few-line {
  font-size: 13px;
  font-weight: 500;
  color: var(--warning-text);
  text-align: center;
}
.summary {
  font-size: 15px;
  line-height: 22px;
}
.summary-sub {
  font-size: 14px;
  color: var(--text-2);
}
.headline {
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
}
.countdown {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 26px;
  font-weight: 700;
  line-height: 34px;
  margin-top: 4px;
}
.orders-link {
  align-self: center;
  font-size: 14px;
  padding: 6px 10px;
  min-height: 36px;
}
</style>

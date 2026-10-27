<script setup>
// Card de acción de la página del evento (§4.4, v2 en §4.4b): decide qué mostrar según el estado y renderiza el
// registro gratis inline (RsvpForm) o el resumen/stepper del evento pagado (abre el CheckoutSheet).
// Jerarquía de cada estado: rótulo (cardLabel) → contexto → una sola acción principal.
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import RsvpForm from "./RsvpForm.vue";
import NotifyForm from "./NotifyForm.vue";
import QuantityStepper from "./QuantityStepper.vue";
import AnimatedNumber from "./AnimatedNumber.vue";
import EventTrust from "./EventTrust.vue";
import SuccessCheck from "./SuccessCheck.vue";
import {
  attendeeFeedUrl,
  cardLabel,
  cardFunctionChips,
  formatCLP,
  formatFunctionShort,
  formatRating,
  minFinalPrice,
  reviewsCountLabel,
  ticketMax,
  upcomingFunctions,
} from "./eventView.js";
import { trackFunnel } from "./checkoutApi.js";
import { computeTotals, isFeeAbsorbed } from "../Reservation/pricing.js";

const props = defineProps({
  event: { type: Object, required: true },
  state: { type: String, required: true },
  externalUrl: { type: String, default: "" },
  // Órdenes guardadas en este navegador (storedOrders): franja "Tienes N entradas"
  orders: { type: Array, default: () => [] },
});
const emit = defineEmits(["checkout", "view-orders", "rsvp-state", "review", "show-functions"]);

const rsvp = ref(null);
defineExpose({ focusForm: () => rsvp.value?.focusForm() });

// Estado del registro gratis (RsvpForm): cambia el rótulo (confirmado, ya inscrito, cupos llenos)
const rsvpStatus = ref("idle");
function onRsvpState(status) {
  rsvpStatus.value = status;
  emit("rsvp-state", status);
}
const label = computed(() => cardLabel(props.event, props.state, { rsvpStatus: rsvpStatus.value }));

const absorbed = computed(() => isFeeAbsorbed(props.event));
const priceNote = computed(() => (absorbed.value ? "precio final por entrada" : "por entrada, incluye cargo"));
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

// Pagado con varias funciones: chips de las próximas (§4.4b c); con una función y varios tipos, el resumen
const functions = computed(() => upcomingFunctions(props.event));
const manyFunctions = computed(() => functions.value.length > 1);
const fnChips = computed(() => (props.state === "paid_multi" ? cardFunctionChips(props.event) : { chips: [], more: 0 }));
const nextFunction = computed(() => (manyFunctions.value ? functions.value[0] : null));
const typesSummary = computed(() => `${props.event.tickets.length} tipos de entrada`);
// "Elegir entradas para el Vie 24 · 21:00, en Providencia (últimas entradas)"
const chipAria = (chip) => `Elegir entradas para el ${chip.label}${chip.place ? `, en ${chip.place}` : ""}${chip.few ? " (últimas entradas)" : ""}`;

function pickFunction(chip, index) {
  trackFunnel("event_card_function_chip", props.event, { function_id: chip.id, position: index + 1 });
  emit("checkout", { entry: "card", step: 1, functionId: chip.id });
}

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

// Terminado: promedio de reseñas (las mismas de EventReviews, eventData.reviews)
const reviewSummary = computed(() => (props.event.reviews?.summary?.count ? props.event.reviews.summary : null));
const organizerName = computed(() => props.event.organization?.name || "");
const organizerUrl = computed(() => props.event.organization?.website || "/eventos");

// Ya compró en este navegador (fuera de los gratis, que lo resuelve RsvpForm): "Tienes N entradas"
const ownTickets = computed(() => props.orders.reduce((n, o) => n + (Number(o.ticketsCount) || 1), 0));
const showOrders = computed(() => props.orders.length > 0 && !props.state.startsWith("free"));
// "Ver quiénes van": el muro de asistentes vive en la página de la orden (la más reciente de este navegador)
const feedUrl = computed(() => (props.state === "ended" ? "" : attendeeFeedUrl(props.orders)));

function buySimple() {
  emit("checkout", { entry: "card", step: 2, selection: { [simpleTicket.value.id]: qty.value } });
}
</script>

<template>
  <section class="card ev-motion" :aria-label="state.startsWith('free') ? 'Confirmar asistencia' : 'Entradas'" data-testid="event-action-card" :data-state="state">
    <!-- Rótulo de estado (§4.4b a): al cambiar entra con un fade; "Asistencia confirmada" con el check -->
    <p v-if="label" :key="label.text" class="label" :class="`is-${label.tone}`" data-testid="card-label">
      <SuccessCheck v-if="rsvpStatus === 'confirmed'" :size="20" class="label-check" />
      <span>{{ label.text }}</span>
    </p>

    <!-- Gratis -->
    <template v-if="state === 'free' || state === 'free_full'">
      <RsvpForm ref="rsvp" :event="event" :mode="state === 'free_full' ? 'full' : 'form'" :external-url="externalUrl" @state="onRsvpState" />
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
    </template>

    <!-- Pagado: varias funciones o tipos -->
    <template v-else-if="state === 'paid_multi'">
      <div>
        <p class="price ev-tabular">Desde {{ formatCLP(fromPrice) }}</p>
        <p class="price-note">{{ priceNote }}</p>
      </div>
      <ul v-if="fnChips.chips.length" class="chips" aria-label="Próximas funciones" data-testid="card-function-chips">
        <li v-for="(chip, i) in fnChips.chips" :key="chip.id" class="chip-item" :style="{ '--i': i }">
          <button type="button" class="chip" :aria-label="chipAria(chip)" :data-function-id="chip.id" @click="pickFunction(chip, i)">
            <span class="chip-date ev-tabular">
              <span v-if="chip.few" class="chip-dot" aria-hidden="true"></span>
              {{ chip.label }}
            </span>
            <span v-if="chip.place" class="chip-place">{{ chip.place }}</span>
          </button>
        </li>
        <li v-if="fnChips.more" class="chip-item" :style="{ '--i': fnChips.chips.length }">
          <button type="button" class="chip-more" @click="emit('show-functions')">+ {{ fnChips.more }} {{ fnChips.more === 1 ? "función" : "funciones" }}</button>
        </li>
      </ul>
      <div v-else class="summary">
        <p v-if="nextFunction">Próxima: {{ formatFunctionShort(nextFunction) }}<template v-if="nextFunction.venue?.name"> · {{ nextFunction.venue.name }}</template></p>
        <p v-else>{{ typesSummary }}</p>
      </div>
      <button type="button" class="ev-btn ev-btn-primary w-full" data-testid="buy-button" @click="emit('checkout', { entry: 'card', step: 1 })">Elegir entradas</button>
      <button v-if="manyFunctions" type="button" class="sub-link" @click="emit('show-functions')">Ver todas las funciones ↓</button>
    </template>

    <!-- Venta aún no abre -->
    <template v-else-if="state === 'upcoming'">
      <div v-if="countdown">
        <p class="countdown ev-tabular" aria-live="off">{{ countdown }}</p>
        <p class="price-note">horas · minutos · segundos</p>
      </div>
      <NotifyForm :event="event" kind="sale_opens" cta="Avisarme cuando abra" />
    </template>

    <!-- Agotado -->
    <template v-else-if="state === 'sold_out'">
      <p class="lead">Se vendieron todas las entradas.</p>
      <NotifyForm :event="event" kind="sold_out" cta="Avisarme si se liberan" secondary />
    </template>

    <!-- Terminado: con reseñas, el promedio; si no, "ya ocurrió" -->
    <template v-else-if="state === 'ended'">
      <div v-if="reviewSummary" data-testid="card-rating">
        <p class="price ev-tabular" :aria-label="`${formatRating(reviewSummary.average)} de 5 estrellas`">
          {{ formatRating(reviewSummary.average) }} <span class="star" aria-hidden="true">★</span>
        </p>
        <p class="price-note">{{ reviewsCountLabel(reviewSummary.count) }}</p>
      </div>
      <p v-else class="lead">Este evento ya ocurrió.</p>
      <button v-if="!event.is_preview" type="button" class="ev-btn ev-btn-primary w-full" data-testid="review-cta" @click="emit('review')">★ ¿Fuiste? Califica el evento</button>
      <a class="sub-link" :href="organizerUrl" :target="event.organization?.website ? '_blank' : undefined" rel="noopener">
        {{ organizerName ? `Ver próximos eventos de ${organizerName} →` : "Ver otros eventos →" }}
      </a>
    </template>

    <!-- Vista previa de un borrador -->
    <template v-else-if="state === 'preview'">
      <p class="price-note">La {{ event.tickets?.length && !event.tickets.some((t) => t.price > 0) ? "inscripción" : "compra" }} se habilita al publicar el evento.</p>
      <button type="button" class="ev-btn ev-btn-primary w-full" disabled>{{ event.tickets?.some((t) => t.price > 0) ? "Comprar entrada" : "Confirmar asistencia" }}</button>
    </template>

    <!-- Venta cerrada -->
    <template v-else>
      <p class="price-note">No hay entradas disponibles en este momento.</p>
    </template>

    <!-- Ya compró en este navegador: franja al pie de la card, sin cambiar el estado de venta -->
    <div v-if="showOrders" class="orders" data-testid="card-orders">
      <p class="orders-count">Tienes {{ ownTickets }} {{ ownTickets === 1 ? "entrada" : "entradas" }}</p>
      <div class="orders-links">
        <button type="button" class="sub-link" @click="emit('view-orders')">Ver mis entradas</button>
        <template v-if="feedUrl">
          <span aria-hidden="true" class="orders-sep">·</span>
          <a :href="feedUrl" class="sub-link">Ver quiénes van →</a>
        </template>
      </div>
    </div>

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
/* Rótulo unificado (§4.4b a): reemplaza a .meta, .few-line y .headline */
.label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-2);
  animation: ev-fade-in var(--dur-2) var(--ease-out) both;
}
.label.is-positive {
  color: var(--success-text);
}
.label.is-warning {
  color: var(--warning-text);
}
.label-check {
  flex: 0 0 auto;
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
.star {
  font-size: 22px;
}
.price-note {
  font-size: 13px;
  line-height: 18px;
  color: var(--text-2);
}
.lead {
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
}
.summary {
  font-size: 15px;
  line-height: 22px;
}
.countdown {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 26px;
  font-weight: 700;
  line-height: 34px;
}

/* Chips de próximas funciones (§4.4b c): entran con stagger de 40 ms */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.chip-item {
  display: flex;
  animation: ev-fade-up var(--dur-2) var(--ease-out) calc(var(--i, 0) * 40ms) both;
}
.chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  min-height: 44px;
  padding: 6px 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--border-strong);
  background: var(--surface-0);
  color: var(--text-1);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--dur-2), border-color var(--dur-2), transform var(--dur-2) var(--ease-spring);
}
.chip:hover {
  background: var(--surface-1);
  border-color: var(--text-1);
}
.chip:active {
  transform: scale(0.96);
}
.chip:focus-visible,
.chip-more:focus-visible,
.sub-link:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.chip-date {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  white-space: nowrap;
}
.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning);
  flex: 0 0 auto;
}
.chip-place {
  font-size: 12px;
  line-height: 16px;
  color: var(--text-2);
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-more {
  align-self: center;
  min-height: 44px;
  padding: 0 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
  background: none;
  border: 0;
  border-radius: 4px;
  white-space: nowrap;
  cursor: pointer;
}
.chip-more:hover {
  color: var(--text-1);
}

/* Acciones secundarias en texto (no compiten con el botón principal) */
.sub-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  align-self: center;
  min-height: 44px;
  padding: 0 6px;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
  text-decoration: none;
  background: none;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  transition: color var(--dur-1);
}
.sub-link:hover {
  color: var(--text-1);
}

/* Franja "Tienes N entradas": cantidad arriba, accesos debajo */
.orders {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin: 0 -8px;
  padding: 10px 12px 2px;
  border-radius: var(--r-md);
  background: var(--surface-1);
  animation: ev-fade-up var(--dur-3) var(--ease-out) both;
}
.orders-count {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
/* Los links conservan su área táctil (44 px de alto y algo de aire a los lados); el margen negativo alinea el
   texto con "Tienes N entradas" */
.orders-links {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0 2px;
  margin: 0 -4px;
}
.orders-links .sub-link {
  padding: 0 4px;
}
.orders-sep {
  color: var(--text-3);
}

/* Mobile: los chips van en una fila con scroll horizontal (de borde a borde de la card) */
@media (max-width: 767px) {
  .chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    margin: 0 -20px;
    padding: 0 20px;
    scroll-padding: 0 20px;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip-item {
    flex: 0 0 auto;
    scroll-snap-align: start;
  }
}
</style>

<script setup>
// Checkout pagado en 2 pasos (Elegir → Pagar) dentro de un sheet (§6): lateral de 480 px en desktop, bottom
// sheet de 92dvh en mobile. Alto fijo: header y footer quedan fijos y el contenido hace scroll (sin saltos).
// Estado en la URL (?checkout=1&paso=2&funcion=679&entradas=82:2,83:1): el botón "atrás" del navegador vuelve
// del paso 2 al 1 y del 1 cierra el sheet.
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import CheckoutStepChoose from "./CheckoutStepChoose.vue";
import CheckoutStepPay from "./CheckoutStepPay.vue";
import AnimatedNumber from "./AnimatedNumber.vue";
import { checkoutFunctions, ticketRowsFor, readCheckoutParams, writeCheckoutParams, formatCLP, upcomingFunctions } from "./eventView.js";
import { trackFunnel } from "./checkoutApi.js";
import {
  buildSelectedLines,
  computeTotalsWithDiscount,
  isFeeAbsorbed,
  discountLineLabel,
  SERVICE_FEE_LABEL,
  SERVICE_FEE_TAX_LABEL,
  FEE_INCLUDED_NOTE,
} from "../Reservation/pricing.js";
import { eventBus } from "../../utils/eventbus.js";

const props = defineProps({
  event: { type: Object, required: true },
  // { step, selection, functionId, ticketId, code, entry, fromUrl }
  initial: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["close"]);

const model = computed(() => checkoutFunctions(props.event));
const isSimple = computed(() => (props.event.tickets || []).length === 1);
const hasStep1 = computed(() => !isSimple.value);

const step = ref(1);
const direction = ref("fwd");
const selection = ref({});
const functionId = ref(null);
const place = ref(null);
const notice = ref("");
const discount = ref(null);
const busy = ref(false);
const detailsOpen = ref(false);
const demoResult = ref(null);
const buyerPrefill = ref(null);
const payStep = ref(null);
const panel = ref(null);
const body = ref(null);
const visible = ref(false);
const autoCode = ref(props.initial.code || "");

// ---- Selección inicial (deep links validados contra las entradas a la venta) ----
function initSelection() {
  const m = model.value;
  const onSale = props.event.tickets || [];
  const init = props.initial;

  if (m.needsFunction) {
    const wanted = init.functionId ? m.functions.find((f) => String(f.id) === String(init.functionId)) : null;
    if (init.functionId && (!wanted || wanted.status === "sold_out")) notice.value = "Esa función se agotó. Elige otra:";
    const available = m.functions.filter((f) => f.status !== "sold_out");
    const chosen = wanted && wanted.status !== "sold_out" ? wanted : available.length === 1 ? available[0] : null;
    if (chosen) {
      functionId.value = String(chosen.id);
      place.value = chosen.place;
    }
  }
  if (!place.value && m.places.length) place.value = m.places[0].key;

  const sel = {};
  for (const [id, qty] of Object.entries(init.selection || {})) {
    const t = onSale.find((x) => String(x.id) === String(id));
    if (t && qty > 0) sel[id] = qty;
  }
  if (init.ticketId) {
    const t = onSale.find((x) => String(x.id) === String(init.ticketId));
    if (t) {
      sel[t.id] = sel[t.id] || 1;
      if (t.event_date_id != null && m.needsFunction) {
        const f = m.functions.find((x) => String(x.id) === String(t.event_date_id));
        if (f) {
          functionId.value = String(f.id);
          place.value = f.place;
        }
      }
    }
  }
  selection.value = sel;
  preselectSingle();

  step.value = init.step === 2 || isSimple.value ? 2 : 1;
  if (step.value === 2 && !totals.value.quantity) step.value = hasStep1.value ? 1 : 2;
  if (isSimple.value && !totals.value.quantity) selection.value = { [onSale[0].id]: 1 };
}

// Si hay un solo tipo de entrada disponible para la función, se preselecciona 1
function preselectSingle() {
  if (Object.keys(selection.value).length) return;
  if (model.value.needsFunction && !functionId.value) return;
  const rows = ticketRowsFor(props.event, model.value.needsFunction ? functionId.value : null).filter((r) => r.status === "available");
  if (rows.length === 1) selection.value = { [rows[0].id]: 1 };
}

// Al cambiar de función se quitan las entradas amarradas a otra función (no durante la selección inicial)
let ready = false;
watch(functionId, (id) => {
  if (!ready) return;
  const next = {};
  for (const [tid, qty] of Object.entries(selection.value)) {
    const t = (props.event.tickets || []).find((x) => String(x.id) === String(tid));
    if (t && (t.event_date_id == null || String(t.event_date_id) === String(id))) next[tid] = qty;
  }
  selection.value = next;
  notice.value = "";
  preselectSingle();
});
watch(place, (key) => {
  if (!ready || !model.value.needsFunction) return;
  const current = model.value.functions.find((f) => String(f.id) === String(functionId.value));
  if (current && current.place === key) return;
  const options = model.value.functions.filter((f) => f.place === key && f.status !== "sold_out");
  functionId.value = options.length === 1 ? String(options[0].id) : null;
});

// ---- Totales (misma regla que el servidor) ----
const lines = computed(() => buildSelectedLines(selection.value, props.event.tickets, props.event.dates));
const totals = computed(() => computeTotalsWithDiscount(lines.value, discount.value, { feeAbsorbed: isFeeAbsorbed(props.event) }));
const isFreeOrder = computed(() => totals.value.quantity > 0 && totals.value.total === 0);
const chosenFunction = computed(() => {
  if (functionId.value) return (props.event.dates || []).find((d) => String(d.id) === String(functionId.value)) || null;
  const upcoming = upcomingFunctions(props.event);
  return upcoming.length === 1 ? upcoming[0] : null;
});

const ctaLabel = computed(() => {
  if (step.value === 1) return "Continuar";
  if (busy.value) return isFreeOrder.value ? "Confirmando…" : "Redirigiendo a Webpay…";
  if (props.event.is_demo) return isFreeOrder.value ? "Simular confirmación" : `Simular pago de ${formatCLP(totals.value.total)}`;
  return isFreeOrder.value ? "Confirmar asistencia" : `Pagar ${formatCLP(totals.value.total)} con Webpay`;
});

// ---- Navegación y URL ----
let depth = 0; // entradas de historial que agregó el sheet
function urlState() {
  return { open: true, step: step.value, functionId: functionId.value, selection: selection.value };
}
function pushUrl() {
  const url = new URL(window.location.href);
  writeCheckoutParams(url.searchParams, urlState());
  window.history.pushState({ ...(window.history.state || {}), checkout: true }, "", url.pathname + url.search + url.hash);
  depth++;
}
function replaceUrl(open = true) {
  const url = new URL(window.location.href);
  writeCheckoutParams(url.searchParams, open ? urlState() : { open: false });
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}
watch([selection, functionId], () => visible.value && replaceUrl(), { deep: true });

function goStep2() {
  if (!totals.value.quantity) return;
  direction.value = "fwd";
  step.value = 2;
  pushUrl();
  focusStep();
}
function goBack() {
  if (step.value !== 2 || !hasStep1.value) return;
  if (depth >= 2) {
    window.history.back(); // popstate => paso 1
    return;
  }
  direction.value = "back";
  step.value = 1;
  replaceUrl();
  focusStep();
}
let closeRequested = false;
function onPopState() {
  const params = readCheckoutParams(new URLSearchParams(window.location.search));
  depth = Math.max(0, depth - 1);
  if (!params.open || closeRequested) {
    if (params.open) replaceUrl(false);
    finishClose();
    return;
  }
  const nextStep = params.step === 2 && hasStep1.value ? 2 : hasStep1.value ? 1 : 2;
  if (nextStep !== step.value) {
    direction.value = nextStep > step.value ? "fwd" : "back";
    step.value = nextStep;
    focusStep();
  }
}

function requestClose() {
  if (busy.value) return;
  if (depth > 0) {
    closeRequested = true;
    window.history.go(-depth); // popstate => finishClose
    return;
  }
  replaceUrl(false);
  finishClose();
}
let closing = false;
function finishClose() {
  if (closing) return;
  closing = true;
  visible.value = false;
}
function afterLeave() {
  emit("close");
}

// ---- Teclado, foco y scroll del body ----
let opener = null;
let savedOverflow = "";
let savedPadding = "";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

function focusStep() {
  nextTick(() =>
    setTimeout(() => {
      const root = body.value;
      if (!root) return;
      body.value.scrollTop = 0;
      const target = root.querySelector('[aria-checked="true"]') || root.querySelector('input:not([type="hidden"]):not([readonly]), [role="radio"], button');
      (target || panel.value)?.focus({ preventScroll: true });
    }, 60),
  );
}
// En document: Esc funciona aunque el foco haya quedado fuera del panel (p. ej. al cambiar de contenido)
function onKeydown(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    requestClose();
    return;
  }
  if (e.key !== "Tab" || !panel.value) return;
  if (!panel.value.contains(document.activeElement)) {
    e.preventDefault();
    panel.value.focus();
    return;
  }
  const items = [...panel.value.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]'));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
function lockScroll() {
  const sb = window.innerWidth - document.documentElement.clientWidth;
  savedOverflow = document.body.style.overflow;
  savedPadding = document.body.style.paddingRight;
  document.body.style.overflow = "hidden";
  if (sb > 0) document.body.style.paddingRight = `${sb}px`;
}
function unlockScroll() {
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPadding;
}

// ---- Arrastre para cerrar (mobile, A12) ----
const dragY = ref(0);
const dragging = ref(false);
let dragStart = 0;
let dragStartTime = 0;
function onDragStart(e) {
  if (window.matchMedia("(min-width: 768px)").matches) return;
  dragging.value = true;
  dragStart = e.clientY;
  dragStartTime = performance.now();
  e.currentTarget.setPointerCapture?.(e.pointerId);
}
function onDragMove(e) {
  if (!dragging.value) return;
  dragY.value = Math.max(0, e.clientY - dragStart);
}
function onDragEnd() {
  if (!dragging.value) return;
  dragging.value = false;
  const velocity = dragY.value / Math.max(1, performance.now() - dragStartTime); // px/ms
  if (dragY.value > 120 || velocity > 0.5) requestClose();
  else dragY.value = 0;
}
const panelStyle = computed(() => (dragY.value ? { transform: `translateY(${dragY.value}px)`, transition: dragging.value ? "none" : undefined } : null));

// ---- Pago ----
function showDemo(result) {
  demoResult.value = result;
  nextTick(() => body.value?.querySelector(".demo-title")?.focus());
}
function onPrimary() {
  if (step.value === 1) goStep2();
  else payStep.value?.submit();
}
function onSoldOut(message) {
  if (hasStep1.value) {
    notice.value = message || "Se agotaron algunas entradas. Vuelve a elegirlas.";
    direction.value = "back";
    step.value = 1;
    replaceUrl();
  }
}

// ---- Asistente IA (fill_buyer_information) ----
function onAssistantTickets(data) {
  const t = (props.event.tickets || []).find((x) => String(x.id) === String(data?.ticket_type_id));
  if (!t) return;
  if (t.event_date_id != null && model.value.needsFunction) functionId.value = String(t.event_date_id);
  selection.value = { ...selection.value, [t.id]: Math.max(1, Math.min(Number(data.quantity) || 1, 10)) };
}
function onAssistantNext() {
  if (step.value === 1) goStep2();
}
function onAssistantFill(data) {
  buyerPrefill.value = { name: [data?.first_name, data?.last_name].filter(Boolean).join(" "), email: data?.email || "" };
}

onMounted(() => {
  initSelection();
  nextTick(() => (ready = true));
  opener = document.activeElement;
  lockScroll();
  visible.value = true;
  if (props.initial.fromUrl) replaceUrl();
  else pushUrl();
  trackFunnel("checkout_open", props.event, { entry: props.initial.entry || "card" });
  window.addEventListener("popstate", onPopState);
  document.addEventListener("keydown", onKeydown);
  eventBus.on("ticket-selection", onAssistantTickets);
  eventBus.on("proceed-to-next-step", onAssistantNext);
  eventBus.on("fill-buyer-info", onAssistantFill);
  focusStep();
});
onBeforeUnmount(() => {
  unlockScroll();
  window.removeEventListener("popstate", onPopState);
  document.removeEventListener("keydown", onKeydown);
  eventBus.off("ticket-selection", onAssistantTickets);
  eventBus.off("proceed-to-next-step", onAssistantNext);
  eventBus.off("fill-buyer-info", onAssistantFill);
  if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <div class="sheet-root ev-motion">
      <Transition name="overlay" appear>
        <div v-if="visible" class="overlay" aria-hidden="true" @click="requestClose"></div>
      </Transition>
      <Transition name="panel" appear @after-leave="afterLeave">
        <div
          v-if="visible"
          ref="panel"
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-title"
          tabindex="-1"
          :style="panelStyle"
          data-testid="checkout-sheet"
        >
          <header class="head" @pointerdown="onDragStart" @pointermove="onDragMove" @pointerup="onDragEnd" @pointercancel="onDragEnd">
            <span class="handle" aria-hidden="true"></span>
            <div class="head-row">
              <img v-if="event.image_url" :src="event.image_url" alt="" class="thumb" width="40" height="40" />
              <div class="head-text">
                <p id="checkout-title" class="head-title">{{ event.name }}</p>
                <div v-if="hasStep1" class="steps" :aria-label="`Paso ${step} de 2`" role="img">
                  <span class="seg is-on"></span>
                  <span class="seg"><span class="seg-fill" :class="{ 'is-on': step === 2 }"></span></span>
                </div>
              </div>
              <button type="button" class="close" aria-label="Cerrar" :disabled="busy" @click="requestClose" @pointerdown.stop>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <p v-if="event.is_demo" class="demo">Demostración: el flujo es real, pero no se crea ninguna orden ni se cobra nada.</p>
          </header>

          <div ref="body" class="body">
            <div v-if="demoResult" class="demo-result" data-testid="resv-demo-result">
              <h3 class="demo-title" tabindex="-1">{{ demoResult.free ? "Así terminaría la confirmación" : "Así terminaría la compra" }}</h3>
              <ol class="demo-list">
                <li v-if="demoResult.free"><strong>Confirmación:</strong> la asistencia quedaría registrada al instante, sin pagar nada.</li>
                <li v-else><strong>Pago seguro:</strong> te llevaríamos a Webpay para pagar {{ formatCLP(demoResult.total) }}.</li>
                <li><strong>Entradas por email:</strong> {{ demoResult.email || "el comprador" }} recibiría sus entradas con QR y un recordatorio 24 h antes.</li>
                <li><strong>Check-in:</strong> el equipo del productor escanea el QR desde el celular, incluso sin señal.</li>
                <li><strong>Para el productor:</strong> ve la venta al instante en su panel, con el canal que la trajo.</li>
              </ol>
              <p class="demo-note">Esto es una demostración: no se creó ninguna orden ni se realizó ningún cobro.</p>
              <a href="/organizadores/registro?utm_source=aitickets&utm_medium=demo_event&utm_campaign=checkout" class="ev-btn ev-btn-primary w-full">Quiero vender entradas así</a>
              <button type="button" class="ev-link demo-back" @click="demoResult = null">Volver</button>
            </div>
            <div v-else class="steps-stage">
              <Transition :name="`step-${direction}`">
                <CheckoutStepChoose
                  v-if="step === 1"
                  key="choose"
                  v-model:place="place"
                  v-model:function-id="functionId"
                  v-model:selection="selection"
                  :event="event"
                  :model="model"
                  :notice="notice"
                  data-testid="resv-step-tickets"
                  @track="(name, params) => trackFunnel(name, event, params)"
                />
                <CheckoutStepPay
                  v-else
                  key="pay"
                  ref="payStep"
                  v-model:discount="discount"
                  :event="event"
                  :lines="lines"
                  :totals="totals"
                  :fn="chosenFunction"
                  :auto-code="autoCode"
                  :can-go-back="hasStep1"
                  :buyer-prefill="buyerPrefill"
                  data-testid="resv-step-buyer"
                  @busy="busy = $event"
                  @back="goBack"
                  @demo="showDemo"
                  @sold-out="onSoldOut"
                />
              </Transition>
            </div>
          </div>

          <footer v-if="!demoResult" class="foot">
            <div class="ev-collapse" :class="{ 'is-open': detailsOpen && totals.quantity > 0 }">
              <div>
                <dl class="details" data-testid="checkout-breakdown">
                  <div><dt>Entradas</dt><dd class="ev-tabular">{{ formatCLP(totals.grossSubtotal) }}</dd></div>
                  <div v-if="totals.discountAmount > 0" class="is-discount">
                    <dt>{{ discountLineLabel(discount?.code) }}</dt><dd class="ev-tabular">−{{ formatCLP(totals.discountAmount) }}</dd>
                  </div>
                  <template v-if="totals.feeAbsorbed">
                    <div v-if="totals.subtotal > 0"><dt>{{ FEE_INCLUDED_NOTE }}</dt><dd>Incluido</dd></div>
                  </template>
                  <template v-else>
                    <div v-if="totals.subtotal > 0"><dt>{{ SERVICE_FEE_LABEL }}</dt><dd class="ev-tabular">{{ formatCLP(totals.feeNet) }}</dd></div>
                    <div v-if="totals.feeIva > 0"><dt>{{ SERVICE_FEE_TAX_LABEL }}</dt><dd class="ev-tabular">{{ formatCLP(totals.feeIva) }}</dd></div>
                  </template>
                  <div class="is-total"><dt>Total</dt><dd class="ev-tabular">{{ formatCLP(totals.total) }}</dd></div>
                </dl>
              </div>
            </div>
            <div class="foot-row">
              <div class="foot-total">
                <template v-if="totals.quantity > 0">
                  <p class="foot-amount">
                    <span class="foot-label">Total</span>
                    <AnimatedNumber :value="totals.total" />
                  </p>
                  <button v-if="!isFreeOrder" type="button" class="ev-link foot-details" :aria-expanded="detailsOpen ? 'true' : 'false'" @click="detailsOpen = !detailsOpen">
                    {{ detailsOpen ? "Ocultar detalle" : "Ver detalle" }}
                  </button>
                </template>
                <p v-else class="foot-empty">Elige al menos una entrada</p>
              </div>
              <button
                type="button"
                class="ev-btn ev-btn-primary foot-cta"
                data-testid="resv-pay-button"
                :disabled="totals.quantity === 0"
                :aria-busy="busy ? 'true' : 'false'"
                @click="onPrimary"
              >
                <span v-if="busy" class="ev-spinner" aria-hidden="true"></span>
                <span>{{ ctaLabel }}</span>
              </button>
            </div>
            <p v-if="step === 2 && !isFreeOrder && !event.is_demo" class="secure">Pago seguro con Webpay · Tarjetas de crédito, débito y prepago</p>
          </footer>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-root {
  font-family: "Prompt", system-ui, sans-serif;
  color: var(--text-1);
}
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.4);
}
.panel {
  position: fixed;
  z-index: 61;
  left: 0;
  right: 0;
  bottom: 0;
  height: 92dvh;
  max-height: 92vh;
  background: var(--surface-0);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: var(--shadow-sheet);
  display: flex;
  flex-direction: column;
  outline: none;
  transition: transform var(--dur-3) var(--ease-out);
}
@supports (height: 92dvh) {
  .panel {
    max-height: none;
  }
}
.head {
  flex: 0 0 auto;
  padding: 8px 16px 12px;
  border-bottom: 1px solid var(--border);
  touch-action: none;
}
.handle {
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-2);
  margin: 0 auto 10px;
}
.head-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--r-sm);
  object-fit: cover;
  background: var(--surface-1);
  flex: 0 0 auto;
}
.head-text {
  flex: 1;
  min-width: 0;
}
.head-title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.steps {
  display: flex;
  gap: 4px;
  margin-top: 6px;
}
.seg {
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background: var(--surface-2);
  overflow: hidden;
}
.seg.is-on {
  background: var(--brand-ink);
}
/* A14: el segmento del paso 2 se rellena de izquierda a derecha */
.seg-fill {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--brand-ink);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--dur-3) var(--ease-out);
}
.seg-fill.is-on {
  transform: scaleX(1);
}
.close {
  width: 44px;
  height: 44px;
  margin-right: -8px;
  border-radius: 50%;
  border: 0;
  background: none;
  color: var(--text-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: 0 0 auto;
}
.close:hover {
  background: var(--surface-1);
}
.close:focus-visible {
  outline: 2px solid var(--text-1);
}
.demo {
  margin-top: 10px;
  font-size: 12px;
  line-height: 18px;
  color: #581c87;
  background: #faf5ff;
  border-radius: var(--r-sm);
  padding: 6px 10px;
}
.body {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 20px 16px 24px;
}
.steps-stage {
  position: relative;
}
.foot {
  flex: 0 0 auto;
  border-top: 1px solid var(--border);
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: var(--surface-0);
}
.details {
  padding-bottom: 12px;
  font-size: 14px;
}
.details > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  color: var(--text-2);
}
.details .is-discount {
  color: #3f6212;
}
.details .is-total {
  color: var(--text-1);
  font-weight: 600;
  border-top: 1px solid var(--border);
  margin-top: 6px;
  padding-top: 8px;
}
.foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.foot-total {
  min-width: 0;
}
.foot-amount {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 18px;
  font-weight: 600;
  white-space: nowrap;
}
.foot-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
}
.foot-details {
  font-size: 13px;
  color: var(--text-2);
  text-decoration: underline;
  text-underline-offset: 3px;
  background: none;
  border: 0;
  padding: 2px 0;
  cursor: pointer;
}
.foot-empty {
  font-size: 14px;
  color: var(--text-2);
}
.foot-cta {
  flex: 0 1 auto;
  min-width: 150px;
  padding: 0 18px;
  font-size: 15px;
}
.secure {
  margin-top: 8px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-3);
  text-align: right;
}
.demo-result {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.demo-title {
  outline: none;
  font-size: 18px;
  font-weight: 600;
}
.demo-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 14px;
  line-height: 21px;
  color: var(--text-2);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px;
}
.demo-list strong {
  color: var(--text-1);
}
.demo-note {
  font-size: 12px;
  color: var(--text-3);
}
.demo-back {
  align-self: center;
  font-size: 14px;
  background: none;
  border: 0;
  padding: 6px;
  cursor: pointer;
}

/* A11 / A12: apertura y cierre */
.overlay-enter-active {
  transition: opacity var(--dur-3) var(--ease-out);
}
.overlay-leave-active {
  transition: opacity 240ms var(--ease-in-out);
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
.panel-enter-active {
  transition: transform var(--dur-3) var(--ease-out);
}
.panel-leave-active {
  transition: transform 240ms var(--ease-in-out);
}
.panel-enter-from,
.panel-leave-to {
  transform: translateY(100%) !important;
}

/* A13: cambio de paso con la altura del contenedor fija */
.step-fwd-enter-active,
.step-fwd-leave-active,
.step-back-enter-active,
.step-back-leave-active {
  transition: opacity var(--dur-3) var(--ease-in-out), transform var(--dur-3) var(--ease-in-out);
}
.step-fwd-leave-active,
.step-back-leave-active {
  position: absolute;
  inset: 0 0 auto 0;
}
.step-fwd-enter-from { opacity: 0; transform: translateX(24px); }
.step-fwd-leave-to { opacity: 0; transform: translateX(-24px); }
.step-back-enter-from { opacity: 0; transform: translateX(-24px); }
.step-back-leave-to { opacity: 0; transform: translateX(24px); }

@media (min-width: 768px) {
  .panel {
    left: auto;
    top: 0;
    width: 480px;
    height: 100%;
    max-height: none;
    border-radius: 0;
    box-shadow: -8px 0 40px rgba(0, 0, 0, 0.12);
  }
  .handle {
    display: none;
  }
  .head {
    padding: 16px 24px;
    touch-action: auto;
  }
  .body {
    padding: 24px;
  }
  .foot {
    padding: 16px 24px;
  }
  .panel-enter-from,
  .panel-leave-to {
    transform: translateX(100%) !important;
  }
}
</style>

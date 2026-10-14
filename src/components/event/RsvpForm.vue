<script setup>
// Registro de un evento GRATIS dentro de la card de acción (estilo Luma): sin modal ni pasos.
// Máquina de estados: idle → submitting → success | already | error ; full → waitlist_ok.
// El servidor (/api/purchase-ticket) crea la orden de $0 y envía la entrada con QR igual que antes.
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import AutoHeight from "./AutoHeight.vue";
import SuccessCheck from "./SuccessCheck.vue";
import QuantityStepper from "./QuantityStepper.vue";
import { suggestEmail } from "./emailSuggest.js";
import { fireConfetti } from "./confetti.js";
import { firstNameOf, ticketMax, formatFunctionShort } from "./eventView.js";
import { addToCalendar, shareEvent } from "./shareActions.js";
import {
  createOrder,
  resendTickets,
  joinWaitlist,
  rememberBuyer,
  rememberedBuyer,
  forgetBuyer,
  rememberOrder,
  storedOrders,
  trackFunnel,
} from "./checkoutApi.js";
import { useTurnstile } from "./useTurnstile.js";
import { isValidEmail } from "../Reservation/pricing.js";
import { trackPurchase } from "../../composables/useGoogleAnalytics.js";
import { eventBus } from "../../utils/eventbus.js";

const props = defineProps({
  event: { type: Object, required: true },
  // 'form' (cupos disponibles) | 'full' (se llenaron: lista de espera)
  mode: { type: String, default: "form" },
  // Sitio de productor en dominio propio: confirmar lleva a aitickets.cl (Turnstile y API viven ahí)
  externalUrl: { type: String, default: "" },
});
const emit = defineEmits(["state"]);

const status = ref(props.mode === "full" ? "full" : "idle");
const name = ref("");
const email = ref("");
const errors = ref({ name: "", email: "" });
const shake = ref(0);
const serverMessage = ref("");
const errorKind = ref(""); // 'network' | 'server' | 'message'
const remembered = ref(null);
const quantity = ref(1);
const showGuests = ref(false);
const result = ref({ orderId: null, quantity: 1, name: "", email: "" });
const alreadyFromStorage = ref(false);
const resendState = ref(""); // '' | 'sending' | 'sent'
const waitlistNote = ref("");
const liveMessage = ref("");

const nameInput = ref(null);
const emailInput = ref(null);
const successTitle = ref(null);
const captchaEl = ref(null);
const captcha = useTurnstile(captchaEl, { disabled: () => Boolean(props.event?.is_demo) });

// Tipos de entrada gratis a la venta (chips solo si hay más de uno)
const freeTickets = computed(() => (props.event?.tickets || []).filter((t) => !(Number(t.price) > 0)));
const selectedTicketId = ref(null);
const selectedTicket = computed(() => freeTickets.value.find((t) => String(t.id) === String(selectedTicketId.value)) || freeTickets.value[0] || null);
const maxGuests = computed(() => (selectedTicket.value ? ticketMax(selectedTicket.value) : 1));
const chipLabel = (t) => {
  const fn = t.event_date_id != null ? (props.event?.dates || []).find((d) => String(d.id) === String(t.event_date_id)) : null;
  return fn ? `${t.ticket_name} · ${formatFunctionShort(fn)}` : t.ticket_name;
};
watch(maxGuests, (max) => {
  if (quantity.value > max) quantity.value = Math.max(1, max);
});

const busy = computed(() => status.value === "submitting");
const suggestion = computed(() => (errors.value.email ? "" : suggestEmail(email.value)));
const ctaLabel = computed(() => {
  if (busy.value) return "Confirmando…";
  return quantity.value > 1 ? `Confirmar ${quantity.value} asistencias` : "Confirmar asistencia";
});
const shakeClass = computed(() => (shake.value ? (shake.value % 2 ? "ev-shake-a" : "ev-shake-b") : ""));
const firstName = computed(() => firstNameOf(result.value.name || name.value));
const orderUrl = computed(() => (result.value.orderId ? `/order/${result.value.orderId}` : ""));

function validateName() {
  errors.value.name = name.value.trim().length >= 2 ? "" : "Escribe tu nombre.";
  return !errors.value.name;
}
function validateEmail() {
  errors.value.email = isValidEmail(email.value.trim()) ? "" : "Revisa tu email, parece incompleto.";
  return !errors.value.email;
}
// Validación al salir del campo (solo si ya escribió algo) y al enviar; nunca mientras escribe
const onBlurName = () => name.value.trim() && validateName();
const onBlurEmail = () => email.value.trim() && validateEmail();
const onInputName = () => errors.value.name && (errors.value.name = "");
const onInputEmail = () => errors.value.email && (errors.value.email = "");

let started = false;
function onFocusForm() {
  stopNudge();
  captcha.start();
  if (!started) {
    started = true;
    trackFunnel("rsvp_start", props.event);
  }
}

function applySuggestion() {
  email.value = suggestion.value;
}

function useRememberedChange() {
  remembered.value = null;
  forgetBuyer();
  name.value = "";
  email.value = "";
  nextTick(() => nameInput.value?.focus());
}

/** Lo usa la barra sticky de mobile: lleva a la card y enfoca el nombre. */
function focusForm() {
  const target = remembered.value ? null : nameInput.value;
  if (target) target.focus({ preventScroll: true });
}
defineExpose({ focusForm });

async function submit() {
  if (busy.value) return;
  if (props.externalUrl) {
    window.location.href = props.externalUrl;
    return;
  }
  const okName = validateName();
  const okEmail = validateEmail();
  if (!okName || !okEmail) {
    remembered.value = null;
    shake.value++;
    liveMessage.value = [errors.value.name, errors.value.email].filter(Boolean).join(" ");
    await nextTick();
    (okName ? emailInput.value : nameInput.value)?.focus();
    return;
  }
  if (!selectedTicket.value) return;

  status.value = "submitting";
  serverMessage.value = "";
  errorKind.value = "";
  trackFunnel("rsvp_submit", props.event, { quantity: quantity.value });

  // Demo: el flujo completo sin crear una orden
  if (props.event?.is_demo) {
    await new Promise((r) => setTimeout(r, 900));
    succeed({ orderId: null });
    return;
  }

  const cfToken = await captcha.getToken();
  const res = await createOrder({
    event: props.event,
    fullName: name.value,
    email: email.value,
    tickets: [{ id: selectedTicket.value.id, quantity: quantity.value }],
    cfToken,
    termsAccepted: true,
  });

  if (res.ok && res.data?.orderId) {
    trackPurchase(res.data.orderId, props.event.id, props.event.name, quantity.value, 0);
    rememberOrder(props.event, { orderId: res.data.orderId, quantity: quantity.value, email: email.value.trim(), name: name.value.trim() });
    succeed({ orderId: res.data.orderId });
    return;
  }

  captcha.reset();
  const code = res.data?.code;
  trackFunnel("rsvp_error", props.event, { code: code || (res.network ? "network" : String(res.status)) });
  if (code === "ALREADY_REGISTERED") {
    rememberBuyer(name.value.trim(), email.value.trim());
    status.value = "already";
    return;
  }
  if (code === "SOLD_OUT") {
    waitlistNote.value = "Justo se acabaron los cupos. ¿Te avisamos si se libera uno?";
    status.value = "full";
    return;
  }
  if (res.network) {
    errorKind.value = "network";
    serverMessage.value = "No pudimos confirmar. Revisa tu conexión e inténtalo de nuevo.";
  } else if (res.status >= 400 && res.status < 500 && res.data?.message) {
    errorKind.value = "message";
    serverMessage.value = res.data.message;
  } else {
    errorKind.value = "server";
    serverMessage.value = "Algo falló de nuestro lado. Inténtalo en unos segundos.";
  }
  status.value = "error";
}

async function succeed({ orderId }) {
  result.value = { orderId, quantity: quantity.value, name: name.value.trim(), email: email.value.trim() };
  rememberBuyer(name.value.trim(), email.value.trim());
  trackFunnel("rsvp_success", props.event, { quantity: quantity.value });
  status.value = "success";
  liveMessage.value = `¡Listo, ${firstName.value}! Estás dentro.`;
  await nextTick();
  // A32: confetti desde el check de éxito (solo al confirmar ahora, no al volver a la página)
  setTimeout(() => fireConfetti({ origin: successTitle.value }), 220);
  setTimeout(() => successTitle.value?.focus({ preventScroll: true }), 360);
}

async function resend() {
  if (resendState.value) return;
  resendState.value = "sending";
  const res = await resendTickets(props.event, email.value);
  resendState.value = res.ok || res.status === 429 ? "sent" : "";
  if (res.status === 429) serverMessage.value = res.data?.message || "";
}

// Lista de espera (cupos llenos)
const waitEmail = ref("");
const waitError = ref("");
const waitBusy = ref(false);
async function submitWaitlist() {
  if (waitBusy.value) return;
  if (!isValidEmail(waitEmail.value.trim())) {
    waitError.value = "Revisa tu email, parece incompleto.";
    shake.value++;
    return;
  }
  waitError.value = "";
  waitBusy.value = true;
  const res = props.event?.is_demo ? { ok: true } : await joinWaitlist(props.event, { email: waitEmail.value, kind: "full" });
  waitBusy.value = false;
  if (res.ok) {
    status.value = "waitlist_ok";
    liveMessage.value = `Listo. Te escribimos a ${waitEmail.value.trim()} si se libera un cupo.`;
  } else {
    waitError.value = res.network ? "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo." : res.data?.message || "Algo falló de nuestro lado. Inténtalo en unos segundos.";
  }
}

function retry() {
  status.value = "idle";
  serverMessage.value = "";
  submit();
}

// El asistente IA puede prellenar los datos (fill_buyer_information)
function handleAssistantFill(data) {
  const full = [data?.first_name, data?.last_name].filter(Boolean).join(" ");
  if (full) name.value = full;
  if (data?.email) email.value = data.email;
  if (data?.quantity && Number(data.quantity) > 1) {
    showGuests.value = true;
    quantity.value = Math.min(Number(data.quantity), maxGuests.value);
  }
  remembered.value = null;
}

watch(status, (s) => emit("state", s));
watch(email, () => {
  if (status.value === "full" && !waitEmail.value) waitEmail.value = email.value;
});

onMounted(() => {
  remembered.value = rememberedBuyer();
  if (remembered.value) {
    name.value = remembered.value.name;
    email.value = remembered.value.email;
  }
  waitEmail.value = remembered.value?.email || "";
  // Ya confirmó en este navegador: mostrar el estado de éxito directamente
  const previous = storedOrders(props.event.id).filter((o) => !(Number(o.amount) > 0)).at(-1);
  if (previous && status.value === "idle") {
    alreadyFromStorage.value = true;
    result.value = { orderId: previous.orderId, quantity: previous.ticketsCount || 1, name: previous.name || remembered.value?.name || "", email: previous.email || remembered.value?.email || "" };
    status.value = "success";
  }
  eventBus.on("fill-buyer-info", handleAssistantFill);
  emit("state", status.value);
});
onBeforeUnmount(() => {
  eventBus.off("fill-buyer-info", handleAssistantFill);
  stopNudge();
});

// ---- A30: si nadie toca el formulario, el botón "Confirmar asistencia" se mueve para llamar la atención ----
// Solo si está en pantalla: a los 4 s y luego cada 8 s, máximo 3 veces. Se detiene al interactuar.
const ctaBtn = ref(null);
const NUDGE_FIRST_MS = 4000;
const NUDGE_EVERY_MS = 8000;
const NUDGE_MAX = 3;
let nudgeTimer = null;
let nudgeCount = 0;
function stopNudge() {
  clearTimeout(nudgeTimer);
  nudgeTimer = null;
}
function onScreen(el) {
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
}
function scheduleNudge(delay) {
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(runNudge, delay);
}
function runNudge() {
  const btn = ctaBtn.value;
  if (!btn || started || status.value !== "idle" || nudgeCount >= NUDGE_MAX) return stopNudge();
  if (onScreen(btn) && document.visibilityState === "visible") {
    nudgeCount++;
    btn.classList.remove("ev-nudge");
    void btn.offsetWidth; // reinicia la animación
    btn.classList.add("ev-nudge");
    btn.addEventListener("animationend", () => btn.classList.remove("ev-nudge"), { once: true });
  }
  scheduleNudge(NUDGE_EVERY_MS);
}
onMounted(() => {
  if (props.mode !== "form" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  scheduleNudge(NUDGE_FIRST_MS);
});
watch(status, (s) => s !== "idle" && stopNudge());
</script>

<template>
  <AutoHeight>
    <p class="sr-only" aria-live="assertive">{{ liveMessage }}</p>
    <Transition name="swap">
      <!-- Formulario -->
      <form
        v-if="status === 'idle' || status === 'submitting' || status === 'error'"
        key="form"
        class="rsvp"
        novalidate
        @submit.prevent="submit"
        @focusin="onFocusForm"
      >
        <div v-if="freeTickets.length > 1" class="chips" role="radiogroup" aria-label="Tipo de entrada">
          <button
            v-for="t in freeTickets"
            :key="t.id"
            type="button"
            role="radio"
            class="chip"
            :aria-checked="String(selectedTicket?.id) === String(t.id)"
            :class="{ 'is-on': String(selectedTicket?.id) === String(t.id) }"
            :disabled="busy"
            @click="selectedTicketId = t.id"
          >{{ chipLabel(t) }}</button>
        </div>

        <div v-if="remembered" class="remembered">
          Confirmando como <strong>{{ firstNameOf(remembered.name) }}</strong> ({{ remembered.email }}) ·
          <button type="button" class="ev-link remembered-change" @click="useRememberedChange">Cambiar</button>
        </div>

        <template v-else>
          <div>
            <label class="ev-label" :for="`rsvp-name-${event.id}`">Nombre y apellido</label>
            <input
              :id="`rsvp-name-${event.id}`"
              ref="nameInput"
              v-model="name"
              class="ev-field"
              :class="errors.name ? shakeClass : ''"
              type="text"
              name="name"
              autocomplete="name"
              autocapitalize="words"
              maxlength="160"
              :readonly="busy"
              :aria-invalid="errors.name ? 'true' : 'false'"
              :aria-describedby="errors.name ? `rsvp-name-err-${event.id}` : undefined"
              @blur="onBlurName"
              @input="onInputName"
            />
            <div class="ev-collapse" :class="{ 'is-open': errors.name }">
              <div><p :id="`rsvp-name-err-${event.id}`" class="ev-error">{{ errors.name }}</p></div>
            </div>
          </div>

          <div>
            <label class="ev-label" :for="`rsvp-email-${event.id}`">Email</label>
            <input
              :id="`rsvp-email-${event.id}`"
              ref="emailInput"
              v-model="email"
              class="ev-field"
              :class="errors.email ? shakeClass : ''"
              type="email"
              name="email"
              inputmode="email"
              autocomplete="email"
              autocapitalize="off"
              spellcheck="false"
              maxlength="254"
              :readonly="busy"
              :aria-invalid="errors.email ? 'true' : 'false'"
              :aria-describedby="errors.email ? `rsvp-email-err-${event.id}` : undefined"
              @blur="onBlurEmail"
              @input="onInputEmail"
            />
            <div class="ev-collapse" :class="{ 'is-open': errors.email }">
              <div><p :id="`rsvp-email-err-${event.id}`" class="ev-error">{{ errors.email }}</p></div>
            </div>
            <div class="ev-collapse" :class="{ 'is-open': suggestion }">
              <div>
                <p class="suggest">
                  ¿Quisiste decir
                  <button type="button" class="suggest-btn" @click="applySuggestion">{{ suggestion }}</button>?
                </p>
              </div>
            </div>
          </div>
        </template>

        <div v-if="maxGuests > 1">
          <button v-if="!showGuests" type="button" class="ev-link guests-link" :disabled="busy" @click="showGuests = true">+ Llevo acompañantes</button>
          <div v-else class="guests">
            <span class="guests-label">Asistentes, contándote a ti</span>
            <QuantityStepper v-model="quantity" :min="1" :max="maxGuests" item-label="un asistente" :disabled="busy" />
          </div>
        </div>

        <div class="ev-collapse" :class="{ 'is-open': status === 'error' }">
          <div>
            <div class="alert" role="alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
              <span>{{ serverMessage }}</span>
            </div>
          </div>
        </div>

        <div ref="captchaEl" class="captcha"></div>

        <button
          v-if="status === 'error' && errorKind !== 'message'"
          type="button"
          class="ev-btn ev-btn-primary w-full"
          @click="retry"
        >Reintentar</button>
        <button v-else ref="ctaBtn" type="submit" class="ev-btn ev-btn-primary w-full" :aria-busy="busy ? 'true' : 'false'" :disabled="busy">
          <span v-if="busy" class="ev-spinner" aria-hidden="true"></span>
          <span>{{ ctaLabel }}</span>
        </button>

        <p class="legal">
          Al confirmar aceptas los <a href="/terms" target="_blank" rel="noopener">Términos</a> y la
          <a href="/privacy" target="_blank" rel="noopener">Política de privacidad</a>.
        </p>
        <p v-if="event.is_demo" class="demo-note">Demostración: no se crea ninguna entrada real.</p>
      </form>

      <!-- Éxito -->
      <div v-else-if="status === 'success'" key="success" class="success" role="status">
        <SuccessCheck />
        <h3 ref="successTitle" class="success-title" tabindex="-1">
          <template v-if="alreadyFromStorage">Ya confirmaste tu asistencia.</template>
          <template v-else>¡Listo{{ firstName ? `, ${firstName}` : "" }}! Estás dentro.</template>
        </h3>
        <p v-if="result.email" class="success-body">
          {{ alreadyFromStorage ? "Tu entrada con QR llegó a" : `Te enviamos ${result.quantity > 1 ? "tus entradas" : "tu entrada"} con QR a` }}<br />
          <strong>{{ result.email }}</strong>
        </p>
        <p v-if="event.is_demo" class="demo-note">Demostración: no se creó ninguna entrada ni se envió un correo.</p>
        <div class="success-actions">
          <button type="button" class="ev-btn ev-btn-secondary" @click="addToCalendar(event)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Añadir al calendario
          </button>
          <button type="button" class="ev-btn ev-btn-secondary" @click="shareEvent(event, { ref: 'invite', text: `Voy a ${event.name}, ¿vamos?` })">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>
            Invitar a alguien
          </button>
        </div>
        <a v-if="orderUrl" :href="orderUrl" class="ev-link success-link">Ver mi entrada →</a>
      </div>

      <!-- Ya inscrito con ese email -->
      <div v-else-if="status === 'already'" key="already" class="info" role="status">
        <div class="info-row">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
          <div>
            <p class="info-title">Ya estás inscrito con este email.</p>
            <p class="info-sub">{{ email }}</p>
          </div>
        </div>
        <button v-if="resendState !== 'sent'" type="button" class="ev-btn ev-btn-primary w-full" :aria-busy="resendState === 'sending' ? 'true' : 'false'" @click="resend">
          <span v-if="resendState === 'sending'" class="ev-spinner" aria-hidden="true"></span>
          Reenviar entrada
        </button>
        <p v-else class="info-done" role="status">{{ serverMessage || "Listo, revisa tu correo." }}</p>
        <button type="button" class="ev-link info-back" @click="status = 'idle'">Usar otro email</button>
      </div>

      <!-- Cupos llenos: lista de espera -->
      <form v-else-if="status === 'full'" key="full" class="rsvp" novalidate @submit.prevent="submitWaitlist">
        <div>
          <p class="info-title">{{ waitlistNote ? "Justo se acabaron los cupos." : "Se llenaron los cupos." }}</p>
          <p class="info-sub">{{ waitlistNote ? "¿Te avisamos si se libera uno?" : "Si alguien libera su lugar, te avisamos." }}</p>
        </div>
        <div>
          <label class="ev-label" :for="`wait-email-${event.id}`">Email</label>
          <input
            :id="`wait-email-${event.id}`"
            v-model="waitEmail"
            class="ev-field"
            :class="waitError ? shakeClass : ''"
            type="email"
            inputmode="email"
            autocomplete="email"
            :aria-invalid="waitError ? 'true' : 'false'"
            :aria-describedby="waitError ? `wait-err-${event.id}` : undefined"
            @input="waitError = ''"
          />
          <div class="ev-collapse" :class="{ 'is-open': waitError }">
            <div><p :id="`wait-err-${event.id}`" class="ev-error" role="alert">{{ waitError }}</p></div>
          </div>
        </div>
        <button type="submit" class="ev-btn ev-btn-primary w-full" :aria-busy="waitBusy ? 'true' : 'false'" :disabled="waitBusy">
          <span v-if="waitBusy" class="ev-spinner" aria-hidden="true"></span>
          Avisarme si se libera un cupo
        </button>
      </form>

      <div v-else-if="status === 'waitlist_ok'" key="waitlist-ok" class="success" role="status">
        <div class="bell" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
        </div>
        <p class="info-title">Listo. Te escribimos a {{ waitEmail.trim() }} si se libera un cupo.</p>
      </div>
    </Transition>
  </AutoHeight>
</template>

<style scoped>
.rsvp {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  min-height: 40px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text-1);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--dur-2), color var(--dur-2), transform var(--dur-2) var(--ease-spring);
}
.chip:hover {
  background: var(--surface-2);
}
.chip.is-on {
  background: var(--brand-ink);
  color: #fff;
  animation: chip-pop var(--dur-2) var(--ease-spring);
}
.chip:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
@keyframes chip-pop {
  from { transform: scale(0.96); }
  to { transform: scale(1); }
}
.remembered {
  font-size: 14px;
  line-height: 22px;
  color: var(--text-2);
  background: var(--surface-1);
  border-radius: var(--r-md);
  padding: 12px 14px;
}
.remembered strong {
  color: var(--text-1);
  font-weight: 600;
}
.remembered-change {
  font-size: 14px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.suggest {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-2);
}
.suggest-btn {
  font: inherit;
  font-weight: 600;
  color: var(--text-1);
  text-decoration: underline;
  text-underline-offset: 3px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.guests-link {
  font-size: 14px;
  padding: 4px 0;
  min-height: 32px;
}
.guests {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.guests-label {
  font-size: 14px;
  color: var(--text-2);
}
.alert {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: #fef3f2;
  color: #7a271a;
  border-radius: var(--r-md);
  padding: 12px;
  font-size: 14px;
  line-height: 20px;
}
.alert svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--danger-text);
}
.captcha:empty {
  display: none;
}
.legal {
  font-size: 12px;
  line-height: 18px;
  color: var(--text-3);
}
.legal a {
  color: var(--text-2);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.demo-note {
  font-size: 12px;
  color: #6b21a8;
}
.success {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 6px 0;
}
.success-title {
  font-family: "Prompt", system-ui, sans-serif;
  font-size: 20px;
  line-height: 26px;
  font-weight: 600;
  margin-top: 6px;
  outline: none;
}
.success-body {
  font-size: 14px;
  line-height: 21px;
  color: var(--text-2);
  word-break: break-word;
}
.success-body strong {
  color: var(--text-1);
  font-weight: 600;
}
.success-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  width: 100%;
  margin-top: 8px;
}
.success-actions .ev-btn {
  font-size: 14px;
  font-weight: 500;
  min-height: 44px;
}
.success-link {
  margin-top: 4px;
  font-size: 14px;
  padding: 8px;
}
.info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.info-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.info-row svg {
  flex: 0 0 auto;
  margin-top: 2px;
}
.info-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
}
.info-sub {
  font-size: 14px;
  color: var(--text-2);
  margin-top: 2px;
  word-break: break-word;
}
.info-done {
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  padding: 12px 0;
}
.info-back {
  align-self: center;
  font-size: 14px;
  color: var(--text-2);
  padding: 4px 8px;
}
.bell {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--surface-1);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* A18: el contenido viejo se desvanece y el nuevo entra desde abajo mientras la card ajusta su alto */
.swap-leave-active {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  transition: opacity 150ms var(--ease-out);
}
.swap-leave-to {
  opacity: 0;
}
.swap-enter-active {
  transition: opacity var(--dur-3) var(--ease-out) 150ms, transform var(--dur-3) var(--ease-out) 150ms;
}
.swap-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
@media (min-width: 640px) {
  .success-actions {
    grid-template-columns: 1fr 1fr;
  }
}
</style>

<script setup>
// Paso 2 del checkout (§6.4): resumen, "Tus datos" (2 campos), código de descuento colapsado y casilla de no
// retracto. El botón de pago vive en el footer del sheet y llama a submit(). Sin paso "Confirmar".
// Si el evento lo pide (events.checkout_fields), CheckoutExtras agrega asistentes por entrada, preguntas y datos de
// empresa después de "Tus datos".
import { ref, computed, onMounted, nextTick } from "vue";
import AnimatedNumber from "./AnimatedNumber.vue";
import QuantityStepper from "./QuantityStepper.vue";
import CheckoutExtras from "./CheckoutExtras.vue";
import { suggestEmail } from "./emailSuggest.js";
import { formatCLP, formatFunctionShort, ticketMax } from "./eventView.js";
import { createOrder, previewDiscount, rememberBuyer, rememberedBuyer, trackFunnel } from "./checkoutApi.js";
import { useTurnstile } from "./useTurnstile.js";
import { isValidEmail, normalizeDiscountCode } from "../Reservation/pricing.js";
import { LEGAL } from "../../lib/legal";
import { trackBeginCheckout } from "../../composables/useGoogleAnalytics.js";

const props = defineProps({
  event: { type: Object, required: true },
  lines: { type: Array, required: true }, // buildSelectedLines(...)
  totals: { type: Object, required: true }, // computeTotalsWithDiscount(...)
  discount: { type: Object, default: null },
  fn: { type: Object, default: null }, // función elegida (o la única)
  autoCode: { type: String, default: "" }, // ?code=XYZ
  canGoBack: { type: Boolean, default: false },
  qtyTicket: { type: Object, default: null }, // único tipo de entrada (sin paso 1): la cantidad se elige aquí
  buyerPrefill: { type: Object, default: null }, // { name, email } (asistente IA)
});
const emit = defineEmits(["update:discount", "update:qty", "busy", "back", "demo", "sold-out"]);

const name = ref("");
const email = ref("");
const withdrawal = ref(false);
const errors = ref({ name: "", email: "", withdrawal: "" });
const shake = ref(0);
const serverError = ref("");
const busy = ref(false);
const liveMessage = ref("");
const nameInput = ref(null);
const emailInput = ref(null);
const withdrawalInput = ref(null);
const captchaEl = ref(null);
const extrasRef = ref(null);
const captcha = useTurnstile(captchaEl, { disabled: () => Boolean(props.event?.is_demo) });

const isFree = computed(() => props.totals.total === 0);
const suggestion = computed(() => (errors.value.email ? "" : suggestEmail(email.value)));
const shakeClass = computed(() => (shake.value % 2 ? "ev-shake-a" : "ev-shake-b"));
const summaryOpen = ref(false);
// Línea a precio final (el mismo que se vio en el paso 1); el desglose exacto está en "Ver detalle"
const lineFinal = (l) => {
  const t = (props.event.tickets || []).find((x) => String(x.id) === String(l.id));
  return t?.final_price != null ? t.final_price * l.quantity : l.total;
};
const showConditions = ref(false);

// Cantidad del único tipo de entrada
const qty = computed(() => props.lines.find((l) => String(l.id) === String(props.qtyTicket?.id))?.quantity || 1);
const qtyMax = computed(() => (props.qtyTicket ? Math.max(1, ticketMax(props.qtyTicket)) : 1));

// ---- Código de descuento ----
const codeOpen = ref(false);
const codeInput = ref("");
const codeError = ref("");
const codeBusy = ref(false);
const canUseCode = computed(() => !props.event?.is_demo && props.totals.grossSubtotal > 0);

async function applyCode(raw = codeInput.value) {
  codeError.value = "";
  const code = normalizeDiscountCode(raw);
  if (!code) {
    codeError.value = "Este código no existe o ya venció.";
    return;
  }
  codeBusy.value = true;
  const res = await previewDiscount(props.event, code, props.lines.map((l) => ({ id: l.id, quantity: l.quantity })));
  codeBusy.value = false;
  const valid = res.ok && res.data?.valid;
  trackFunnel("checkout_code_apply", props.event, { valid: Boolean(valid) });
  if (!valid) {
    codeError.value = res.network ? "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo." : res.status === 429 ? res.data?.message || "Demasiados intentos." : "Este código no existe o ya venció.";
    codeOpen.value = true;
    codeInput.value = code;
    return;
  }
  emit("update:discount", { code: res.data.code, kind: res.data.kind, value: res.data.value, label: res.data.label });
  codeInput.value = "";
  codeOpen.value = false;
}
function removeCode() {
  emit("update:discount", null);
  codeError.value = "";
}

// ---- Validación y pago ----
function validate() {
  errors.value.name = name.value.trim().length >= 2 ? "" : "Escribe tu nombre.";
  errors.value.email = isValidEmail(email.value.trim()) ? "" : "Revisa tu email, parece incompleto.";
  errors.value.withdrawal = isFree.value || withdrawal.value ? "" : "Marca esta casilla para continuar.";
  return !errors.value.name && !errors.value.email && !errors.value.withdrawal;
}
const onBlurName = () => name.value.trim() && (errors.value.name = name.value.trim().length >= 2 ? "" : "Escribe tu nombre.");
const onBlurEmail = () => email.value.trim() && (errors.value.email = isValidEmail(email.value.trim()) ? "" : "Revisa tu email, parece incompleto.");

async function submit() {
  if (busy.value) return;
  trackFunnel("checkout_pay_click", props.event, { total: props.totals.total, qty: props.totals.quantity });
  if (!validate()) {
    shake.value++;
    liveMessage.value = [errors.value.name, errors.value.email, errors.value.withdrawal].filter(Boolean).join(" ");
    await nextTick();
    if (errors.value.name) nameInput.value?.focus();
    else if (errors.value.email) emailInput.value?.focus();
    else withdrawalInput.value?.focus();
    return;
  }
  const extrasError = await extrasRef.value?.validate();
  if (extrasError) {
    shake.value++;
    liveMessage.value = extrasError;
    return;
  }
  serverError.value = "";
  if (props.event?.is_demo) {
    emit("demo", { email: email.value.trim(), total: props.totals.total, free: isFree.value });
    return;
  }
  setBusy(true);
  rememberBuyer(name.value.trim(), email.value.trim());
  const cfToken = await captcha.getToken();
  const res = await createOrder({
    event: props.event,
    fullName: name.value,
    email: email.value,
    tickets: props.lines.map((l) => ({ id: l.id, quantity: l.quantity })),
    discountCode: props.discount && props.totals.discountAmount > 0 ? props.discount.code : undefined,
    cfToken,
    termsAccepted: true,
    ...(extrasRef.value?.payload() || {}),
  });
  if (res.ok && res.data?.paymentLink) {
    // Se mantiene "Redirigiendo a Webpay…" hasta que el navegador cambie de página
    window.location.href = res.data.paymentLink;
    return;
  }
  if (res.ok && res.data?.redirectUrl) {
    window.location.href = res.data.redirectUrl;
    return;
  }
  setBusy(false);
  captcha.reset();
  if (res.data?.discountError) {
    emit("update:discount", null);
    serverError.value = `${res.data.message || "El código de descuento ya no es válido."} Quitamos el código: revisa el nuevo total.`;
  } else if (res.data?.code === "SOLD_OUT") {
    emit("sold-out", res.data.message);
  } else if (res.data?.field && extrasRef.value) {
    extrasRef.value.showServerError(res.data.field, res.data.message);
  } else if (res.network) {
    serverError.value = "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.";
  } else if (res.status >= 400 && res.status < 500 && res.data?.message) {
    serverError.value = res.data.message;
  } else {
    serverError.value = "Algo falló de nuestro lado. Inténtalo en unos segundos.";
  }
  liveMessage.value = serverError.value;
}
function setBusy(v) {
  busy.value = v;
  emit("busy", v);
}
defineExpose({ submit });

onMounted(() => {
  const remembered = props.buyerPrefill || rememberedBuyer();
  if (remembered) {
    name.value = remembered.name || "";
    email.value = remembered.email || "";
  }
  summaryOpen.value = window.matchMedia?.("(min-width: 1024px)").matches ?? false;
  trackFunnel("checkout_step2_view", props.event, { total: props.totals.total, qty: props.totals.quantity });
  trackBeginCheckout(props.event.id, props.event.name, props.totals.quantity, props.totals.total);
  if (props.autoCode && canUseCode.value && !props.discount) applyCode(props.autoCode);
});
</script>

<template>
  <form class="pay" novalidate @submit.prevent="submit" @focusin="captcha.start()">
    <p class="sr-only" aria-live="assertive">{{ liveMessage }}</p>

    <button v-if="canGoBack" type="button" class="ev-link back" @click="emit('back')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      Volver
    </button>

    <!-- Cantidad (un solo tipo de entrada: no hay paso 1) -->
    <section v-if="qtyTicket" class="qty" aria-labelledby="pay-qty-title" data-testid="pay-qty">
      <div class="qty-info">
        <p id="pay-qty-title" class="qty-name">{{ qtyTicket.ticket_name }}</p>
        <p class="qty-price ev-tabular">{{ Number(qtyTicket.price) > 0 ? `${formatCLP(qtyTicket.final_price ?? qtyTicket.price)} por entrada` : "Gratis" }}</p>
      </div>
      <QuantityStepper
        :model-value="qty"
        :min="1"
        :max="qtyMax"
        :item-label="`una entrada ${qtyTicket.ticket_name}`"
        :disabled="busy"
        @update:model-value="emit('update:qty', $event)"
      />
    </section>

    <!-- Resumen -->
    <section class="summary" aria-labelledby="pay-summary-title">
      <button type="button" class="summary-head" :aria-expanded="summaryOpen ? 'true' : 'false'" aria-controls="pay-summary-body" @click="summaryOpen = !summaryOpen">
        <span id="pay-summary-title" class="block-title">Resumen</span>
        <span class="summary-total ev-tabular" data-testid="pay-summary-total">{{ totals.quantity }} {{ totals.quantity === 1 ? "entrada" : "entradas" }} · <AnimatedNumber :value="totals.total" /></span>
        <svg class="chev" :class="{ 'is-open': summaryOpen }" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <div id="pay-summary-body" class="ev-collapse" :class="{ 'is-open': summaryOpen }">
        <div>
          <p v-if="fn" class="summary-fn">{{ formatFunctionShort(fn) }}<template v-if="fn.venue?.name"> · {{ fn.venue.name }}</template></p>
          <ul class="summary-lines">
            <li v-for="l in lines" :key="l.id">
              <span>{{ l.quantity }} × {{ l.name }}<span v-if="l.functionLabel && !fn" class="line-fn"> · {{ l.functionLabel }}</span></span>
              <span class="ev-tabular">{{ l.total > 0 ? formatCLP(lineFinal(l)) : "Gratis" }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Tus datos -->
    <section class="block" aria-labelledby="pay-data-title">
      <h3 id="pay-data-title" class="block-title">Tus datos</h3>
      <div class="fields">
        <div>
          <label class="ev-label" :for="`pay-name-${event.id}`">Nombre y apellido</label>
          <input
            :id="`pay-name-${event.id}`"
            ref="nameInput"
            v-model="name"
            class="ev-field"
            :class="errors.name ? shakeClass : ''"
            type="text"
            autocomplete="name"
            autocapitalize="words"
            maxlength="160"
            :readonly="busy"
            :aria-invalid="errors.name ? 'true' : 'false'"
            :aria-describedby="errors.name ? `pay-name-err-${event.id}` : undefined"
            @blur="onBlurName"
            @input="errors.name = ''"
          />
          <div class="ev-collapse" :class="{ 'is-open': errors.name }">
            <div><p :id="`pay-name-err-${event.id}`" class="ev-error">{{ errors.name }}</p></div>
          </div>
        </div>
        <div>
          <label class="ev-label" :for="`pay-email-${event.id}`">Email</label>
          <input
            :id="`pay-email-${event.id}`"
            ref="emailInput"
            v-model="email"
            class="ev-field"
            :class="errors.email ? shakeClass : ''"
            type="email"
            inputmode="email"
            autocomplete="email"
            autocapitalize="off"
            spellcheck="false"
            maxlength="254"
            :readonly="busy"
            :aria-invalid="errors.email ? 'true' : 'false'"
            :aria-describedby="errors.email ? `pay-email-err-${event.id}` : `pay-email-help-${event.id}`"
            @blur="onBlurEmail"
            @input="errors.email = ''"
          />
          <div class="ev-collapse" :class="{ 'is-open': errors.email }">
            <div><p :id="`pay-email-err-${event.id}`" class="ev-error">{{ errors.email }}</p></div>
          </div>
          <p :id="`pay-email-help-${event.id}`" class="help">{{ isFree ? "Te enviaremos la entrada a este email." : "Te enviaremos las entradas a este email." }}</p>
          <div class="ev-collapse" :class="{ 'is-open': suggestion }">
            <div>
              <p class="suggest">¿Quisiste decir <button type="button" class="suggest-btn" @click="email = suggestion">{{ suggestion }}</button>?</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <CheckoutExtras ref="extrasRef" :event="event" :lines="lines" :paid="!isFree" :buyer-name="name" :buyer-email="email" :disabled="busy" />

    <!-- Código de descuento -->
    <section v-if="canUseCode || discount" class="block code">
      <div v-if="discount" class="code-applied" data-testid="resv-discount-line" role="status">
        <span>Código <strong>{{ discount.code }}</strong> aplicado<template v-if="totals.discountAmount > 0"> · −{{ formatCLP(totals.discountAmount) }}</template></span>
        <button type="button" class="ev-link code-remove" data-testid="resv-discount-remove" @click="removeCode">Quitar</button>
      </div>
      <template v-else>
        <button v-if="!codeOpen" type="button" class="ev-link code-toggle" @click="codeOpen = true">¿Tienes un código de descuento?</button>
        <div v-else class="code-form">
          <label class="sr-only" :for="`pay-code-${event.id}`">Código de descuento</label>
          <input
            :id="`pay-code-${event.id}`"
            v-model="codeInput"
            data-testid="resv-discount-input"
            class="ev-field code-input"
            type="text"
            maxlength="30"
            autocomplete="off"
            autocapitalize="characters"
            placeholder="Código"
            :aria-invalid="codeError ? 'true' : 'false'"
            :aria-describedby="codeError ? `pay-code-err-${event.id}` : undefined"
            @keydown.enter.prevent="applyCode()"
          />
          <button type="button" class="ev-btn ev-btn-secondary" data-testid="resv-discount-apply" :disabled="codeBusy || !codeInput.trim()" @click="applyCode()">
            <span v-if="codeBusy" class="ev-spinner ev-spinner-dark" aria-hidden="true"></span>
            Aplicar
          </button>
        </div>
        <p v-if="codeError" :id="`pay-code-err-${event.id}`" class="ev-error" role="alert">{{ codeError }}</p>
      </template>
    </section>

    <!-- Aceptación de términos + no retracto (solo compras pagadas). La identidad del proveedor está en /terms. -->
    <section v-if="!isFree" class="block">
      <div class="check" :class="errors.withdrawal ? shakeClass : ''">
        <input
          :id="`pay-withdrawal-${event.id}`"
          ref="withdrawalInput"
          v-model="withdrawal"
          data-testid="resv-terms-checkbox"
          type="checkbox"
          class="check-box"
          :aria-invalid="errors.withdrawal ? 'true' : 'false'"
          :aria-describedby="errors.withdrawal ? `pay-withdrawal-err-${event.id}` : undefined"
          @change="errors.withdrawal = ''"
        />
        <label :for="`pay-withdrawal-${event.id}`" class="check-label">
          Acepto los <a href="/terms" target="_blank" rel="noopener">Términos y condiciones</a> vigentes y entiendo que las entradas no tienen derecho a retracto.
        </label>
      </div>
      <button type="button" class="ev-link conditions-toggle" :aria-expanded="showConditions ? 'true' : 'false'" @click="showConditions = !showConditions">Ver condiciones</button>
      <div class="ev-collapse" :class="{ 'is-open': showConditions }">
        <div>
          <p class="conditions">
            {{ LEGAL.retractoNotice }}
            Al pagar aceptas los <a href="/terms" target="_blank" rel="noopener">Términos y Condiciones</a> y la
            <a href="/privacy" target="_blank" rel="noopener">Política de Privacidad</a>.
          </p>
        </div>
      </div>
      <div class="ev-collapse" :class="{ 'is-open': errors.withdrawal }">
        <div><p :id="`pay-withdrawal-err-${event.id}`" class="ev-error withdrawal-err">{{ errors.withdrawal }}</p></div>
      </div>
    </section>
    <p v-else class="legal">Al confirmar aceptas los <a href="/terms" target="_blank" rel="noopener">Términos</a> y la <a href="/privacy" target="_blank" rel="noopener">Política de privacidad</a>.</p>

    <div ref="captchaEl" class="captcha"></div>

    <div class="ev-collapse" :class="{ 'is-open': serverError }">
      <div>
        <div class="alert" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
          <span>{{ serverError }}</span>
        </div>
      </div>
    </div>
    <!-- Enter en un campo envía el formulario -->
    <button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Pagar</button>
  </form>
</template>

<style scoped>
.pay {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.back {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: var(--text-2);
  background: none;
  border: 0;
  padding: 4px 0;
  margin-bottom: -8px;
  cursor: pointer;
}
.block-title {
  font-size: 15px;
  font-weight: 600;
}
.block > .block-title {
  display: block;
  margin-bottom: 12px;
}
.qty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 12px 14px;
}
.qty-info {
  min-width: 0;
}
.qty-name {
  font-size: 15px;
  font-weight: 600;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.qty-price {
  font-size: 13px;
  line-height: 18px;
  color: var(--text-2);
}
.qty + .summary {
  margin-top: -12px;
}
.summary {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 4px 14px;
}
.summary-head {
  width: 100%;
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.summary-head .block-title {
  flex: 1;
}
.summary-total {
  font-size: 14px;
  color: var(--text-2);
}
.chev {
  transition: transform var(--dur-2) var(--ease-out);
  flex: 0 0 auto;
}
.chev.is-open {
  transform: rotate(180deg);
}
.summary-fn {
  font-size: 14px;
  color: var(--text-2);
  padding-bottom: 6px;
}
.summary-lines {
  padding-bottom: 12px;
}
.summary-lines li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 15px;
  padding: 2px 0;
}
.line-fn {
  color: var(--text-2);
  font-size: 13px;
}
.fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.help {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-2);
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
.code-toggle,
.conditions-toggle,
.code-remove {
  font-size: 14px;
  background: none;
  border: 0;
  padding: 4px 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.code-form {
  display: flex;
  gap: 8px;
}
.code-input {
  text-transform: uppercase;
}
.code-applied {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  background: color-mix(in srgb, var(--brand-lime) 22%, white);
  border-radius: var(--r-md);
  padding: 10px 12px;
  animation: ev-fade-up var(--dur-2) var(--ease-out);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.check-box {
  width: 22px;
  height: 22px;
  margin-top: 1px;
  accent-color: var(--brand-ink);
  flex: 0 0 auto;
  cursor: pointer;
}
.check-label {
  font-size: 15px;
  line-height: 22px;
  cursor: pointer;
}
.conditions-toggle {
  margin-left: 34px;
  color: var(--text-2);
}
.conditions {
  margin: 6px 0 0 34px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-2);
}
.check-label a,
.conditions a,
.legal a {
  color: var(--text-2);
  text-decoration: underline;
}
.withdrawal-err {
  margin-left: 34px;
}
.legal {
  font-size: 12px;
  line-height: 18px;
  color: var(--text-3);
}
.captcha:empty {
  display: none;
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
</style>

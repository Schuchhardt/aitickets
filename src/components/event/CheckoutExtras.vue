<script setup>
// Datos extra que pide el evento (events.checkout_fields, src/lib/checkoutFields.mjs), en el checkout pagado
// (CheckoutStepPay) y en el registro gratis (RsvpForm):
//   - Asistentes: nombre y correo de cada entrada cuando la compra trae más de un QR (o una mesa para varios) y el
//     evento pide nombres o tiene preguntas por persona. Cada uno recibe su entrada por correo. La primera vacía queda
//     a nombre de quien compra.
//     Con holders 'invite', de cada invitado solo se pide el correo (nombre opcional): completa sus datos desde su
//     correo (/ticket/<id>). El lugar de quien compra siempre se llena aquí.
//   - Preguntas al inscribirse (texto corto, una opción, sí o no), obligatorias u opcionales. Las por compra van en
//     "Antes de terminar"; las por persona, en cada asistente (con un solo QR, también en "Antes de terminar").
//   - Datos de empresa (RUT y razón social), opcionales y solo en compras pagadas. El comprobante NO es boleta ni
//     factura: se dice junto a los campos.
// Sin nada configurado no muestra nada. validate() usa las mismas reglas que el servidor; payload() arma lo que se
// manda a /api/purchase-ticket.
import { ref, computed, watch, nextTick } from "vue";
import QuestionFields from "./QuestionFields.vue";
import {
  normalizeCheckoutFields,
  holderSlots,
  asksHolders,
  invitesHolders,
  collectsHolders,
  requiresAttendeeData,
  validateHolders,
  validateAnswers,
  validateCompany,
  formatRut,
  isValidRut,
  COMPANY_RECEIPT_NOTE,
} from "../../lib/checkoutFields.mjs";

const props = defineProps({
  event: { type: Object, required: true },
  lines: { type: Array, required: true }, // [{ id, quantity, name }]
  paid: { type: Boolean, default: true },
  buyerName: { type: String, default: "" },
  buyerEmail: { type: String, default: "" },
  disabled: { type: Boolean, default: false },
});

const fields = computed(() => normalizeCheckoutFields(props.event?.checkout_fields));
const peopleOf = (id) => Number((props.event?.tickets || []).find((t) => String(t.id) === String(id))?.people_per_ticket) || 1;
const slots = computed(() => holderSlots(props.lines, peopleOf));
const showHolders = computed(() => asksHolders(fields.value, slots.value.length));
const invite = computed(() => invitesHolders(fields.value, slots.value.length));
const guestEmailRequired = computed(() => requiresAttendeeData(fields.value));
const orderQs = computed(() => fields.value.questions.filter((q) => q.per !== "attendee"));
const personQs = computed(() => fields.value.questions.filter((q) => q.per === "attendee"));
// Con un solo QR, las preguntas por persona son de quien compra: van junto a las de la compra
const ownPersonQs = computed(() => (!showHolders.value && collectsHolders(fields.value, slots.value.length) ? personQs.value : []));
const showQuestions = computed(() => orderQs.value.length > 0 || ownPersonQs.value.length > 0);
const showCompany = computed(() => fields.value.company && props.paid);
/** ¿Este lugar lo completa su invitado desde el correo? (Nunca el de quien compra.) */
const isGuest = (i) => invite.value && i > 0;

const holders = ref([]);
watch(
  () => slots.value.length,
  (n) => {
    const next = holders.value.slice(0, n);
    while (next.length < n) next.push({ name: "", email: "", answers: {} });
    holders.value = next;
  },
  { immediate: true },
);
const answers = ref({});
const companyOpen = ref(false);
const company = ref({ rut: "", name: "" });
const error = ref("");
const errorField = ref("");
const root = ref(null);

const slotLabel = (s, i) => {
  if (s.people > 1) return `${s.ticketName} · invitado ${s.seat} de ${s.people}`;
  return slots.value.filter((x) => x.ticketId === s.ticketId).length > 1 || new Set(slots.value.map((x) => x.ticketId)).size > 1
    ? `Entrada ${i + 1} · ${s.ticketName}`
    : `Entrada ${i + 1}`;
};
const firstPlaceholder = computed(() => (props.buyerName.trim() ? `${props.buyerName.trim()} (tú)` : "Tú"));
const holdersHelp = computed(() => {
  if (invite.value) {
    return `Escribe el correo de cada invitado: le llega su entrada con QR y ahí completa ${personQs.value.length ? "su nombre y sus datos" : "su nombre"}. Tus datos los completas aquí.`;
  }
  return `Cada uno recibe su entrada con QR en su correo.${fields.value.attendee_names === "required" || personQs.value.some((q) => q.required) ? "" : " Puedes dejarlos en blanco."}`;
});
const clearError = (field) => {
  if (errorField.value === field) error.value = "";
};

function onRutBlur() {
  if (isValidRut(company.value.rut)) company.value.rut = formatRut(company.value.rut);
}

function payload() {
  const out = {};
  if (collectsHolders(fields.value, slots.value.length)) {
    out.holders = slots.value.map((s, i) => ({
      ticket_id: s.ticketId,
      name: showHolders.value ? holders.value[i]?.name?.trim() || "" : "",
      email: showHolders.value ? holders.value[i]?.email?.trim() || "" : "",
      ...(personQs.value.length && !isGuest(i) ? { answers: { ...(holders.value[i]?.answers || {}) } } : {}),
    }));
  }
  if (orderQs.value.length) out.answers = { ...answers.value };
  if (showCompany.value && companyOpen.value && (company.value.rut.trim() || company.value.name.trim())) {
    out.company = { rut: company.value.rut.trim(), name: company.value.name.trim() };
  }
  return out;
}

// Con un solo QR los errores de las preguntas por persona se muestran junto a las preguntas
const sectionOf = (field) => (field === "holders" && !showHolders.value ? "answers" : field);

/** Valida con las reglas del servidor. Devuelve el mensaje del primer error ("" si está todo bien) y lo enfoca. */
async function validate() {
  const p = payload();
  const checks = [
    ["holders", validateHolders(fields.value, slots.value, p.holders, { name: props.buyerName, email: props.buyerEmail })],
    ["answers", validateAnswers(fields.value, p.answers)],
    ["company", validateCompany(fields.value, p.company, { paid: props.paid })],
  ];
  const failed = checks.find(([, c]) => c.error);
  error.value = failed ? failed[1].error : "";
  errorField.value = failed ? sectionOf(failed[0]) : "";
  if (failed) {
    await nextTick();
    root.value?.querySelector(`[data-extras="${errorField.value}"] input, [data-extras="${errorField.value}"] select, [data-extras="${errorField.value}"] button`)?.focus();
  }
  return error.value;
}

/** Error del servidor (400 con field) para mostrarlo junto a su sección. */
function showServerError(field, message) {
  errorField.value = sectionOf(field);
  error.value = message;
}

defineExpose({ validate, payload, showServerError });
</script>

<template>
  <div v-if="showHolders || showQuestions || showCompany" ref="root" class="extras">
    <!-- Asistentes -->
    <section v-if="showHolders" class="block" data-extras="holders" data-testid="checkout-holders" aria-labelledby="extras-holders-title">
      <h3 id="extras-holders-title" class="block-title">{{ slots.length > 1 ? "¿Quiénes van?" : "Asistente" }}</h3>
      <p class="help" data-testid="holders-help">{{ holdersHelp }}</p>
      <ol class="holders">
        <li v-for="(s, i) in slots" :key="`${s.ticketId}-${s.unit}-${s.seat}`" class="holder" :data-guest="isGuest(i) ? 'true' : undefined">
          <p class="holder-label">{{ slotLabel(s, i) }}</p>
          <div class="holder-fields">
            <label class="sr-only" :for="`holder-name-${event.id}-${i}`">Nombre del asistente {{ i + 1 }}</label>
            <input
              :id="`holder-name-${event.id}-${i}`"
              v-model="holders[i].name"
              class="ev-field"
              type="text"
              autocomplete="off"
              autocapitalize="words"
              maxlength="120"
              :placeholder="i === 0 ? firstPlaceholder : isGuest(i) ? 'Nombre (opcional)' : 'Nombre y apellido'"
              :readonly="disabled"
              data-testid="holder-name"
              @input="clearError('holders')"
            />
            <label class="sr-only" :for="`holder-email-${event.id}-${i}`">Correo del asistente {{ i + 1 }}</label>
            <input
              :id="`holder-email-${event.id}-${i}`"
              v-model="holders[i].email"
              class="ev-field"
              type="email"
              inputmode="email"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              maxlength="254"
              :placeholder="i === 0 ? 'Tu correo' : isGuest(i) && guestEmailRequired ? 'Su correo' : 'Correo (opcional)'"
              :readonly="disabled"
              data-testid="holder-email"
              @input="clearError('holders')"
            />
          </div>
          <QuestionFields
            v-if="personQs.length && !isGuest(i)"
            :questions="personQs"
            :answers="holders[i].answers"
            :id-prefix="`hq-${event.id}-${i}`"
            :disabled="disabled"
            class="holder-questions"
            data-testid="holder-questions"
            @change="clearError('holders')"
          />
          <p v-else-if="personQs.length" class="help" data-testid="holder-invite-note">Completa sus datos desde el correo.</p>
        </li>
      </ol>
      <p v-if="errorField === 'holders' && error" class="ev-error" role="alert">{{ error }}</p>
    </section>

    <!-- Preguntas al inscribirse -->
    <section v-if="showQuestions" class="block" data-extras="answers" data-testid="checkout-questions" aria-labelledby="extras-questions-title">
      <h3 id="extras-questions-title" class="block-title">Antes de terminar</h3>
      <QuestionFields v-if="ownPersonQs.length" :questions="ownPersonQs" :answers="holders[0].answers" :id-prefix="`hq-${event.id}-0`" :disabled="disabled" @change="clearError('answers')" />
      <QuestionFields v-if="orderQs.length" :questions="orderQs" :answers="answers" :id-prefix="`q-${event.id}`" :disabled="disabled" @change="clearError('answers')" />
      <p v-if="errorField === 'answers' && error" class="ev-error" role="alert">{{ error }}</p>
    </section>

    <!-- Datos de empresa (opcionales) -->
    <section v-if="showCompany" class="block" data-extras="company" data-testid="checkout-company">
      <button v-if="!companyOpen" type="button" class="ev-link company-toggle" :disabled="disabled" @click="companyOpen = true">¿Compras para una empresa?</button>
      <template v-else>
        <h3 class="block-title">Datos de la empresa <span class="optional">(opcional)</span></h3>
        <div class="company-fields">
          <div>
            <label class="ev-label" :for="`company-rut-${event.id}`">RUT</label>
            <input :id="`company-rut-${event.id}`" v-model="company.rut" class="ev-field" type="text" inputmode="text" autocomplete="off" maxlength="12" placeholder="76.123.456-0" :readonly="disabled" data-testid="company-rut" @blur="onRutBlur" @input="clearError('company')" />
          </div>
          <div>
            <label class="ev-label" :for="`company-name-${event.id}`">Razón social</label>
            <input :id="`company-name-${event.id}`" v-model="company.name" class="ev-field" type="text" autocomplete="organization" maxlength="160" :readonly="disabled" data-testid="company-name" @input="clearError('company')" />
          </div>
        </div>
        <p class="help" data-testid="company-note">{{ COMPANY_RECEIPT_NOTE }}</p>
        <p v-if="errorField === 'company' && error" class="ev-error" role="alert">{{ error }}</p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.extras {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.block-title {
  display: block;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}
.help {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-2);
}
.optional {
  font-weight: 400;
  color: var(--text-2);
}
.holders {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}
.holder-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: 6px;
}
.holder-fields,
.company-fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
@media (min-width: 480px) {
  .holder-fields,
  .company-fields {
    grid-template-columns: 1fr 1fr;
  }
}
.company-fields {
  margin-top: 8px;
}
.holder-questions {
  padding-left: 12px;
  border-left: 2px solid var(--border-strong);
}
.company-toggle {
  font-size: 14px;
  background: none;
  border: 0;
  padding: 4px 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>

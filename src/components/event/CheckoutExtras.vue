<script setup>
// Datos extra que pide el evento (events.checkout_fields, src/lib/checkoutFields.mjs), en el checkout pagado
// (CheckoutStepPay) y en el registro gratis (RsvpForm):
//   - Asistentes: nombre y correo de cada entrada cuando la compra trae más de un QR (o una mesa para varios). Cada
//     uno recibe su entrada por correo. La primera vacía queda a nombre de quien compra.
//   - Preguntas al inscribirse (texto corto, una opción, sí o no), obligatorias u opcionales.
//   - Datos de empresa (RUT y razón social), opcionales y solo en compras pagadas. El comprobante NO es boleta ni
//     factura: se dice junto a los campos.
// Sin nada configurado no muestra nada. validate() usa las mismas reglas que el servidor; payload() arma lo que se
// manda a /api/purchase-ticket.
import { ref, computed, watch, nextTick } from "vue";
import {
  normalizeCheckoutFields,
  holderSlots,
  asksHolders,
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
const questions = computed(() => fields.value.questions);
const showCompany = computed(() => fields.value.company && props.paid);

const holders = ref([]);
watch(
  () => slots.value.length,
  (n) => {
    const next = holders.value.slice(0, n);
    while (next.length < n) next.push({ name: "", email: "" });
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

function onRutBlur() {
  if (isValidRut(company.value.rut)) company.value.rut = formatRut(company.value.rut);
}

function payload() {
  const out = {};
  if (showHolders.value) {
    out.holders = slots.value.map((s, i) => ({ ticket_id: s.ticketId, name: holders.value[i]?.name?.trim() || "", email: holders.value[i]?.email?.trim() || "" }));
  }
  if (questions.value.length) out.answers = { ...answers.value };
  if (showCompany.value && companyOpen.value && (company.value.rut.trim() || company.value.name.trim())) {
    out.company = { rut: company.value.rut.trim(), name: company.value.name.trim() };
  }
  return out;
}

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
  errorField.value = failed ? failed[0] : "";
  if (failed) {
    await nextTick();
    root.value?.querySelector(`[data-extras="${failed[0]}"] input, [data-extras="${failed[0]}"] select, [data-extras="${failed[0]}"] button`)?.focus();
  }
  return error.value;
}

/** Error del servidor (400 con field) para mostrarlo junto a su sección. */
function showServerError(field, message) {
  errorField.value = field;
  error.value = message;
}

defineExpose({ validate, payload, showServerError });
</script>

<template>
  <div v-if="showHolders || questions.length || showCompany" ref="root" class="extras">
    <!-- Asistentes -->
    <section v-if="showHolders" class="block" data-extras="holders" data-testid="checkout-holders" aria-labelledby="extras-holders-title">
      <h3 id="extras-holders-title" class="block-title">{{ slots.length > 1 ? "¿Quiénes van?" : "Asistente" }}</h3>
      <p class="help">Cada uno recibe su entrada con QR en su correo.{{ fields.attendee_names === "required" ? "" : " Puedes dejarlos en blanco." }}</p>
      <ol class="holders">
        <li v-for="(s, i) in slots" :key="`${s.ticketId}-${s.unit}-${s.seat}`" class="holder">
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
              :placeholder="i === 0 ? firstPlaceholder : 'Nombre y apellido'"
              :readonly="disabled"
              data-testid="holder-name"
              @input="errorField === 'holders' && (error = '')"
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
              :placeholder="i === 0 ? 'Tu correo' : 'Correo (opcional)'"
              :readonly="disabled"
              data-testid="holder-email"
              @input="errorField === 'holders' && (error = '')"
            />
          </div>
        </li>
      </ol>
      <p v-if="errorField === 'holders' && error" class="ev-error" role="alert">{{ error }}</p>
    </section>

    <!-- Preguntas al inscribirse -->
    <section v-if="questions.length" class="block" data-extras="answers" data-testid="checkout-questions" aria-labelledby="extras-questions-title">
      <h3 id="extras-questions-title" class="block-title">Antes de terminar</h3>
      <div class="questions">
        <div v-for="q in questions" :key="q.id">
          <template v-if="q.type === 'yes_no'">
            <p class="ev-label" :id="`q-${event.id}-${q.id}`">{{ q.label }}<span v-if="!q.required" class="optional"> (opcional)</span></p>
            <div class="yesno" role="radiogroup" :aria-labelledby="`q-${event.id}-${q.id}`">
              <button
                v-for="opt in ['Sí', 'No']"
                :key="opt"
                type="button"
                role="radio"
                class="chip"
                :class="{ 'is-on': answers[q.id] === opt }"
                :aria-checked="answers[q.id] === opt ? 'true' : 'false'"
                :disabled="disabled"
                @click="answers[q.id] = opt; errorField === 'answers' && (error = '')"
              >{{ opt }}</button>
            </div>
          </template>
          <template v-else-if="q.type === 'choice'">
            <label class="ev-label" :for="`q-${event.id}-${q.id}`">{{ q.label }}<span v-if="!q.required" class="optional"> (opcional)</span></label>
            <select :id="`q-${event.id}-${q.id}`" v-model="answers[q.id]" class="ev-field" :disabled="disabled" @change="errorField === 'answers' && (error = '')">
              <option :value="undefined" disabled>Elige una opción</option>
              <option v-for="opt in q.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </template>
          <template v-else>
            <label class="ev-label" :for="`q-${event.id}-${q.id}`">{{ q.label }}<span v-if="!q.required" class="optional"> (opcional)</span></label>
            <input :id="`q-${event.id}-${q.id}`" v-model="answers[q.id]" class="ev-field" type="text" maxlength="300" :readonly="disabled" @input="errorField === 'answers' && (error = '')" />
          </template>
        </div>
      </div>
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
            <input :id="`company-rut-${event.id}`" v-model="company.rut" class="ev-field" type="text" inputmode="text" autocomplete="off" maxlength="12" placeholder="76.123.456-0" :readonly="disabled" data-testid="company-rut" @blur="onRutBlur" @input="errorField === 'company' && (error = '')" />
          </div>
          <div>
            <label class="ev-label" :for="`company-name-${event.id}`">Razón social</label>
            <input :id="`company-name-${event.id}`" v-model="company.name" class="ev-field" type="text" autocomplete="organization" maxlength="160" :readonly="disabled" data-testid="company-name" @input="errorField === 'company' && (error = '')" />
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
.questions {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 8px;
}
.yesno {
  display: flex;
  gap: 8px;
}
.chip {
  min-width: 64px;
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface-0);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.chip.is-on {
  background: var(--brand-ink);
  border-color: var(--brand-ink);
  color: #fff;
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

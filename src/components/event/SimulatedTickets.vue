<script setup>
// Final de una compra simulada (isSimulatedCheckout: evento demo o vista previa de un borrador): lo que vería el
// asistente al terminar (pago o confirmación, correo, check-in) y sus entradas con un QR de MUESTRA. El QR lleva el
// sello "Muestra · No válido" y su contenido (SAMPLE_QR_PREFIX) nunca calza con uno real: el validador no lo encuentra.
// En el demo (lo ven productores que evalúan AI Tickets) suma qué ve el productor y el botón para crear su cuenta.
// Lo usan CheckoutSheet.vue (compra pagada) y SimulatedTicketsSheet.vue (registro gratis, RsvpForm).
import { ref, computed, onMounted } from "vue";
import SuccessCheck from "./SuccessCheck.vue";
import { firstNameOf, formatCLP } from "./eventView.js";

const props = defineProps({
  event: { type: Object, required: true },
  // { free, total, name, email, tickets: simulatedTickets(...) }
  result: { type: Object, required: true },
});
const emit = defineEmits(["close", "again"]);

const demo = computed(() => Boolean(props.event?.is_demo));
const noun = computed(() => (props.result.free ? "inscripción" : "compra"));
const subtitle = computed(() => {
  if (!demo.value) return `Así termina la ${noun.value} para tu asistente.`;
  const what = props.result.tickets?.length === 1 ? "su entrada" : "sus entradas";
  return `Así recibe ${what} quien ${props.result.free ? "se inscribe" : "compra"} en AI Tickets.`;
});
// Registro de productores desde el demo (misma atribución que el banner del evento demo)
const signupUrl = computed(() => `/organizadores/registro?utm_source=aitickets&utm_medium=demo_event&utm_campaign=${props.result.free ? "rsvp" : "checkout"}`);

// Con muchas entradas (o una mesa para 10) se muestran las primeras: cada una es igual a la anterior
const MAX_SHOWN = 3;
const shown = computed(() => (props.result.tickets || []).slice(0, MAX_SHOWN));
const hidden = computed(() => Math.max(0, (props.result.tickets || []).length - MAX_SHOWN));
const firstName = computed(() => firstNameOf(props.result.name));
const title = computed(() => {
  const lead = firstName.value ? `¡Listo, ${firstName.value}!` : "¡Listo!";
  if (props.result.free) return `${lead} Estás dentro.`;
  return `${lead} ${props.result.tickets?.length === 1 ? "Tu entrada está lista." : "Tus entradas están listas."}`;
});

const titleEl = ref(null);
defineExpose({ focusTitle: () => titleEl.value?.focus({ preventScroll: true }), titleEl });

// QR generados en el cliente con la librería del sitio (se carga solo al llegar aquí). Corrección de errores alta: el
// sello encima no impide leerlo, así quien prueba con el validador ve que el código no corresponde a ninguna entrada.
const qr = ref({});
const qrFailed = ref(false);
onMounted(async () => {
  try {
    const { default: QRCode } = await import("qrcode");
    const entries = await Promise.all(
      shown.value.map(async (t) => [t.key, await QRCode.toDataURL(t.code, { margin: 1, width: 352, errorCorrectionLevel: "H" })]),
    );
    qr.value = Object.fromEntries(entries);
  } catch {
    qrFailed.value = true;
  }
});
</script>

<template>
  <div class="sim" data-testid="sim-result">
    <div class="sim-head">
      <SuccessCheck :size="48" />
      <h3 ref="titleEl" class="sim-title" tabindex="-1">{{ title }}</h3>
      <p class="sim-sub">{{ subtitle }}</p>
    </div>

    <ol class="journey" aria-label="Qué pasa después">
      <li>
        <span class="step-dot" aria-hidden="true">1</span>
        <div>
          <p class="step-title">{{ result.free ? "Asistencia confirmada" : `Pago aprobado · ${formatCLP(result.total)}` }}</p>
          <p class="step-sub">{{ result.free ? "Al instante, sin pagar nada." : "En la compra real, el pago se hace en Webpay." }}</p>
        </div>
      </li>
      <li>
        <span class="step-dot" aria-hidden="true">2</span>
        <div>
          <p class="step-title">{{ result.tickets?.length === 1 ? "Entrada enviada por correo" : "Entradas enviadas por correo" }}</p>
          <p class="step-sub">A <strong>{{ result.email || "su email" }}</strong>, con el QR y un recordatorio 24 h antes.</p>
        </div>
      </li>
      <li>
        <span class="step-dot" aria-hidden="true">3</span>
        <div>
          <p class="step-title">Check-in con el QR</p>
          <p class="step-sub">{{ demo ? "En la puerta, el equipo del productor lo escanea desde el celular, incluso sin señal." : "En la puerta, tu equipo lo escanea desde el celular." }}</p>
        </div>
      </li>
      <li v-if="demo">
        <span class="step-dot" aria-hidden="true">4</span>
        <div>
          <p class="step-title">El productor lo ve al instante</p>
          <p class="step-sub">La venta aparece en su panel, con el canal que la trajo.</p>
        </div>
      </li>
    </ol>

    <section class="tickets" aria-labelledby="sim-tickets-title">
      <h4 id="sim-tickets-title" class="section-title">{{ result.tickets?.length === 1 ? "Su entrada" : "Sus entradas" }}</h4>
      <article v-for="t in shown" :key="t.key" class="ticket" data-testid="sim-ticket">
        <div class="ticket-main">
          <p class="t-type">{{ t.ticketName }}</p>
          <p class="t-event">{{ event.name }}</p>
          <p v-if="t.when" class="t-when">{{ t.when }}</p>
          <p v-if="t.where" class="t-where">{{ t.where }}</p>
          <div class="qr" :class="{ 'is-loading': !qr[t.key] && !qrFailed }">
            <img v-if="qr[t.key]" :src="qr[t.key]" alt="Código QR de muestra, no válido para entrar" width="176" height="176" data-testid="sim-qr" />
            <span v-else-if="qrFailed" class="qr-fallback">QR de muestra</span>
            <span class="qr-stamp" aria-hidden="true">Muestra · No válido</span>
          </div>
          <p class="t-hint">Muestra este código en la puerta</p>
        </div>
        <div class="ticket-foot">
          <span class="foot-holder">{{ [t.holder, t.guest].filter(Boolean).join(" · ") }}</span>
          <span class="foot-meta">{{ [t.seat, t.total > 1 ? `Entrada ${t.position} de ${t.total}` : ""].filter(Boolean).join(" · ") }}</span>
        </div>
      </article>
      <p v-if="hidden" class="more">+ {{ hidden }} {{ hidden === 1 ? "entrada más" : "entradas más" }}, cada una con su propio QR.</p>
    </section>

    <p class="sim-note">{{ demo ? "Demostración" : "Simulación" }}: no se creó ninguna orden, no se cobró nada ni se envió un correo. Este QR no sirve para entrar.</p>

    <div v-if="demo" class="actions">
      <a :href="signupUrl" class="ev-btn ev-btn-primary w-full" data-testid="sim-signup">Quiero vender entradas así</a>
      <div class="links">
        <button type="button" class="ev-link again" @click="emit('close')">Volver al evento</button>
        <span class="links-sep" aria-hidden="true">·</span>
        <button type="button" class="ev-link again" @click="emit('again')">Probar otra {{ noun }}</button>
      </div>
    </div>
    <div v-else class="actions">
      <button type="button" class="ev-btn ev-btn-primary w-full" @click="emit('close')">Volver al evento</button>
      <button type="button" class="ev-link again" @click="emit('again')">Probar otra {{ noun }}</button>
    </div>
  </div>
</template>

<style scoped>
.sim {
  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: ev-fade-up var(--dur-3) var(--ease-out) both;
}
.sim-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.sim-title {
  outline: none;
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
}
.sim-sub {
  font-size: 14px;
  line-height: 20px;
  color: var(--text-2);
}

/* Recorrido del asistente */
.journey {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 14px;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.journey li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.step-dot {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface-1);
  color: var(--text-1);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.step-title {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
.step-sub {
  font-size: 13px;
  line-height: 18px;
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.step-sub strong {
  color: var(--text-1);
  font-weight: 500;
}

/* Entradas: misma jerarquía que la tarjeta real (TicketInfo.vue) */
.tickets {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.section-title {
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-2);
}
.ticket {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-card);
  background: var(--surface-0);
  overflow: hidden;
}
.ticket-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 18px 14px;
  text-align: center;
}
.t-type {
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-2);
}
.t-event {
  margin-top: 4px;
  font-family: "Unbounded", system-ui, sans-serif;
  font-weight: 700;
  font-size: 15px;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.t-when {
  margin-top: 4px;
  font-size: 14px;
  line-height: 20px;
  color: var(--text-2);
}
.t-where {
  font-size: 12px;
  line-height: 18px;
  color: var(--text-3);
}
.qr {
  position: relative;
  margin-top: 14px;
  width: 176px;
  height: 176px;
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--surface-1);
  display: flex;
  align-items: center;
  justify-content: center;
}
.qr img {
  width: 100%;
  height: 100%;
  display: block;
}
.qr.is-loading {
  background: linear-gradient(90deg, var(--surface-1) 25%, var(--surface-2) 50%, var(--surface-1) 75%);
  background-size: 200% 100%;
  animation: ev-shimmer 1.2s linear infinite;
}
.qr-fallback {
  font-size: 13px;
  color: var(--text-2);
}
/* Sello diagonal: que ni en una captura de pantalla pase por una entrada válida */
.qr-stamp {
  position: absolute;
  left: -24px;
  right: -24px;
  top: 50%;
  transform: translateY(-50%) rotate(-18deg);
  padding: 5px 0;
  background: color-mix(in srgb, var(--danger) 92%, transparent);
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  pointer-events: none;
}
.t-hint {
  margin-top: 10px;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-3);
}
.ticket-foot {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-top: 1px dashed var(--border-strong);
  font-size: 12px;
  line-height: 16px;
  color: var(--text-2);
}
.foot-holder {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-1);
}
.foot-meta {
  flex: 0 0 auto;
}
.more {
  font-size: 13px;
  line-height: 18px;
  color: var(--text-2);
  text-align: center;
}
.sim-note {
  font-size: 12px;
  line-height: 18px;
  color: var(--text-3);
  text-align: center;
}
.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0 4px;
}
.links-sep {
  color: var(--text-3);
}
.again {
  min-height: 44px;
  padding: 0 8px;
  font: inherit;
  font-size: 14px;
  background: none;
  border: 0;
  cursor: pointer;
}
</style>

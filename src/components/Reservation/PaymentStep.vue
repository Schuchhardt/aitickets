<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { trackPurchase } from "../../composables/useGoogleAnalytics.js";
import { buildSelectedLines, computeTotals, formatCLP, readAttribution } from "./pricing.js";
import { LEGAL } from "../../lib/legal";

const props = defineProps({
  selectedTickets: Object,
  buyerInfo: Object,
  event: Object,
});

const isLoading = ref(false);
const errorMessage = ref("");
// Evento demo: se muestra todo el flujo, pero no se llama a la API de compra ni al proveedor de pago
const isDemo = computed(() => Boolean(props.event?.is_demo));
const demoCompleted = ref(false);

// ==== Cloudflare Turnstile (antiabuso). Sin site key configurada (desarrollo) no se exige. ====
const turnstileEl = ref(null);
const turnstileSiteKey = ref("");
const turnstileToken = ref("");
const turnstileReady = ref(false);
let turnstileWidgetId = null;
let turnstilePoll = null;

const loadTurnstileScript = () => {
  if (window.turnstile || document.getElementById("cf-turnstile-script")) return;
  const script = document.createElement("script");
  script.id = "cf-turnstile-script";
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
};

const renderTurnstile = () => {
  if (!window.turnstile || !turnstileEl.value || turnstileWidgetId !== null) return;
  turnstileWidgetId = window.turnstile.render(turnstileEl.value, {
    sitekey: turnstileSiteKey.value,
    language: "es",
    callback: (token) => { turnstileToken.value = token; },
    "expired-callback": () => { turnstileToken.value = ""; },
    "error-callback": () => { turnstileToken.value = ""; },
  });
  turnstileReady.value = true;
};

const resetTurnstile = () => {
  turnstileToken.value = "";
  if (window.turnstile && turnstileWidgetId !== null) {
    try { window.turnstile.reset(turnstileWidgetId); } catch { /* widget no disponible */ }
  }
};

onMounted(async () => {
  if (isDemo.value) return; // sin captcha ni medios de pago en la demo: no hay compra real
  let key = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || "";
  // Datos públicos del checkout: site key de Turnstile (si no se inyectó en el build) y medios de pago habilitados
  try {
    const slugQuery = props.event?.slug ? `?event=${encodeURIComponent(props.event.slug)}` : "";
    const res = await fetch(`/api/purchase-ticket${slugQuery}`, { method: "GET" });
    if (res.ok) {
      const info = await res.json();
      if (!key) key = info?.turnstileSiteKey || "";
      const providers = Array.isArray(info?.enabledProviders) ? info.enabledProviders.filter((p) => p === "flow" || p === "stripe") : [];
      if (providers.length) {
        enabledProviders.value = providers;
        if (!providers.includes(selectedProvider.value)) selectedProvider.value = providers[0];
      }
    }
  } catch { /* sin captcha; solo Flow */ }
  if (!key) return;
  turnstileSiteKey.value = key;
  loadTurnstileScript();
  turnstilePoll = setInterval(() => {
    if (window.turnstile) {
      clearInterval(turnstilePoll);
      turnstilePoll = null;
      renderTurnstile();
    }
  }, 100);
  setTimeout(() => { if (turnstilePoll) clearInterval(turnstilePoll); }, 15000);
});

onUnmounted(() => {
  if (turnstilePoll) clearInterval(turnstilePoll);
  if (window.turnstile && turnstileWidgetId !== null) {
    try { window.turnstile.remove(turnstileWidgetId); } catch { /* ya eliminado */ }
  }
});

// ==== Medio de pago. El servidor informa los habilitados (GET /api/purchase-ticket -> enabledProviders);
// sin Stripe habilitado el checkout es idéntico al de siempre (solo Webpay vía Flow). ====
const enabledProviders = ref(["flow"]);
const selectedProvider = ref("flow");
const showProviderSelector = computed(() => enabledProviders.value.includes("stripe") && enabledProviders.value.length > 1);
const PROVIDER_REDIRECT_COPY = {
  flow: "Serás redirigido a Webpay para pagar de forma segura.",
  stripe: "Serás redirigido a Stripe para pagar de forma segura con tu tarjeta.",
};

const needsCaptcha = computed(() => Boolean(turnstileSiteKey.value) && !turnstileToken.value);

const selectedTicketList = computed(() => buildSelectedLines(props.selectedTickets, props.event?.tickets, props.event?.dates));
const totals = computed(() => computeTotals(selectedTicketList.value));

const clearReservationStorage = () => {
  try {
    localStorage.removeItem(`selectedTickets_event_${props.event.id}`);
    localStorage.removeItem(`buyerInfo_event_${props.event.id}`);
    localStorage.removeItem(`currentStep_event_${props.event.id}`);
  } catch { /* storage no disponible */ }
};

// Guarda la orden gratis para el botón "Mis entradas" de la página del evento
const rememberFreeOrder = (orderId) => {
  try {
    const key = `purchase_event_${props.event.id}`;
    const orders = JSON.parse(localStorage.getItem(key) || "[]");
    if (!orders.some((o) => o.orderId === orderId)) {
      orders.push({
        orderId,
        eventId: props.event.id,
        eventSlug: props.event.slug,
        eventName: props.event.name,
        purchaseDate: new Date().toISOString(),
        amount: 0,
        ticketsCount: totals.value.quantity,
        tickets: [],
      });
      localStorage.setItem(key, JSON.stringify(orders));
    }
  } catch { /* storage no disponible */ }
};

const handlePayment = async () => {
  if (isLoading.value) return;
  if (isDemo.value) {
    demoCompleted.value = true;
    return;
  }
  if (turnstileSiteKey.value && !turnstileToken.value) {
    errorMessage.value = "Completa la verificación de seguridad para continuar.";
    return;
  }
  isLoading.value = true;
  errorMessage.value = "";

  const { ref: refCode, utm } = readAttribution();

  try {
    // Contrato C5: solo ids y cantidades; el servidor calcula precios y cargo
    const response = await fetch("/api/purchase-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: props.event.id,
        buyer: {
          firstName: (props.buyerInfo.firstName || "").trim(),
          lastName: (props.buyerInfo.lastName || "").trim(),
          email: (props.buyerInfo.email || "").trim(),
          phone: (props.buyerInfo.phone || "").trim() || undefined,
        },
        tickets: selectedTicketList.value.map((t) => ({ id: t.id, quantity: t.quantity })),
        ref: refCode,
        utm,
        cfToken: turnstileToken.value || undefined,
        paymentProvider: totals.value.total > 0 ? selectedProvider.value : undefined,
        termsAccepted: props.buyerInfo.termsAccepted === true,
        termsVersion: LEGAL.termsVersion,
      }),
    });

    let data = {};
    try { data = await response.json(); } catch { /* sin cuerpo */ }

    if (!response.ok) {
      throw new Error(data.message || "Ha ocurrido un error. Por favor intenta más tarde.");
    }

    if (data.paymentLink) {
      window.location.href = data.paymentLink; // Pago en Flow (Webpay) o Stripe Checkout
      return;
    }
    if (data.redirectUrl && data.orderId) {
      trackPurchase(data.orderId, props.event.id, props.event.name, totals.value.quantity, 0);
      rememberFreeOrder(data.orderId);
      clearReservationStorage();
      window.location.href = data.redirectUrl; // Orden gratis: /order/<id>
      return;
    }
    throw new Error("Ha ocurrido un error. Por favor intenta más tarde.");
  } catch (error) {
    errorMessage.value = error.message || "Ha ocurrido un error. Por favor intenta más tarde.";
    isLoading.value = false;
    // Cada token de Turnstile sirve una sola vez: pedir uno nuevo para reintentar
    resetTurnstile();
  }
};
</script>

<template>
  <div v-if="isDemo && demoCompleted" class="font-[Prompt] max-w-xl mx-auto text-center" data-testid="resv-demo-result">
    <div class="text-4xl mb-2" aria-hidden="true">🎟️</div>
    <h3 class="text-lg font-semibold mb-2">Así terminaría la compra</h3>
    <ol class="text-left text-sm text-gray-700 space-y-3 border rounded-lg p-4 mb-4">
      <li><strong>1. Pago seguro:</strong> te llevaríamos a Webpay para pagar {{ formatCLP(totals.total) }}.</li>
      <li><strong>2. Entradas por email:</strong> al confirmarse el pago, {{ buyerInfo.email || "el comprador" }} recibiría sus entradas con código QR y un recordatorio 24 h antes.</li>
      <li><strong>3. Check-in en la puerta:</strong> el equipo del productor escanea el QR desde el celular, incluso si se cae la señal.</li>
      <li><strong>4. Para el productor:</strong> ve la venta al instante en su panel, con el canal que la trajo, y recibe lo recaudado 48–72 h después de la función.</li>
    </ol>
    <p class="text-xs text-gray-500 mb-4">Esto es una demostración: no se creó ninguna orden ni se realizó ningún cobro.</p>
    <a
      href="/organizadores/registro?utm_source=aitickets&utm_medium=demo_event&utm_campaign=checkout"
      class="inline-block bg-black text-white px-6 py-3 rounded-md w-full"
    >Quiero vender entradas así</a>
    <button type="button" class="mt-3 text-sm underline text-gray-600" @click="demoCompleted = false">Volver al resumen</button>
  </div>
  <div v-else class="font-[Prompt] max-w-xl mx-auto">
    <h3 class="text-lg font-semibold mb-1 text-center">{{ totals.total > 0 ? "Revisa y paga" : "Confirma tu registro" }}</h3>
    <p class="text-gray-600 text-sm mb-4 text-center">Revisa tu pedido antes de continuar.</p>

    <div class="border p-4 rounded-lg text-left mb-4">
      <h4 class="font-semibold mb-2">Entradas</h4>
      <ul class="space-y-1">
        <li v-for="ticket in selectedTicketList" :key="ticket.id" class="flex justify-between gap-2">
          <span>
            {{ ticket.quantity }} x {{ ticket.name }}
            <span v-if="ticket.functionLabel" class="block text-xs text-gray-500">{{ ticket.functionLabel }}</span>
          </span>
          <span class="font-medium whitespace-nowrap">{{ ticket.total > 0 ? formatCLP(ticket.total) : "Gratis" }}</span>
        </li>
      </ul>
      <div class="border-t mt-3 pt-3 space-y-1 text-sm text-gray-600">
        <div class="flex justify-between">
          <span>Subtotal</span>
          <span>{{ totals.subtotal > 0 ? formatCLP(totals.subtotal) : "Gratis" }}</span>
        </div>
        <div v-if="totals.subtotal > 0" class="flex justify-between">
          <span>{{ LEGAL.serviceFeeLabel }} (10%)</span>
          <span>{{ formatCLP(totals.fee) }}</span>
        </div>
      </div>
      <div class="flex justify-between border-t mt-3 pt-3 text-lg font-bold">
        <span>Total a pagar</span>
        <span :class="totals.total > 0 ? 'text-green-700' : 'text-lime-600'">
          {{ totals.total > 0 ? `${formatCLP(totals.total)} CLP` : "Gratis" }}
        </span>
      </div>
    </div>

    <div class="border p-4 rounded-lg text-left mb-4 text-sm break-words">
      <h4 class="font-semibold mb-2 text-base">Comprador</h4>
      <p><strong>Nombre:</strong> {{ buyerInfo.firstName }} {{ buyerInfo.lastName }}</p>
      <p><strong>Email:</strong> {{ buyerInfo.email }}</p>
      <p v-if="buyerInfo.phone"><strong>Teléfono:</strong> {{ buyerInfo.phone }}</p>
    </div>

    <fieldset v-if="showProviderSelector && totals.total > 0 && !isDemo" class="border p-4 rounded-lg text-left mb-4">
      <legend class="font-semibold px-1">Medio de pago</legend>
      <label class="flex items-start gap-3 py-2 cursor-pointer" data-testid="resv-provider-flow">
        <input v-model="selectedProvider" type="radio" name="payment-provider" value="flow" class="mt-1 accent-black" />
        <span>
          <span class="block font-medium">Webpay</span>
          <span class="block text-xs text-gray-500">Tarjetas de débito y crédito chilenas.</span>
        </span>
      </label>
      <label class="flex items-start gap-3 py-2 cursor-pointer" data-testid="resv-provider-stripe">
        <input v-model="selectedProvider" type="radio" name="payment-provider" value="stripe" class="mt-1 accent-black" />
        <span>
          <span class="block font-medium">Tarjeta internacional / Apple Pay / Google Pay</span>
          <span class="block text-xs text-gray-500">Tarjeta internacional (procesado por Chanium LLC, EE.UU.; tu banco podría cobrar comisión por compra internacional)</span>
        </span>
      </label>
    </fieldset>

    <div v-if="turnstileSiteKey" ref="turnstileEl" class="flex justify-center mb-4 min-h-[65px]"></div>

    <p v-if="errorMessage" class="text-red-600 mb-4 text-center" role="alert">{{ errorMessage }}</p>

    <button
      data-testid="resv-pay-button"
      @click="handlePayment"
      :disabled="isLoading || !selectedTicketList.length || needsCaptcha"
      class="bg-black text-white px-6 py-3 rounded-md w-full cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {{ isLoading ? "Procesando..." : isDemo ? `Simular pago de ${formatCLP(totals.total)}` : totals.total > 0 ? `Ir a pagar ${formatCLP(totals.total)}` : "Finalizar registro" }}
    </button>
    <p v-if="isDemo" class="text-xs text-purple-700 text-center mt-2">Demo: no se realizará ningún cobro.</p>
    <p v-else-if="totals.total > 0" class="text-xs text-gray-500 text-center mt-2">{{ PROVIDER_REDIRECT_COPY[selectedProvider] || PROVIDER_REDIRECT_COPY.flow }}</p>
  </div>
</template>

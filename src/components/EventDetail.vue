<script setup>
// Página pública del evento (rediseño): el póster y el título protagonizan; una sola acción por estado.
// La usan /eventos/[slug], la vista previa privada y los sitios de productor (/o/[site]/eventos/[slug]).
// Piezas en src/components/event/. Lógica de estados y fechas: event/eventView.js.
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { trackViewItem } from "../composables/useGoogleAnalytics.js";
import { eventBus } from "../utils/eventbus.js";
import logo from "../images/logo.png";
import EventHero from "./event/EventHero.vue";
import EventActionCard from "./event/EventActionCard.vue";
import EventSections from "./event/EventSections.vue";
import MobileStickyBar from "./event/MobileStickyBar.vue";
import CheckoutSheet from "./event/CheckoutSheet.vue";
import EventGallery from "./EventGallery.vue";
import ShareEventModal from "./ShareEventModal.vue";
import PurchasedTicketsModal from "./PurchasedTicketsModal.vue";
import { cardState, stockSummary, minFinalPrice, formatCLP, formatSaleStart, readCheckoutParams } from "./event/eventView.js";
import { addToCalendar, shareEvent } from "./event/shareActions.js";
import { storedOrders, trackFunnel } from "./event/checkoutApi.js";

const props = defineProps({
  event: Object,
  // Sitio de productor (/o/<slug> o dominio propio): sin la barra ni el banner de adquisición de AI Tickets
  siteMode: { type: Boolean, default: false },
});

const state = computed(() => cardState(props.event));
const isFree = computed(() => state.value === "free" || state.value === "free_full");
const isPaidOnSale = computed(() => state.value === "paid_simple" || state.value === "paid_multi");
const stock = computed(() => stockSummary(props.event));
const fromPrice = computed(() => minFinalPrice(props.event));
const isPrivate = computed(() => props.event?.accessibility && props.event.accessibility !== "public");
const showAssistant = computed(() => !props.siteMode && !props.event?.is_preview);

// Tinte del póster (events.cover_meta, calculado en el servidor) y proporción real del póster
const tint = computed(() => props.event?.theme?.tint || null);
const posterRatio = computed(() => {
  const w = Number(props.event?.theme?.poster_width);
  const h = Number(props.event?.theme?.poster_height);
  return w > 0 && h > 0 ? { w, h, known: true } : { w: 4, h: 5, known: false };
});
const pageStyle = computed(() => ({
  ...(tint.value ? { "--event-tint": tint.value } : {}),
  "--poster-ar": `${posterRatio.value.w} / ${posterRatio.value.h}`,
  "--poster-ar-num": posterRatio.value.w / posterRatio.value.h,
}));

const badges = computed(() => {
  const list = [];
  const s = state.value;
  if (isFree.value) list.push({ label: "Gratis", tone: "lime" });
  else if (s === "paid_simple") list.push({ label: formatCLP(fromPrice.value), tone: "neutral" });
  else if (s === "paid_multi") list.push({ label: `Desde ${formatCLP(fromPrice.value)}`, tone: "neutral" });
  else if (s === "upcoming") list.push({ label: props.event.sale_starts_at ? `Venta abre el ${formatSaleStart(props.event.sale_starts_at, props.event.timezone)}` : "Venta próximamente", tone: "neutral" });
  else if (s === "sold_out") list.push({ label: "Agotado", tone: "neutral" });
  else if (s === "ended") list.push({ label: "Evento finalizado", tone: "neutral" });
  if (s === "free" && stock.value?.few) list.push({ label: `Quedan ${stock.value.remaining} ${stock.value.remaining === 1 ? "cupo" : "cupos"}`, tone: "warning", pulse: true });
  if (isPaidOnSale.value && stock.value?.few) list.push({ label: "Últimas entradas", tone: "warning", pulse: true });
  if (isPrivate.value) list.push({ label: "Evento privado", tone: "neutral" });
  return list;
});

// ---- Compra en dominio propio: el checkout vive en aitickets.cl ----
const externalUrl = ref("");
const isAiticketsHost = (host) =>
  host === "aitickets.cl" || host.endsWith(".aitickets.cl") || host === "localhost" || host === "127.0.0.1" || host.endsWith(".netlify.app");

// ---- Checkout ----
const checkout = ref(null); // initial del CheckoutSheet o null
let urlParams = { selection: {}, functionId: null, ticketId: null, code: null };
function openCheckout({ entry = "card", step = 1, selection = null, functionId = null, fromUrl = false } = {}) {
  if (!isPaidOnSale.value) return;
  if (externalUrl.value) {
    window.location.href = externalUrl.value;
    return;
  }
  eventBus.emit("assistant-hide");
  checkout.value = {
    entry,
    step,
    selection: selection || urlParams.selection,
    functionId: functionId || urlParams.functionId,
    ticketId: urlParams.ticketId,
    code: urlParams.code,
    fromUrl,
  };
}
function closeCheckout() {
  checkout.value = null;
  eventBus.emit("assistant-show");
}

// ---- Registro gratis: la barra lleva a la card ----
const card = ref(null);
const cardWrap = ref(null);
const rsvpState = ref("idle");
function goToCard() {
  const el = cardWrap.value;
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  setTimeout(() => card.value?.focusForm(), reduce ? 0 : 450);
}

// ---- Barra inferior (mobile) ----
const placeSentinel = ref(null);
const pastPlace = ref(false);
const cardVisible = ref(true);
let observers = [];
const showBar = computed(() => {
  if (isPaidOnSale.value) return pastPlace.value && !checkout.value;
  if (state.value === "free") return !cardVisible.value && !["success", "waitlist_ok", "already"].includes(rsvpState.value);
  return false;
});
const bar = computed(() => {
  if (state.value === "paid_simple") return { price: formatCLP(fromPrice.value), note: props.event.fee_absorbed ? "precio final por entrada" : "por entrada, incluye cargo", cta: "Comprar" };
  if (state.value === "paid_multi") return { price: `Desde ${formatCLP(fromPrice.value)}`, note: props.event.fee_absorbed ? "precio final por entrada" : "por entrada, incluye cargo", cta: "Elegir entradas" };
  return { price: "Gratis", note: stock.value?.few ? `Quedan ${stock.value.remaining} cupos` : "", warning: Boolean(stock.value?.few), cta: "Confirmar asistencia" };
});
function onBarAction() {
  if (isPaidOnSale.value) openCheckout({ entry: "sticky", step: state.value === "paid_simple" ? 2 : 1 });
  else goToCard();
}

// ---- Acciones secundarias ----
const showShareModal = ref(false);
async function onShare() {
  const result = await shareEvent(props.event);
  if (result === "fallback") showShareModal.value = true;
}
const orders = ref([]);
const showOrders = ref(false);
const refreshOrders = () => (orders.value = storedOrders(props.event.id));

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}
const openAssistant = () => eventBus.emit("assistant-open");

// El asistente IA abre el checkout (o enfoca el registro gratis) para prellenarlo
function onAssistantOpenCheckout() {
  if (isPaidOnSale.value) {
    if (!checkout.value) openCheckout({ entry: "assistant" });
  } else if (state.value === "free") goToCard();
}

const producerBannerUrl = computed(() => `/organizadores?utm_source=aitickets&utm_medium=event_footer&utm_campaign=${encodeURIComponent(props.event?.slug || "evento")}`);

onMounted(() => {
  const prices = (props.event.tickets || []).map((t) => Number(t.price) || 0);
  trackViewItem(props.event.id, props.event.name, prices.length ? Math.min(...prices) : 0);
  trackFunnel("event_view", props.event, { state: state.value });
  refreshOrders();
  eventBus.on("purchase-completed", refreshOrders);
  eventBus.on("open-modal", onAssistantOpenCheckout);

  if (props.siteMode && props.event?.purchase_url && !isAiticketsHost(window.location.hostname.toLowerCase())) {
    externalUrl.value = props.event.purchase_url;
  }

  // Deep links: ?checkout=1 (o ?comprar=1 de los sitios con dominio propio), ?funcion, ?entrada, ?code
  try {
    const url = new URL(window.location.href);
    const params = readCheckoutParams(url.searchParams);
    urlParams = params;
    const legacy = url.searchParams.get("comprar") === "1";
    if (legacy) {
      url.searchParams.delete("comprar");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    if (params.open || legacy) {
      if (isPaidOnSale.value) openCheckout({ entry: "deeplink", step: params.step, fromUrl: params.open });
      else if (state.value === "free") nextTick(goToCard);
    }
  } catch {
    /* URL no disponible */
  }

  if ("IntersectionObserver" in window) {
    if (placeSentinel.value) {
      const io = new IntersectionObserver(([entry]) => {
        if (!entry.isIntersecting && entry.boundingClientRect.top < 0) pastPlace.value = true;
      });
      io.observe(placeSentinel.value);
      observers.push(io);
    }
    if (cardWrap.value) {
      const io = new IntersectionObserver(([entry]) => (cardVisible.value = entry.isIntersecting), { threshold: 0.15 });
      io.observe(cardWrap.value);
      observers.push(io);
    }
  } else {
    pastPlace.value = true;
  }
});
onBeforeUnmount(() => {
  observers.forEach((o) => o.disconnect());
  eventBus.off("purchase-completed", refreshOrders);
  eventBus.off("open-modal", onAssistantOpenCheckout);
});

// En mobile la card de los eventos pagados a la venta no se muestra: la barra inferior abre el checkout
const cardHiddenOnMobile = computed(() => isPaidOnSale.value);
</script>

<template>
  <div v-if="event" class="ev-page ev-motion" :class="{ 'has-tint': tint }" :style="pageStyle">
    <div class="tint" aria-hidden="true"></div>

    <header v-if="!siteMode" class="topbar">
      <a href="/" class="topbar-logo" aria-label="AI Tickets, inicio">
        <img :src="logo.src" alt="AI Tickets" width="152" height="32" />
      </a>
      <nav class="topbar-nav" aria-label="Principal">
        <a href="/eventos">Eventos</a>
        <a href="/organizadores">Para organizadores</a>
      </nav>
      <button v-if="showAssistant" type="button" class="topbar-assistant" aria-label="Preguntarle al asistente" @click="openAssistant">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
      </button>
    </header>

    <div class="container">
      <p v-if="event.is_demo" class="banner banner-demo" role="note">
        Evento de demostración: puedes recorrer el flujo completo, no se cobra nada.
        <a href="/organizadores/registro?utm_source=aitickets&utm_medium=demo_event&utm_campaign=banner" class="ev-link">Crea tu evento gratis →</a>
      </p>
      <div
        v-if="event.is_preview"
        data-testid="event-preview-banner"
        :data-status="event.status"
        class="banner"
        :class="event.status === 'published' ? 'banner-info' : 'banner-warn'"
        role="status"
      >
        <p v-if="event.status === 'published'"><strong>Vista previa.</strong> Este evento ya está publicado: esta es la misma página que ve el público.</p>
        <p v-else><strong>Vista previa · Evento NO publicado (borrador).</strong> Solo quien tiene este link privado puede verlo. No aparece en búsquedas y la compra se habilita al publicarlo.</p>
        <a v-if="event.status === 'published'" :href="`/eventos/${event.slug}`" class="ev-link">Ver página pública →</a>
      </div>

      <div class="layout">
        <figure class="poster" :class="{ 'is-fallback': !posterRatio.known }" data-testid="event-cover">
          <img
            v-if="event.image_url"
            :src="event.image_url"
            :alt="event.name"
            :width="posterRatio.known ? posterRatio.w : undefined"
            :height="posterRatio.known ? posterRatio.h : undefined"
            fetchpriority="high"
            loading="eager"
            decoding="async"
          />
        </figure>

        <div class="hero-area">
          <EventHero :event="event" :badges="badges" @show-functions="scrollToId('funciones')" @show-location="scrollToId('ubicacion')" />
          <span ref="placeSentinel" class="sentinel" aria-hidden="true"></span>
        </div>

        <div class="aside" :class="{ 'hide-mobile': cardHiddenOnMobile }">
          <div ref="cardWrap" class="card-wrap">
            <EventActionCard
              ref="card"
              :event="event"
              :state="state"
              :external-url="externalUrl"
              :orders-count="orders.length"
              @checkout="openCheckout"
              @view-orders="showOrders = true"
              @rsvp-state="rsvpState = $event"
            />
            <div v-if="state !== 'ended' && rsvpState !== 'success'" class="secondary">
              <button type="button" class="secondary-btn" @click="onShare">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>
                Compartir
              </button>
              <span aria-hidden="true" class="secondary-sep">·</span>
              <button type="button" class="secondary-btn" @click="addToCalendar(event)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                Añadir al calendario
              </button>
            </div>
          </div>
        </div>

        <div class="main">
          <div v-if="cardHiddenOnMobile" class="secondary mobile-only">
            <button type="button" class="secondary-btn" @click="onShare">↗ Compartir</button>
            <span aria-hidden="true" class="secondary-sep">·</span>
            <button type="button" class="secondary-btn" @click="addToCalendar(event)">+ Añadir al calendario</button>
            <template v-if="orders.length">
              <span aria-hidden="true" class="secondary-sep">·</span>
              <button type="button" class="secondary-btn" @click="showOrders = true">Mis entradas ({{ orders.length }})</button>
            </template>
          </div>
          <EventSections
            :event="event"
            :can-buy="isPaidOnSale"
            :show-assistant="showAssistant"
            @choose-function="(id) => openCheckout({ entry: 'function_list', step: 1, functionId: String(id) })"
            @open-assistant="openAssistant"
          />
          <EventGallery v-if="event.gallery?.length" :images="event.gallery" :eventName="event.name" />
        </div>
      </div>

      <aside v-if="!siteMode && !event.is_preview" class="producer">
        <a :href="producerBannerUrl" class="ev-link">¿Organizas eventos? Vende con AI Tickets →</a>
      </aside>
      <div class="bar-space" aria-hidden="true"></div>
    </div>

    <MobileStickyBar :visible="showBar" :price="bar.price" :note="bar.note" :note-warning="bar.warning" :cta="bar.cta" @action="onBarAction" />

    <CheckoutSheet v-if="checkout" :event="event" :initial="checkout" @close="closeCheckout" />
    <ShareEventModal :show="showShareModal" :event="event" @close="showShareModal = false" />
    <PurchasedTicketsModal :show="showOrders" :eventOrders="orders" :event="event" @close="showOrders = false" />
  </div>
</template>

<style scoped>
.ev-page {
  position: relative;
  background: var(--surface-0);
  color: var(--text-1);
  font-family: "Prompt", system-ui, sans-serif;
  isolation: isolate;
}
/* A4: el tinte del póster entra con un fade */
.tint {
  position: absolute;
  inset: 0 0 auto 0;
  height: 640px;
  z-index: -1;
  background: linear-gradient(180deg, hsl(var(--event-tint)) 0%, var(--surface-0) 520px);
  animation: ev-fade-in 600ms ease both;
  pointer-events: none;
}
.topbar {
  max-width: 1080px;
  margin: 0 auto;
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.topbar-logo img {
  height: 26px;
  width: auto;
  display: block;
}
.topbar-logo:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 4px;
  border-radius: 4px;
}
.topbar-nav {
  display: none;
  gap: 24px;
  font-size: 14px;
  font-weight: 500;
}
.topbar-nav a {
  color: var(--text-2);
  text-decoration: none;
}
.topbar-nav a:hover {
  color: var(--text-1);
}
.topbar-assistant {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  border: 1px solid var(--border-strong);
  background: var(--surface-0);
  color: var(--text-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.topbar-assistant:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 8px 16px 0;
}
.banner {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  line-height: 19px;
  border-radius: var(--r-md);
  padding: 10px 14px;
  margin-bottom: 16px;
}
.banner-demo {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--text-2);
}
.banner-info {
  background: #f0f9ff;
  color: #0c4a6e;
}
.banner-warn {
  background: #fffbeb;
  color: #78350f;
  box-shadow: inset 0 0 0 1px #fcd34d;
}
.layout {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.poster {
  margin: 0 auto;
  width: min(100%, calc(min(680px, 78vh) * var(--poster-ar-num)));
  aspect-ratio: var(--poster-ar);
  border-radius: var(--r-xl);
  overflow: hidden;
  background: var(--surface-1);
  box-shadow: var(--shadow-card);
  /* A1 */
  animation: ev-poster-in var(--dur-4) var(--ease-out) both;
}
.poster img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.poster:not(.is-fallback) img {
  object-fit: cover; /* la proporción es la real: cover = contain sin bordes */
}
.sentinel {
  display: block;
  height: 1px;
}
.aside.hide-mobile {
  display: none;
}
/* A3 */
.card-wrap {
  animation: ev-fade-up-12 var(--dur-3) var(--ease-out) 160ms both;
}
.secondary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
  margin-top: 12px;
}
.secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 4px;
  font: inherit;
  font-size: 14px;
  color: var(--text-2);
  background: none;
  border: 0;
  cursor: pointer;
  border-radius: 4px;
}
.secondary-btn:hover {
  color: var(--text-1);
}
.secondary-btn:focus-visible {
  outline: 2px solid var(--text-1);
}
.secondary-sep {
  color: var(--text-3);
}
.main {
  margin-top: 20px;
  min-width: 0;
}
.main > .secondary {
  margin: -12px 0 28px;
  justify-content: flex-start;
}
.main :deep(.sections) + * {
  margin-top: 40px;
}
.producer {
  margin-top: 56px;
  border-top: 1px solid var(--border);
  padding: 24px 0;
  text-align: center;
  font-size: 14px;
}
.bar-space {
  height: 96px;
}

@media (min-width: 1024px) {
  .topbar {
    padding: 0 24px;
    height: 64px;
  }
  .topbar-nav {
    display: flex;
    margin-left: auto;
  }
  .topbar-assistant {
    display: none;
  }
  .container {
    padding: 16px 24px 0;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    grid-template-areas:
      "poster hero"
      "poster aside"
      "main aside";
    grid-template-rows: auto auto 1fr;
    column-gap: 48px;
    row-gap: 0;
  }
  .poster {
    grid-area: poster;
    margin: 0;
    align-self: start;
  }
  .hero-area {
    grid-area: hero;
    padding-top: 8px;
  }
  .aside,
  .aside.hide-mobile {
    display: block;
    grid-area: aside;
    align-self: stretch;
    padding-top: 24px;
  }
  /* La card queda visible mientras se lee la descripción, las funciones y las preguntas */
  .card-wrap {
    position: sticky;
    top: 24px;
  }
  .main {
    grid-area: main;
    margin-top: 56px;
  }
  .mobile-only {
    display: none !important;
  }
  .bar-space {
    height: 24px;
  }
}
</style>

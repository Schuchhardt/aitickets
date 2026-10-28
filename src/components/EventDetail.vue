<script setup>
// Página pública del evento (rediseño): el póster y el título protagonizan; una sola acción por estado.
// La usan /eventos/[slug], la vista previa privada y los sitios de productor (/o/[site]/eventos/[slug]).
// Piezas en src/components/event/. Lógica de estados y fechas: event/eventView.js.
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { trackViewItem } from "../composables/useGoogleAnalytics.js";
import { eventBus } from "../utils/eventbus.js";
import EventHero from "./event/EventHero.vue";
import EventActionCard from "./event/EventActionCard.vue";
import EventSections from "./event/EventSections.vue";
import MobileStickyBar from "./event/MobileStickyBar.vue";
import CheckoutSheet from "./event/CheckoutSheet.vue";
import EventGallery from "./EventGallery.vue";
import AutoplayVideo from "./event/AutoplayVideo.vue";
import EventReviews from "./event/EventReviews.vue";
import ShareSheet from "./event/ShareSheet.vue";
import { vReveal } from "./event/reveal.js";
import IridescenceBg from "./event/IridescenceBg.vue";
import { normalizePageSettings, pageBackgroundPreset } from "../lib/eventPageSettings";
import PurchasedTicketsModal from "./PurchasedTicketsModal.vue";
import { cardState, stockSummary, minFinalPrice, formatCLP, formatSaleStart, readCheckoutParams, upcomingFunctions, formatFunctionShort, readReviewHash, formatRating, reviewsCountLabel, cardFunctionChips, attendeeFeedUrl } from "./event/eventView.js";
import { addToCalendar } from "./event/shareActions.js";
import { cdnImage, cdnSrcset, EVENT_COVER_SIZES } from "../lib/imageCdn.js";
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

// Video de portada (events.cover_video, src/lib/eventVideo.ts): reemplaza la imagen en el póster y en la portada
// ancha. Se reproduce solo y sin sonido en pantalla (AutoplayVideo.vue); si no carga, vuelve la imagen.
const coverVideoFailed = ref(false);
const coverVideo = computed(() => (coverVideoFailed.value ? null : props.event?.cover_video || null));

// Diseño de la página elegido por el productor (events.page_settings): poster | banner | compact
const pageSettings = computed(() => normalizePageSettings(props.event?.page_settings));
const layout = computed(() => {
  if (!props.event?.image_url && !coverVideo.value) return "compact";
  // El video necesita espacio: el diseño compacto (miniatura junto al título) se muestra como póster
  if (coverVideo.value && pageSettings.value.layout === "compact") return "poster";
  return pageSettings.value.layout;
});
// Fondo animado (Iridescence) o, sin él, el tinte del póster
const bgPreset = computed(() => pageBackgroundPreset(pageSettings.value.background));

// ---- Desktop: al pasar la portada, una miniatura cuadrada se acopla sobre la card sticky ----
const coverEl = ref(null);
const docked = ref(false);
// Con video de portada y sin imagen, la miniatura es el póster del video
const dockImage = computed(() => props.event?.image_url || coverVideo.value?.poster_url || "");
const dockDate = computed(() => {
  const fn = upcomingFunctions(props.event)[0] || props.event?.dates?.[0];
  return fn ? formatFunctionShort(fn) : "";
});

// Portada ancha: alto y encuadre del ajuste de portada (events.cover_settings, CoverAdjuster.vue)
const bannerStyle = computed(() => {
  const c = props.event?.cover_settings || {};
  return {
    "--banner-h-m": `${c.mobile?.height || 340}px`,
    "--banner-h-d": `${c.desktop?.height || 480}px`,
    "--banner-pos-m": `50% ${c.mobile?.position_y ?? 50}%`,
    "--banner-pos-d": `50% ${c.desktop?.position_y ?? 50}%`,
  };
});
// Portada redimensionada por el CDN (src/lib/imageCdn.js); mismo srcset/sizes que la precarga del <head>
const coverSrc = computed(() => cdnImage(props.event?.image_url, 1080));
const coverSrcset = computed(() => cdnSrcset(props.event?.image_url));
const bannerContain = computed(() => props.event?.cover_settings?.desktop?.fit === "contain");

// Parallax suave de la imagen de portada ancha (desactivado con prefers-reduced-motion)
const bannerImg = ref(null);
let parallaxRaf = 0;
function onParallaxScroll() {
  if (parallaxRaf) return;
  parallaxRaf = requestAnimationFrame(() => {
    parallaxRaf = 0;
    const y = Math.min(window.scrollY, 800);
    if (bannerImg.value) bannerImg.value.style.transform = `translate3d(0, ${y * 0.18}px, 0) scale(${1 + y * 0.00012})`;
  });
}

// Imagen completa (diseño compacto: la miniatura abre la imagen)
const showImage = ref(false);
const onImageKey = (e) => e.key === "Escape" && (showImage.value = false);

// Tinte del póster (events.cover_meta, calculado en el servidor) y proporción real del póster
const tint = computed(() => props.event?.theme?.tint || null);
const posterRatio = computed(() => {
  // Con video, la proporción es la del video (16:9 si el navegador del productor no pudo leerla)
  if (coverVideo.value) {
    const { width, height } = coverVideo.value;
    return width && height ? { w: width, h: height, known: true } : { w: 16, h: 9, known: true };
  }
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
  const reviewSummary = props.event.reviews?.summary;
  if ((s === "ended" || props.event.reviews_during_run) && reviewSummary?.count) list.push({ label: `★ ${formatRating(reviewSummary.average)} · ${reviewsCountLabel(reviewSummary.count)}`, tone: "neutral" });
  if (s === "free" && stock.value?.few) list.push({ label: `Quedan ${stock.value.remaining} ${stock.value.remaining === 1 ? "cupo" : "cupos"}`, tone: "warning", pulse: true });
  if (isPaidOnSale.value && stock.value?.few) list.push({ label: "Últimas entradas", tone: "warning", pulse: true });
  if (isPrivate.value) list.push({ label: "Evento privado", tone: "neutral" });
  return list;
});

// ---- Compra en dominio propio: el checkout vive en aitickets.cl ----
const externalUrl = ref("");
// Reseñas (EventReviews.vue): en el evento terminado, mientras quedan funciones si la productora lo activó
// (reviews_during_run: la obra en cartelera muestra las reseñas y el botón de compra) o cuando se llega con el link
// del correo "¿Cómo estuvo?" (#resena=…). El link se decide al montar: el servidor no ve el fragmento.
const reviewsFromLink = ref(false);
const showReviews = computed(
  () => !props.event?.is_preview && !props.event?.is_demo && (state.value === "ended" || props.event?.reviews_during_run === true || reviewsFromLink.value),
);
const reviewsOrigin = ref("");
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
  // Con la card visible en mobile (varias funciones, §4.4b c) la barra espera a que la card salga de pantalla
  if (isPaidOnSale.value) return pastPlace.value && !checkout.value && (cardHiddenOnMobile.value || !cardVisible.value);
  if (state.value === "free") return !cardVisible.value && !["success", "confirmed", "waitlist_ok", "already"].includes(rsvpState.value);
  return false;
});
// Varias funciones (§4.9b): la barra dice cuántas hay en vez de la nota del cargo. Con un solo tipo de entrada
// (paid_simple) se mantienen el precio exacto y "Comprar": el checkout va directo a Tus datos
const functionsCount = computed(() => upcomingFunctions(props.event).length);
const priceNote = computed(() => {
  if (functionsCount.value > 1) return `${functionsCount.value} funciones`;
  return props.event.fee_absorbed ? "precio final por entrada" : "por entrada, incluye cargo";
});
const bar = computed(() => {
  if (state.value === "paid_simple") return { price: formatCLP(fromPrice.value), note: priceNote.value, cta: "Comprar" };
  if (state.value === "paid_multi") return { price: `Desde ${formatCLP(fromPrice.value)}`, note: priceNote.value, cta: "Elegir entradas" };
  return { price: "Gratis", note: stock.value?.few ? `Quedan ${stock.value.remaining} cupos` : "", warning: Boolean(stock.value?.few), cta: "Confirmar asistencia" };
});
function onBarAction() {
  if (isPaidOnSale.value) openCheckout({ entry: "sticky", step: state.value === "paid_simple" ? 2 : 1 });
  else goToCard();
}

// ---- Acciones secundarias ----
// Compartir abre el modal con las redes (y el share nativo como "Más opciones")
const showShareModal = ref(false);
const onShare = () => (showShareModal.value = true);
const orders = ref([]);
const showOrders = ref(false);
const refreshOrders = () => (orders.value = storedOrders(props.event.id));
// "Ver quiénes van →" de la fila mobile (en mobile la card de los pagados a la venta no se muestra)
const feedUrl = computed(() => attendeeFeedUrl(orders.value));

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}
// Desde la card ("+ N funciones", "Ver todas las funciones ↓"): además del scroll, el foco pasa al título de la
// sección (#<id>-title) para que el teclado y el lector de pantalla sigan ahí (§11)
function goToSection(id) {
  scrollToId(id);
  const title = document.getElementById(`${id}-title`);
  if (!title) return;
  if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
  title.focus({ preventScroll: true });
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
    try {
      reviewsOrigin.value = new URL(props.event.purchase_url).origin;
    } catch {
      reviewsOrigin.value = "https://aitickets.cl";
    }
  }
  try {
    reviewsFromLink.value = Boolean(readReviewHash(window.location.hash)) || Boolean(sessionStorage.getItem(`aitickets_review_${props.event.id}`));
  } catch {
    reviewsFromLink.value = Boolean(readReviewHash(window.location.hash));
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

  if (layout.value === "banner" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.addEventListener("scroll", onParallaxScroll, { passive: true });
  }
  window.addEventListener("keydown", onImageKey);

  if ("IntersectionObserver" in window) {
    if (coverEl.value) {
      const io = new IntersectionObserver(([entry]) => {
        docked.value = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
      });
      io.observe(coverEl.value);
      observers.push(io);
    }
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
  window.removeEventListener("scroll", onParallaxScroll);
  window.removeEventListener("keydown", onImageKey);
  cancelAnimationFrame(parallaxRaf);
  observers.forEach((o) => o.disconnect());
  eventBus.off("purchase-completed", refreshOrders);
  eventBus.off("open-modal", onAssistantOpenCheckout);
});

// En mobile la card de los eventos pagados a la venta no se muestra: la barra inferior abre el checkout. Excepción:
// varias funciones con chips (§4.4b c), donde la card va inline después del lugar (como la de los gratis) para
// elegir la función desde ahí; los eventos de una función quedan igual.
const cardHasChips = computed(() => state.value === "paid_multi" && cardFunctionChips(props.event).chips.length > 0);
const cardHiddenOnMobile = computed(() => isPaidOnSale.value && !cardHasChips.value);
</script>

<template>
  <div v-if="event" class="ev-page ev-motion" :class="[`layout-${layout}`, { 'has-tint': tint }]" :style="pageStyle">
    <div v-if="bgPreset" class="page-bg-wrap" aria-hidden="true">
      <IridescenceBg class="page-bg" :color="bgPreset.color" :soft="bgPreset.soft" />
    </div>
    <div v-else class="tint" aria-hidden="true"></div>

    <div class="container">
      <p v-if="event.is_demo" class="banner banner-demo" role="note">
        <span class="demo-dot" aria-hidden="true"></span>
        <span class="demo-text">Evento de demostración: puedes recorrer el flujo completo, no se cobra nada.</span>
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

      <!-- Portada ancha: la imagen ocupa todo el ancho y el título se monta sobre su borde -->
      <figure v-if="layout === 'banner'" ref="coverEl" class="cover" :class="{ 'is-contain': bannerContain && !coverVideo }" :style="bannerStyle" data-testid="event-cover">
        <div v-if="coverVideo" ref="bannerImg" class="cover-media">
          <AutoplayVideo fill eager sound-position="top" :video="coverVideo" :event-name="event.name" test-id="cover-video" @failed="coverVideoFailed = true" />
        </div>
        <template v-else>
          <img v-if="bannerContain" :src="coverSrc" :srcset="coverSrcset" :sizes="EVENT_COVER_SIZES" alt="" class="cover-blur" aria-hidden="true" />
          <img ref="bannerImg" :src="coverSrc" :srcset="coverSrcset" :sizes="EVENT_COVER_SIZES" :alt="event.name" class="cover-img" fetchpriority="high" loading="eager" decoding="async" />
        </template>
      </figure>

      <div class="layout">
        <figure v-if="layout === 'poster'" ref="coverEl" class="poster" :class="{ 'is-fallback': !posterRatio.known, 'has-video': coverVideo }" data-testid="event-cover">
          <AutoplayVideo v-if="coverVideo" fill eager :video="coverVideo" :event-name="event.name" test-id="cover-video" @failed="coverVideoFailed = true" />
          <img
            v-else
            :src="coverSrc"
            :srcset="coverSrcset"
            :sizes="EVENT_COVER_SIZES"
            :alt="event.name"
            :width="posterRatio.known ? posterRatio.w : undefined"
            :height="posterRatio.known ? posterRatio.h : undefined"
            fetchpriority="high"
            loading="eager"
            decoding="async"
          />
        </figure>

        <div class="hero-area" :ref="(el) => layout === 'compact' && (coverEl = el)">
          <EventHero
            :event="event"
            :badges="badges"
            :show-organizer="pageSettings.show_organizer"
            :thumb="layout === 'compact' ? coverSrc || '' : ''"
            :thumb-srcset="layout === 'compact' ? coverSrcset : undefined"
            @show-functions="goToSection('funciones')"
            @show-location="scrollToId('ubicacion')"
            @open-image="showImage = true"
          />
          <span ref="placeSentinel" class="sentinel" aria-hidden="true"></span>
        </div>

        <div class="aside" :class="{ 'hide-mobile': cardHiddenOnMobile }">
          <div ref="cardWrap" class="card-wrap">
            <!-- La portada "se muda" a la columna derecha: miniatura cuadrada sobre la card (solo desktop) -->
            <div v-if="dockImage" class="dock" :class="{ 'is-docked': docked }" aria-hidden="true">
              <div class="dock-inner">
                <div class="dock-row">
                  <img :src="cdnImage(dockImage, 240)" alt="" class="dock-img" loading="lazy" decoding="async" />
                  <div class="dock-text">
                    <p class="dock-name">{{ event.name }}</p>
                    <p v-if="dockDate" class="dock-date">{{ dockDate }}</p>
                  </div>
                </div>
              </div>
            </div>
            <EventActionCard
              ref="card"
              :event="event"
              :state="state"
              :external-url="externalUrl"
              :orders="orders"
              @checkout="openCheckout"
              @view-orders="showOrders = true"
              @rsvp-state="rsvpState = $event"
              @review="scrollToId('resenas')"
              @show-functions="goToSection('funciones')"
            />
            <div v-if="state !== 'ended' && rsvpState !== 'success'" class="secondary">
              <button type="button" class="secondary-btn" @click="onShare">
                <svg class="share-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>
                Compartir
              </button>
              <!-- Asistencia confirmada: la card ya trae "Añadir al calendario" -->
              <template v-if="rsvpState !== 'confirmed'">
                <span aria-hidden="true" class="secondary-sep">·</span>
                <button type="button" class="secondary-btn" @click="addToCalendar(event)">
                  <svg class="cal-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  Añadir al calendario
                </button>
              </template>
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
            <template v-if="feedUrl">
              <span aria-hidden="true" class="secondary-sep">·</span>
              <a :href="feedUrl" class="secondary-btn" data-testid="mobile-feed-link">Ver quiénes van →</a>
            </template>
          </div>
          <EventSections
            :event="event"
            :can-buy="isPaidOnSale"
            :show-assistant="showAssistant"
            @choose-function="(id) => openCheckout({ entry: 'function_list', step: 1, functionId: String(id) })"
            @open-assistant="openAssistant"
          />
          <EventReviews v-if="showReviews" :event="event" :ended="state === 'ended'" :external-origin="reviewsOrigin" />
          <EventGallery v-if="event.gallery?.length || event.gallery_video" v-reveal :images="event.gallery || []" :video="event.gallery_video" :eventName="event.name" />
        </div>
      </div>

      <aside v-if="!siteMode && !event.is_preview" class="producer">
        <a :href="producerBannerUrl" class="ev-link">¿Organizas eventos? Vende con AI Tickets →</a>
      </aside>
      <div class="bar-space" aria-hidden="true"></div>
    </div>

    <!-- Sticky (no fixed) dentro de la página: se pega abajo al hacer scroll y queda justo después de
         "¿Organizas eventos?", sin montarse sobre el footer -->
    <MobileStickyBar :visible="showBar" :price="bar.price" :note="bar.note" :note-warning="bar.warning" :cta="bar.cta" @action="onBarAction" />

    <CheckoutSheet v-if="checkout" :event="event" :initial="checkout" @close="closeCheckout" />
    <ShareSheet :show="showShareModal" :event="event" @close="showShareModal = false" />
    <PurchasedTicketsModal :show="showOrders" :eventOrders="orders" :event="event" @close="showOrders = false" />

    <Teleport to="body">
      <Transition name="lightbox">
        <div v-if="showImage" class="lightbox ev-motion" role="dialog" aria-modal="true" :aria-label="event.name" @click="showImage = false">
          <img :src="event.image_url" :alt="event.name" />
          <button type="button" class="lightbox-close" aria-label="Cerrar">×</button>
        </div>
      </Transition>
    </Teleport>
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
/* Fondo Iridescence detrás del contenido. Sticky dentro de la página (no fixed): así no se sale de .ev-page
   ni tapa el footer, y con 100lvh no cambia de alto (ni se redibuja en negro) cuando la barra del navegador
   móvil aparece o se esconde al hacer scroll. */
.page-bg-wrap {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
}
.page-bg {
  position: sticky;
  top: 0;
  width: 100%;
  height: 100vh;
  height: 100lvh;
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
.container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 16px 16px 0;
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
  justify-content: flex-start;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(6px);
  box-shadow: inset 0 0 0 1px var(--border);
  color: var(--text-2);
  animation: ev-fade-up var(--dur-3) var(--ease-out) both;
}
.demo-text {
  flex: 1 1 240px;
}
.demo-dot {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand-lime);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
}
.demo-dot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--brand-lime);
  animation: ev-pulse 1.6s ease-out 1s 4;
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
  animation: ev-poster-in var(--dur-4) var(--ease-out) backwards; /* backwards: deja libre el transform del hover */
  transition: transform var(--dur-4) var(--ease-out), box-shadow var(--dur-4) var(--ease-out);
}
@media (hover: hover) {
  .poster:hover {
    transform: translateY(-4px) rotate(-0.4deg);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05), 0 24px 48px rgba(0, 0, 0, 0.14);
  }
}

/* ---- Portada ancha ---- */
.cover {
  position: relative;
  height: var(--banner-h-m);
  max-height: 62vh;
  margin: 0 -16px 0;
  overflow: hidden;
  background: var(--surface-1);
  animation: ev-fade-in var(--dur-4) var(--ease-out) both;
}
.cover-img {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: var(--banner-pos-m);
  display: block;
  will-change: transform;
  animation: cover-in 1200ms var(--ease-out) backwards; /* backwards: después manda el parallax (inline) */
}
.cover.is-contain .cover-img {
  object-fit: contain;
}
.cover-blur {
  position: absolute;
  inset: -24px;
  width: calc(100% + 48px);
  height: calc(100% + 48px);
  object-fit: cover;
  filter: blur(28px) saturate(1.1);
  opacity: 0.7;
}
/* Video de portada en la portada ancha: el parallax mueve el contenedor; el encuadre vertical es el del ajuste */
.cover-media {
  position: absolute;
  inset: 0;
  will-change: transform;
  --video-pos: var(--banner-pos-m);
  animation: cover-in 1200ms var(--ease-out) backwards;
}
.poster.has-video {
  position: relative;
}
@keyframes cover-in {
  from { transform: scale(1.08); opacity: 0; }
  to { transform: none; opacity: 1; }
}
/* El título se monta sobre el borde inferior de la imagen */
.layout-banner .hero-area {
  position: relative;
  margin: -40px 0 0;
  padding: 20px 16px 20px;
  background: var(--surface-0);
  border-radius: var(--r-xl);
  margin-left: -16px;
  margin-right: -16px;
}

/* ---- Imagen completa (diseño compacto) ---- */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(10, 10, 11, 0.86);
  cursor: zoom-out;
}
.lightbox img {
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--r-lg);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
}
.lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 0;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity var(--dur-3) var(--ease-out);
}
.lightbox-enter-active img,
.lightbox-leave-active img {
  transition: transform var(--dur-3) var(--ease-spring);
}
.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}
.lightbox-enter-from img,
.lightbox-leave-to img {
  transform: scale(0.9);
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
/* Miniatura acoplada sobre la card: solo desktop (en mobile no hay columna derecha) */
.dock {
  display: none;
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
  text-decoration: none; /* también hay links (<a>) en la fila */
}
.secondary-btn:hover {
  color: var(--text-1);
}
.secondary-btn svg {
  transition: transform var(--dur-3) var(--ease-spring);
}
.secondary-btn:hover .share-ico {
  transform: translate(2px, -2px);
}
.secondary-btn:hover .cal-ico {
  transform: rotate(90deg);
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
  height: 24px;
}

@media (min-width: 1024px) {
  .container {
    padding: 24px 24px 0;
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 400px;
    grid-template-areas:
      "hero aside"
      "main aside";
    grid-template-rows: auto 1fr;
    column-gap: 56px;
    row-gap: 0;
  }
  /* Póster: la columna mide lo que mide el póster (limitado por alto), así no queda un hueco entre la imagen
     y el título. Mínimo 480 px para que la descripción de abajo se lea cómoda. */
  .layout-poster .layout {
    --poster-w: calc(min(680px, 78vh) * var(--poster-ar-num));
    grid-template-columns: minmax(0, max(480px, var(--poster-w))) 400px;
    grid-template-areas:
      "poster hero"
      "poster aside"
      "main aside";
    grid-template-rows: auto auto 1fr;
    justify-content: center;
    column-gap: 48px;
  }
  .cover {
    height: var(--banner-h-d);
    margin: 0;
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-card);
  }
  .cover-img {
    object-position: var(--banner-pos-d);
  }
  .cover-media {
    --video-pos: var(--banner-pos-d);
  }
  .layout-banner .hero-area {
    margin: -72px 0 0 24px;
    padding: 28px 32px 24px;
    border-radius: var(--r-xl);
  }
  .layout-banner .aside {
    padding-top: 32px;
  }
  .layout-compact .hero-area {
    padding-top: 24px;
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
  .layout-compact .aside {
    padding-top: 24px;
  }
  /* La card queda visible mientras se lee la descripción, las funciones y las preguntas */
  .card-wrap {
    position: sticky;
    top: 24px;
  }
  /* A33: al pasar la portada, una miniatura cuadrada "llega" desde la izquierda y se acopla sobre la card.
     La altura se anima con grid-template-rows (0fr → 1fr) para que la card baje sin saltos. */
  .dock {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 520ms var(--ease-out);
  }
  .dock.is-docked {
    grid-template-rows: 1fr;
  }
  .dock-inner {
    min-height: 0;
    overflow: hidden;
  }
  .dock-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 14px;
  }
  .dock-img {
    width: 72px;
    height: 72px;
    flex: 0 0 auto;
    border-radius: var(--r-md);
    object-fit: cover;
    box-shadow: var(--shadow-card);
    opacity: 0;
    transform: translateX(-120px) scale(0.5) rotate(-6deg);
    transition: transform 640ms var(--ease-spring), opacity 320ms var(--ease-out);
  }
  .dock-text {
    min-width: 0;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 320ms var(--ease-out) 120ms, transform 420ms var(--ease-out) 120ms;
  }
  .dock.is-docked .dock-img {
    opacity: 1;
    transform: none;
  }
  .dock.is-docked .dock-text {
    opacity: 1;
    transform: none;
  }
  .dock-name {
    font-family: "Unbounded", system-ui, sans-serif;
    font-weight: 700;
    font-size: 15px;
    line-height: 20px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .dock-date {
    font-size: 13px;
    color: var(--text-2);
    margin-top: 2px;
  }
  .main {
    grid-area: main;
    margin-top: 56px;
  }
  .layout-banner .main,
  .layout-compact .main {
    margin-top: 48px;
  }
  .mobile-only {
    display: none !important;
  }
  .bar-space {
    height: 24px;
  }
}
</style>

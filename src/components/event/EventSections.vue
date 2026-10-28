<script setup>
// Contenido de la página del evento bajo el póster (§4.8, §4.9): Sobre el evento, Funciones (si hay más de
// una, v2 en §4.9b), Agenda (si el productor cargó bloques; por día, src/lib/eventAgenda.mjs), Ubicación, Preguntas
// frecuentes, acceso al asistente y categorías. Sin tabs. Todo va en la columna principal: la card de acción (v2)
// sigue a la derecha en desktop y la agenda no la empuja.
import { ref, computed, onMounted, nextTick } from "vue";
import { Navigation } from "lucide-vue-next";
import { categoryIcon } from "./categoryIcons.js";
import { vReveal } from "./reveal.js";
import AutoHeight from "./AutoHeight.vue";
import { upcomingFunctions, functionListModel, functionOnSale, directionsUrl, FUNCTION_LIST_LIMIT } from "./eventView.js";

const props = defineProps({
  event: { type: Object, required: true },
  // Se puede comprar (muestra "Elegir" en la lista de funciones)
  canBuy: { type: Boolean, default: false },
  showAssistant: { type: Boolean, default: true },
});
const emit = defineEmits(["choose-function", "open-assistant"]);

// ---- Sobre el evento: colapsada si supera 600 caracteres ----
const DESCRIPTION_LIMIT = 600;
const description = computed(() => props.event.description || "");
const isLong = computed(() => description.value.replace(/<[^>]+>/g, "").length > DESCRIPTION_LIMIT);
const expanded = ref(false);

// ---- Funciones (§4.9b): por lugar si hay más de uno y por mes si un lugar tiene más de 8 ----
const functions = computed(() => upcomingFunctions(props.event));
const fnList = computed(() => functionListModel(props.event));
// Lista larga: las 6 próximas y "Ver las N funciones" expande (AutoHeight anima el alto)
const fnExpanded = ref(false);
const fnCollapsible = computed(() => fnList.value.total > FUNCTION_LIST_LIMIT);
const visibleFnGroups = computed(() => {
  if (fnExpanded.value || !fnCollapsible.value) return fnList.value.groups;
  const shown = (fn) => fn.order < FUNCTION_LIST_LIMIT;
  return fnList.value.groups
    .map((g) => ({ ...g, months: g.months.map((m) => ({ ...m, items: m.items.filter(shown) })).filter((m) => m.items.length) }))
    .filter((g) => g.months.length);
});
// "Ver menos" con la lista ya bajo el borde superior: la página vuelve al título de la sección (si no, salta)
const fnTitle = ref(null);
const fnAnnounce = ref("");
async function toggleFunctions() {
  fnExpanded.value = !fnExpanded.value;
  // El foco se queda en el botón (aria-expanded); el lector de pantalla oye cuántas funciones hay ahora (§11)
  fnAnnounce.value = fnExpanded.value ? `${fnList.value.total} funciones` : "";
  if (fnExpanded.value) return;
  await nextTick();
  const title = fnTitle.value;
  if (title && title.getBoundingClientRect().top < 0) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    title.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
}
const statusLabel = (fn) => {
  if (fn.status === "sold_out") return "Agotada";
  if (fn.status === "few") return "Últimas";
  // Sus entradas aún no salen a la venta: no está agotada (§6.3, checkout.available_from)
  if (fn.status === "upcoming") return fn.opens ? `Disponible desde el ${fn.opens}` : "Venta próximamente";
  return props.canBuy && fn.status ? "Disponible" : "";
};
// Toda la fila es clickeable (el botón "Elegir" es el control para teclado y lector de pantalla). Solo las que
// tienen entradas a la venta: ni la agotada, ni la que aún no abre, ni las que el checkout no ofrece (status null)
const canChoose = (fn) => props.canBuy && functionOnSale(fn) && fn.id != null;
const chooseAria = (fn) => `Elegir ${fn.label}${fnList.value.manyPlaces && fn.place ? `, en ${fn.place}` : ""}${fn.status === "few" ? " (últimas entradas)" : ""}`;
function chooseFunction(fn) {
  if (canChoose(fn)) emit("choose-function", fn.id);
}

// ---- Agenda: grupos por día ya armados en el servidor (agendaGroups) ----
const agenda = computed(() => (Array.isArray(props.event.agenda) ? props.event.agenda.filter((g) => g.blocks?.length) : []));

// ---- Ubicación ----
const mapsKey = import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY;
const venue = computed(() => props.event.venue || functions.value[0]?.venue || null);
const mapQuery = computed(() => {
  if (venue.value) return [venue.value.name, venue.value.address, venue.value.city].filter(Boolean).join(", ");
  return props.event.location || "";
});
const coords = computed(() =>
  venue.value?.latitude != null && venue.value?.longitude != null ? `${venue.value.latitude},${venue.value.longitude}` : "",
);
const mapFailed = ref(false);
// 'static' (SSR / ya cargada al hidratar: sin animación) | 'pending' | 'loaded' (entra con el pin animado)
const mapState = ref("static");
const mapImg = ref(null);
// Paleta de la marca: grises con parques en verde lima. Sin marcador de Google: el pin (animado) va en CSS,
// centrado sobre la imagen (el mapa está centrado en el lugar y la proporción es la misma, 16:9).
const MAP_STYLES = [
  "element:geometry|color:0xf2f2f3",
  "element:labels.icon|visibility:off",
  "element:labels.text.fill|color:0x6e6e76",
  "element:labels.text.stroke|color:0xffffff|weight:3",
  "feature:administrative|element:geometry|visibility:off",
  "feature:landscape.man_made|element:geometry|color:0xeaeaec",
  "feature:poi|visibility:off",
  "feature:poi.park|visibility:on",
  "feature:poi.park|element:geometry|color:0xd9f99d",
  "feature:poi.park|element:labels|visibility:off",
  "feature:road|element:geometry|color:0xffffff",
  "feature:road.arterial|element:geometry|color:0xffffff",
  "feature:road.highway|element:geometry|color:0xd4d4d8",
  "feature:road.local|element:labels|visibility:off",
  "feature:transit|visibility:off",
  "feature:water|element:geometry|color:0xbef264",
  "feature:water|element:labels|visibility:off",
];
const staticMapUrl = computed(() => {
  if (!mapsKey || !mapQuery.value || props.event.has_secret_location) return "";
  const center = coords.value || mapQuery.value;
  const params = new URLSearchParams({ center, zoom: "15", size: "640x360", scale: "2", key: mapsKey });
  MAP_STYLES.forEach((st) => params.append("style", st));
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
});
const isIos = ref(false);
onMounted(() => {
  if (mapImg.value && !mapImg.value.complete) mapState.value = "pending";
  isIos.value = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
});
const directions = computed(() => directionsUrl(coords.value || mapQuery.value, { ios: isIos.value }));

// ---- FAQ ----
const openFaq = ref(new Set());
function toggleFaq(i) {
  const next = new Set(openFaq.value);
  next.has(i) ? next.delete(i) : next.add(i);
  openFaq.value = next;
}
</script>

<template>
  <div class="sections">
    <section v-if="description" id="sobre" v-reveal class="section" aria-labelledby="sobre-title">
      <h2 id="sobre-title" class="section-title">Sobre el evento</h2>
      <div class="about-wrap" :class="{ 'is-collapsed': isLong && !expanded }">
        <div class="about event-description" v-html="description"></div>
      </div>
      <button v-if="isLong" type="button" class="ev-link read-more" :aria-expanded="expanded ? 'true' : 'false'" @click="expanded = !expanded">
        {{ expanded ? "Leer menos" : "Leer más" }}
      </button>
    </section>

    <section v-if="fnList.total > 1" id="funciones" v-reveal class="section" aria-labelledby="funciones-title" data-testid="event-functions">
      <h2 id="funciones-title" ref="fnTitle" class="section-title">Funciones</h2>
      <AutoHeight>
        <div id="funciones-lista">
          <div v-for="group in visibleFnGroups" :key="group.key" class="fn-group">
            <div v-if="fnList.manyPlaces && group.title" class="fn-place">
              <p class="fn-place-name">{{ group.title }}</p>
              <p v-if="group.address" class="fn-place-address">{{ group.address }}</p>
            </div>
            <template v-for="month in group.months" :key="month.key">
              <p v-if="month.label" class="fn-month">{{ month.label }}</p>
              <ul class="fn-list">
                <li
                  v-for="fn in month.items"
                  :key="fn.id ?? fn.order"
                  class="fn-row"
                  :class="{ 'is-out': fn.status === 'sold_out', 'is-clickable': canChoose(fn), 'is-extra': fn.order >= FUNCTION_LIST_LIMIT }"
                  :style="{ '--j': fn.order - FUNCTION_LIST_LIMIT }"
                  :data-function-id="fn.id"
                  @click="chooseFunction(fn)"
                >
                  <span class="fn-when">
                    <span class="fn-date ev-tabular">{{ fn.label }}</span>
                    <span v-if="fn.price" class="fn-price ev-tabular">{{ fn.price }}</span>
                  </span>
                  <span class="fn-status" :class="fn.status && `is-${fn.status}`">{{ statusLabel(fn) }}</span>
                  <!-- Sin @click propio: el click sube a la fila (un solo handler para la fila y el botón) -->
                  <button v-if="canChoose(fn)" type="button" class="ev-btn ev-btn-secondary fn-choose" :aria-label="chooseAria(fn)">Elegir</button>
                  <span v-else class="fn-choose-spacer" aria-hidden="true"></span>
                </li>
              </ul>
            </template>
          </div>
        </div>
      </AutoHeight>
      <button
        v-if="fnCollapsible"
        type="button"
        class="ev-link fn-more"
        aria-controls="funciones-lista"
        :aria-expanded="fnExpanded ? 'true' : 'false'"
        @click="toggleFunctions"
      >
        {{ fnExpanded ? "Ver menos" : `Ver las ${fnList.total} funciones` }}
      </button>
      <p class="sr-only" aria-live="polite">{{ fnAnnounce }}</p>
    </section>

    <section v-if="agenda.length" id="agenda" v-reveal class="section" aria-labelledby="agenda-title" data-testid="event-agenda">
      <h2 id="agenda-title" class="section-title">Agenda</h2>
      <div v-for="group in agenda" :key="group.key" class="ag-group">
        <h3 v-if="group.title" class="ag-day">{{ group.title }}</h3>
        <ol class="ag-list">
          <li v-for="(block, i) in group.blocks" :key="block.id ?? i" class="ag-row" data-testid="agenda-row">
            <span class="ag-time ev-tabular">{{ block.start }}<template v-if="block.end"> – {{ block.end }}</template></span>
            <span class="ag-body">
              <span class="ag-title">{{ block.title }}</span>
              <span v-if="block.speakers" class="ag-speakers">{{ block.speakers }}</span>
              <span v-if="block.room" class="ag-room">{{ block.room }}</span>
            </span>
          </li>
        </ol>
      </div>
    </section>

    <section v-if="mapQuery || event.has_secret_location" id="ubicacion" v-reveal class="section" aria-labelledby="ubicacion-title">
      <h2 id="ubicacion-title" class="section-title">{{ event.has_secret_location ? "Ubicación aproximada" : "Ubicación" }}</h2>
      <p v-if="venue?.name || event.location" class="loc-name">{{ venue?.name || event.location }}</p>
      <p v-if="venue?.address" class="loc-address">{{ [venue.address, venue.city].filter(Boolean).join(", ") }}</p>
      <p v-if="event.has_secret_location && venue?.city && venue.city !== venue.name" class="loc-address">{{ venue.city }}</p>
      <p v-if="event.has_secret_location" class="loc-note">La dirección exacta la reciben solo quienes compran, en su entrada y por correo.</p>
      <a
        v-if="staticMapUrl && !mapFailed"
        :href="directions"
        target="_blank"
        rel="noopener"
        class="map"
        :class="`is-${mapState}`"
        :aria-label="`Abrir ${venue?.name || 'la ubicación'} en el mapa`"
      >
        <img ref="mapImg" :src="staticMapUrl" :alt="`Mapa de ${venue?.name || mapQuery}`" loading="lazy" decoding="async" width="640" height="360" @load="mapState === 'pending' && (mapState = 'loaded')" @error="mapFailed = true" />
        <span class="map-pin" aria-hidden="true">
          <span class="map-pin-ring"></span>
          <svg width="34" height="42" viewBox="0 0 34 42"><path d="M17 41s15-12.6 15-24.5A15 15 0 0 0 2 16.5C2 28.4 17 41 17 41z" fill="#0a0a0b" /><circle cx="17" cy="16.5" r="6" fill="var(--brand-lime)" /></svg>
        </span>
      </a>
      <a v-if="mapQuery && !event.has_secret_location" :href="directions" target="_blank" rel="noopener" class="ev-btn ev-btn-secondary directions">
        <Navigation :size="18" class="directions-icon" aria-hidden="true" />
        Cómo llegar
      </a>
    </section>

    <section v-if="event.faqs?.length" id="preguntas" v-reveal class="section" aria-labelledby="faq-title">
      <h2 id="faq-title" class="section-title">Preguntas frecuentes</h2>
      <div class="faq">
        <div v-for="(faq, i) in event.faqs" :key="faq.id ?? i" class="faq-item">
          <h3>
            <button
              type="button"
              class="faq-q"
              :aria-expanded="openFaq.has(i) ? 'true' : 'false'"
              :aria-controls="`faq-a-${i}`"
              @click="toggleFaq(i)"
            >
              <span>{{ faq.question }}</span>
              <svg class="chev" :class="{ 'is-open': openFaq.has(i) }" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </h3>
          <div :id="`faq-a-${i}`" class="ev-collapse" :class="{ 'is-open': openFaq.has(i) }" role="region">
            <div><p class="faq-a">{{ faq.answer }}</p></div>
          </div>
        </div>
      </div>
    </section>

    <p v-if="showAssistant" class="assistant-line">
      <button type="button" class="ev-link" @click="emit('open-assistant')">¿No encuentras lo que buscas? Pregúntale al asistente →</button>
    </p>

    <ul v-if="event.tags?.length" v-reveal class="tags" aria-label="Categorías">
      <li v-for="(tag, i) in event.tags" :key="tag" class="tag" :style="{ '--i': i }">
        <component :is="categoryIcon(tag)" :size="15" class="tag-icon" aria-hidden="true" />
        {{ tag }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.sections {
  display: flex;
  flex-direction: column;
  gap: 40px;
  font-family: "Prompt", system-ui, sans-serif;
  color: var(--text-1);
}
.section-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
  margin-bottom: 12px;
}
.about-wrap {
  position: relative;
  max-height: 2000px;
  overflow: hidden;
  transition: max-height var(--dur-3) var(--ease-out);
}
.about-wrap.is-collapsed {
  max-height: 260px;
}
/* Fade al final del texto colapsado con máscara (no un degradado blanco): funciona sobre el fondo animado */
.about-wrap.is-collapsed {
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 80px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 80px), transparent);
}
.about {
  max-width: 68ch;
  font-size: 16px;
  line-height: 26px;
  color: #2a2a2f;
  overflow-wrap: anywhere;
}
.about :deep(p) { margin-bottom: 12px; }
.about :deep(ul) { list-style: disc; padding-left: 1.25rem; margin-bottom: 12px; }
.about :deep(ol) { list-style: decimal; padding-left: 1.25rem; margin-bottom: 12px; }
.about :deep(h2),
.about :deep(h3) { font-weight: 600; margin: 16px 0 8px; color: var(--text-1); }
.about :deep(a) { color: var(--text-1); text-decoration: underline; text-underline-offset: 3px; }
.about :deep(blockquote) { border-left: 2px solid var(--border-strong); padding-left: 12px; color: var(--text-2); }
.read-more {
  margin-top: 8px;
  font-size: 15px;
  padding: 4px 0;
}
.fn-group + .fn-group {
  margin-top: 24px;
}
.fn-place {
  padding-bottom: 6px;
}
.fn-place-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.fn-place-address {
  font-size: 13px;
  color: var(--text-2);
}
.fn-month {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  margin: 14px 0 2px;
}
.fn-list {
  display: flex;
  flex-direction: column;
}
.fn-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 16px;
  min-height: 56px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.fn-row.is-clickable {
  cursor: pointer;
}
.fn-row.is-clickable:hover .fn-choose {
  border-color: var(--text-1);
}
/* Al expandir la lista, las filas nuevas entran escalonadas (30 ms, como A10) */
.fn-row.is-extra {
  animation: ev-fade-up var(--dur-2) var(--ease-out) backwards;
  animation-delay: calc(var(--j, 0) * 30ms);
}
.fn-when {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.fn-date {
  font-size: 15px;
  font-weight: 500;
}
.fn-price {
  font-size: 13px;
  color: var(--text-2);
}
.fn-status {
  font-size: 13px;
  color: var(--text-2);
}
.fn-status.is-few {
  color: var(--warning-text);
  font-weight: 500;
}
.fn-row.is-out .fn-date,
.fn-row.is-out .fn-status {
  color: var(--text-3);
  text-decoration: line-through;
}
.fn-choose {
  min-height: 36px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  font-size: 14px;
  font-weight: 500;
}
.fn-choose-spacer {
  width: 0;
}
.fn-more {
  margin-top: 12px;
  font-size: 15px;
  font-weight: 500;
  background: none;
  border: 0;
  padding: 4px 0;
  cursor: pointer;
}
.ag-group + .ag-group {
  margin-top: 24px;
}
.ag-day {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  padding-bottom: 6px;
}
.ag-list {
  display: flex;
  flex-direction: column;
}
.ag-row {
  display: grid;
  grid-template-columns: 7.5rem 1fr;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.ag-time {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-2);
  padding-top: 1px;
}
.ag-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.ag-title {
  font-size: 15px;
  font-weight: 500;
}
.ag-speakers {
  font-size: 14px;
  color: var(--text-2);
}
.ag-room {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-1);
  background: var(--surface-1);
  border-radius: var(--r-pill);
  padding: 2px 10px;
}
@media (max-width: 480px) {
  .ag-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
.loc-name {
  font-size: 16px;
  font-weight: 600;
}
.loc-address {
  font-size: 14px;
  color: var(--text-2);
}
.loc-note {
  font-size: 14px;
  color: var(--warning-text);
  margin-top: 4px;
}
.map {
  position: relative;
  display: block;
  margin-top: 12px;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--surface-1);
  box-shadow: inset 0 0 0 1px var(--border);
}
.map img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: opacity var(--dur-4) var(--ease-out), transform 900ms var(--ease-out);
}
.map.is-pending img {
  opacity: 0;
  transform: scale(1.04);
}
.map:hover img {
  transform: scale(1.03);
}
.map:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 3px;
}
/* Pin centrado: la punta queda en el centro del mapa. Cae y rebota al cargar; el anillo pulsa. */
.map-pin {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 34px;
  height: 42px;
  margin: -42px 0 0 -17px;
  filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.25));
}
.map.is-pending .map-pin {
  opacity: 0;
}
.map.is-loaded .map-pin {
  animation: map-pin-drop 640ms var(--ease-spring) 200ms both;
}
.map-pin svg {
  display: block;
  position: relative;
}
.map-pin-ring {
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 22px;
  height: 10px;
  margin-left: -11px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--brand-lime) 80%, transparent);
}
.map:not(.is-pending) .map-pin-ring {
  animation: map-pin-ring 1.8s ease-out 900ms 3;
}
.map:hover .map-pin svg {
  animation: map-pin-hop 520ms var(--ease-out);
}
@keyframes map-pin-drop {
  from { opacity: 0; transform: translateY(-36px); }
  to { opacity: 1; transform: none; }
}
@keyframes map-pin-ring {
  0% { transform: scale(0.6); opacity: 0.9; }
  100% { transform: scale(3); opacity: 0; }
}
@keyframes map-pin-hop {
  0%, 100% { transform: none; }
  40% { transform: translateY(-8px); }
}
.directions {
  margin-top: 12px;
  min-height: 44px;
  padding: 0 18px;
  font-size: 15px;
  gap: 8px;
}
.directions-icon {
  transition: transform var(--dur-3) var(--ease-spring);
}
.directions:hover .directions-icon {
  transform: translate(2px, -2px) rotate(12deg);
}
.faq-item {
  border-bottom: 1px solid var(--border);
}
.faq-q {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
  padding: 12px 0;
  text-align: left;
  font: inherit;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-1);
  background: none;
  border: 0;
  cursor: pointer;
}
.faq-q:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
  border-radius: 4px;
}
.chev {
  flex: 0 0 auto;
  transition: transform var(--dur-2) var(--ease-out);
}
.chev.is-open {
  transform: rotate(180deg);
}
.faq-a {
  padding-bottom: 16px;
  font-size: 15px;
  line-height: 24px;
  color: var(--text-2);
  white-space: pre-line;
}
.assistant-line {
  font-size: 15px;
  margin-top: -16px;
}
.assistant-line .ev-link {
  font: inherit;
  font-weight: 500;
  background: none;
  border: 0;
  padding: 4px 0;
  cursor: pointer;
  text-align: left;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
  background: var(--surface-1);
  border-radius: var(--r-pill);
  padding: 6px 14px 6px 10px;
  transition: background-color var(--dur-2), transform var(--dur-2) var(--ease-spring);
}
.tags.is-in .tag {
  animation: ev-fade-up var(--dur-3) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 60ms);
}
.tag:hover {
  background: color-mix(in srgb, var(--brand-lime) 35%, var(--surface-1));
  transform: translateY(-1px);
}
.tag-icon {
  color: var(--text-2);
}
@media (min-width: 1024px) {
  .sections {
    gap: 56px;
  }
}
</style>

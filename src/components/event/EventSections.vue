<script setup>
// Contenido de la página del evento bajo el póster (§4.8, §4.9): Sobre el evento, Funciones (si hay más de
// una), Ubicación, Preguntas frecuentes, acceso al asistente y categorías. Sin tabs.
import { ref, computed, onMounted } from "vue";
import {
  formatFunctionShort,
  upcomingFunctions,
  checkoutFunctions,
  directionsUrl,
  placeKey,
} from "./eventView.js";

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

// ---- Funciones agrupadas por lugar ----
const functions = computed(() => upcomingFunctions(props.event));
const fnStatus = computed(() => {
  const model = checkoutFunctions(props.event);
  return new Map(model.functions.map((f) => [String(f.id), f.status]));
});
const functionGroups = computed(() => {
  const groups = new Map();
  for (const fn of functions.value) {
    const key = placeKey(fn.venue) || "—";
    if (!groups.has(key)) {
      const v = fn.venue || {};
      const title = [v.city, v.name].filter(Boolean).join(" · ") || v.address || "";
      groups.set(key, { key, title, items: [] });
    }
    groups.get(key).items.push(fn);
  }
  return [...groups.values()];
});
const statusLabel = (fn) => {
  const s = fnStatus.value.get(String(fn.id));
  if (s === "sold_out") return "Agotada";
  if (s === "few") return "Últimas";
  return props.canBuy ? "Disponible" : "";
};

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
const staticMapUrl = computed(() => {
  if (!mapsKey || !mapQuery.value || props.event.has_secret_location) return "";
  const center = coords.value || mapQuery.value;
  const params = new URLSearchParams({
    center,
    zoom: "15",
    size: "640x360",
    scale: "2",
    markers: `color:0x0A0A0B|${center}`,
    style: "feature:poi|visibility:simplified",
    key: mapsKey,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
});
const isIos = ref(false);
onMounted(() => {
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
    <section v-if="description" id="sobre" class="section" aria-labelledby="sobre-title">
      <h2 id="sobre-title" class="section-title">Sobre el evento</h2>
      <div class="about-wrap" :class="{ 'is-collapsed': isLong && !expanded }">
        <div class="about event-description" v-html="description"></div>
      </div>
      <button v-if="isLong" type="button" class="ev-link read-more" :aria-expanded="expanded ? 'true' : 'false'" @click="expanded = !expanded">
        {{ expanded ? "Leer menos" : "Leer más" }}
      </button>
    </section>

    <section v-if="functions.length > 1" id="funciones" class="section" aria-labelledby="funciones-title">
      <h2 id="funciones-title" class="section-title">Funciones</h2>
      <div v-for="group in functionGroups" :key="group.key" class="fn-group">
        <p v-if="group.title && functionGroups.length > 1" class="fn-place">{{ group.title }}</p>
        <ul class="fn-list">
          <li v-for="fn in group.items" :key="fn.id ?? fn.date" class="fn-row" :class="{ 'is-out': statusLabel(fn) === 'Agotada' }">
            <span class="fn-date">{{ formatFunctionShort(fn) }}</span>
            <span class="fn-status" :class="{ 'is-few': statusLabel(fn) === 'Últimas' }">{{ statusLabel(fn) }}</span>
            <button
              v-if="canBuy && statusLabel(fn) !== 'Agotada' && fn.id != null"
              type="button"
              class="ev-btn ev-btn-secondary fn-choose"
              :aria-label="`Elegir ${formatFunctionShort(fn)}`"
              @click="emit('choose-function', fn.id)"
            >Elegir</button>
            <span v-else class="fn-choose-spacer" aria-hidden="true"></span>
          </li>
        </ul>
      </div>
    </section>

    <section v-if="mapQuery || event.has_secret_location" id="ubicacion" class="section" aria-labelledby="ubicacion-title">
      <h2 id="ubicacion-title" class="section-title">{{ event.has_secret_location ? "Ubicación aproximada" : "Ubicación" }}</h2>
      <p v-if="venue?.name || event.location" class="loc-name">{{ venue?.name || event.location }}</p>
      <p v-if="venue?.address" class="loc-address">{{ [venue.address, venue.city].filter(Boolean).join(", ") }}</p>
      <p v-if="event.has_secret_location" class="loc-note">La ubicación exacta aparece en tu entrada.</p>
      <a
        v-if="staticMapUrl && !mapFailed"
        :href="directions"
        target="_blank"
        rel="noopener"
        class="map"
        :aria-label="`Abrir ${venue?.name || 'la ubicación'} en el mapa`"
      >
        <img :src="staticMapUrl" :alt="`Mapa de ${venue?.name || mapQuery}`" loading="lazy" decoding="async" width="640" height="360" @error="mapFailed = true" />
      </a>
      <a v-if="mapQuery && !event.has_secret_location" :href="directions" target="_blank" rel="noopener" class="ev-link directions">Cómo llegar ↗</a>
    </section>

    <section v-if="event.faqs?.length" id="preguntas" class="section" aria-labelledby="faq-title">
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

    <ul v-if="event.tags?.length" class="tags" aria-label="Categorías">
      <li v-for="tag in event.tags" :key="tag" class="tag">{{ tag }}</li>
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
.about-wrap::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 80px;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0), var(--surface-0));
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-3);
}
.about-wrap.is-collapsed::after {
  opacity: 1;
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
  margin-top: 20px;
}
.fn-place {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 4px;
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
  border-bottom: 1px solid var(--border);
}
.fn-date {
  font-size: 15px;
  font-weight: 500;
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
  min-height: 40px;
  padding: 0 16px;
  font-size: 14px;
}
.fn-choose-spacer {
  width: 0;
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
  display: block;
  margin-top: 12px;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--surface-1);
}
.map img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.directions {
  display: inline-block;
  margin-top: 10px;
  font-size: 15px;
  padding: 6px 0;
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
  font-size: 13px;
  color: var(--text-2);
  background: var(--surface-1);
  border-radius: var(--r-pill);
  padding: 4px 12px;
}
@media (min-width: 1024px) {
  .sections {
    gap: 56px;
  }
}
</style>

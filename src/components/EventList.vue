<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { Search, X, SlidersHorizontal } from "lucide-vue-next";
import EventCard from "./EventCard.vue";
import { categoryIcon } from "./event/categoryIcons.js";

// Listado público (/eventos): recibe los eventos ya filtrados (publicados, públicos y próximos, más los demo)
// desde `eventos/index.astro`. Buscador, filtros (categoría, cuándo, precio), "Ocultar eventos de ejemplo" y
// grilla masonry. Los filtros viven en la URL (?q=&categoria=&cuando=&precio=&sin_ejemplos=1) para compartirlos.
const props = defineProps({
  // required en vez de `default: () => []`: el chequeo de tipos de Astro corta defineProps en el primer ")"
  events: { type: Array, required: true },
  // Hoy en Chile (YYYY-MM-DD), para "Esta semana" / "Este mes"
  today: { type: String, default: "" },
});

const WHEN_OPTIONS = [
  { value: "", label: "Cualquier fecha" },
  { value: "semana", label: "Próximos 7 días" },
  { value: "mes", label: "Próximos 30 días" },
];
const PRICE_OPTIONS = [
  { value: "", label: "Todos los precios" },
  { value: "gratis", label: "Gratis" },
  { value: "pagado", label: "Pagados" },
];

const query = ref("");
const category = ref("");
const when = ref("");
const price = ref("");
const hideDemo = ref(false);

const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const allEvents = computed(() => props.events || []);
const realEvents = computed(() => allEvents.value.filter((e) => !e.is_demo));
const hasDemo = computed(() => allEvents.value.some((e) => e.is_demo));

// Categorías presentes (las de los eventos visibles según "Ocultar eventos de ejemplo"), por cantidad
const categories = computed(() => {
  const counts = new Map();
  for (const e of hideDemo.value ? realEvents.value : allEvents.value) {
    for (const c of e.categories || []) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es")).map(([name, count]) => ({ name, count, icon: categoryIcon(name) }));
});

const addDays = (ymd, days) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};
const eventDays = (e) => {
  const list = (e.dates || []).map((d) => String(d.date).slice(0, 10)).filter(Boolean);
  if (list.length) return list;
  return e.start_date ? [String(e.start_date).slice(0, 10)] : [];
};

const filtered = computed(() => {
  const q = normalize(query.value.trim());
  const today = props.today || new Date().toISOString().slice(0, 10);
  const until = when.value === "semana" ? addDays(today, 7) : when.value === "mes" ? addDays(today, 30) : null;
  return allEvents.value.filter((e) => {
    if (hideDemo.value && e.is_demo) return false;
    if (category.value && !(e.categories || []).includes(category.value)) return false;
    if (price.value === "gratis" && !e.is_free) return false;
    if (price.value === "pagado" && e.min_price == null) return false;
    if (until && !eventDays(e).some((d) => d >= today && d <= until)) return false;
    if (q) {
      const haystack = normalize([e.name, e.location, ...(e.categories || [])].join(" "));
      if (!q.split(/\s+/).every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
});

const activeFilters = computed(() => Boolean(query.value.trim() || category.value || when.value || price.value));
function clearFilters() {
  query.value = "";
  category.value = "";
  when.value = "";
  price.value = "";
}
function toggleCategory(name) {
  category.value = category.value === name ? "" : name;
}
// Si la categoría elegida desaparece (p. ej. al ocultar los ejemplos), se suelta
watch(categories, (list) => {
  if (category.value && !list.some((c) => c.name === category.value)) category.value = "";
});

// ---- Masonry: columnas según el ancho; cada tarjeta va a la columna más baja (alto estimado por la
// proporción de la imagen). Antes de montar se usa CSS columns (sin JS) para que el SSR ya se vea en grilla.
const mounted = ref(false);
const columnCount = ref(3);
let mqs = [];
function updateColumns() {
  columnCount.value = window.matchMedia("(min-width: 1024px)").matches ? 3 : window.matchMedia("(min-width: 640px)").matches ? 2 : 1;
}
const columns = computed(() => {
  const n = columnCount.value;
  const cols = Array.from({ length: n }, () => ({ height: 0, items: [] }));
  filtered.value.forEach((event, index) => {
    const ratio = event.image_ratio || 0.8;
    // Alto relativo: imagen (1 / proporción) + bloque de texto (~0.62 del ancho de la tarjeta)
    const h = 1 / ratio + 0.62;
    const target = cols.reduce((min, c) => (c.height < min.height - 0.05 ? c : min), cols[0]);
    target.items.push({ event, index });
    target.height += h;
  });
  return cols;
});

// ---- Filtros en la URL
function readUrl() {
  const p = new URLSearchParams(window.location.search);
  query.value = p.get("q") || "";
  category.value = p.get("categoria") || "";
  when.value = WHEN_OPTIONS.some((o) => o.value === p.get("cuando")) ? p.get("cuando") : "";
  price.value = PRICE_OPTIONS.some((o) => o.value === p.get("precio")) ? p.get("precio") : "";
  hideDemo.value = p.get("sin_ejemplos") === "1";
}
let urlTimer = 0;
function writeUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    const p = new URLSearchParams(window.location.search);
    const set = (k, v) => (v ? p.set(k, v) : p.delete(k));
    set("q", query.value.trim());
    set("categoria", category.value);
    set("cuando", when.value);
    set("precio", price.value);
    set("sin_ejemplos", hideDemo.value ? "1" : "");
    const qs = p.toString();
    history.replaceState(history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
  }, 250);
}
watch([query, category, when, price, hideDemo], () => mounted.value && writeUrl());

onMounted(() => {
  readUrl();
  updateColumns();
  mqs = ["(min-width: 640px)", "(min-width: 1024px)"].map((q) => {
    const mq = window.matchMedia(q);
    mq.addEventListener("change", updateColumns);
    return mq;
  });
  mounted.value = true;
});
onBeforeUnmount(() => {
  mqs.forEach((mq) => mq.removeEventListener("change", updateColumns));
  clearTimeout(urlTimer);
});
</script>

<template>
  <section id="events" class="events ev-motion">
    <header class="events-head">
      <h1 class="events-title">Próximos eventos</h1>
      <p class="events-sub">Encuentra tu próximo panorama y compra tus entradas en minutos.</p>
    </header>

    <!-- Buscador y filtros -->
    <div class="toolbar" role="search">
      <label class="search">
        <Search class="search-icon" :size="18" aria-hidden="true" />
        <span class="sr-only">Buscar eventos</span>
        <input v-model="query" type="search" placeholder="Busca por nombre, lugar o categoría" autocomplete="off" enterkeyhint="search" />
        <button v-if="query" type="button" class="search-clear" aria-label="Borrar búsqueda" @click="query = ''">
          <X :size="16" aria-hidden="true" />
        </button>
      </label>
      <div class="selects">
        <SlidersHorizontal class="selects-icon" :size="16" aria-hidden="true" />
        <label class="select">
          <span class="sr-only">Cuándo</span>
          <select v-model="when">
            <option v-for="o in WHEN_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label class="select">
          <span class="sr-only">Precio</span>
          <select v-model="price">
            <option v-for="o in PRICE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
      </div>
    </div>

    <div class="chips-row">
      <div v-if="categories.length" class="chips" role="group" aria-label="Categorías">
        <button type="button" class="chip" :class="{ 'is-active': !category }" :aria-pressed="!category" @click="category = ''">Todas</button>
        <button
          v-for="c in categories"
          :key="c.name"
          type="button"
          class="chip"
          :class="{ 'is-active': category === c.name }"
          :aria-pressed="category === c.name"
          @click="toggleCategory(c.name)"
        >
          <component :is="c.icon" :size="14" aria-hidden="true" />
          {{ c.name }}
          <span class="chip-count">{{ c.count }}</span>
        </button>
      </div>
      <label v-if="hasDemo" class="toggle">
        <input v-model="hideDemo" type="checkbox" />
        <span class="toggle-box" aria-hidden="true"></span>
        Ocultar eventos de ejemplo
      </label>
    </div>

    <p class="results" aria-live="polite">
      <template v-if="filtered.length">{{ filtered.length }} {{ filtered.length === 1 ? "evento" : "eventos" }}</template>
      <button v-if="activeFilters" type="button" class="results-clear" @click="clearFilters">Limpiar filtros</button>
    </p>

    <!-- Sin eventos públicos: solo hay eventos de ejemplo (privados) y se pidió ocultarlos, o no hay nada -->
    <div v-if="!filtered.length && (hideDemo || !allEvents.length) && !realEvents.length" class="empty">
      <p class="empty-title">Por ahora no hay eventos públicos a la venta</p>
      <p class="empty-text">
        <template v-if="hasDemo">Solo hay eventos privados o de ejemplo en este momento. Los públicos aparecerán aquí apenas un productor publique el suyo.</template>
        <template v-else>No hay eventos a la venta en este momento. ¡Vuelve pronto!</template>
      </p>
      <div class="empty-actions">
        <button v-if="hasDemo" type="button" class="ev-btn ev-btn-secondary" @click="hideDemo = false">Ver eventos de ejemplo</button>
        <a href="/organizadores?utm_source=aitickets&utm_medium=eventos_empty&utm_campaign=listado" class="ev-btn ev-btn-primary">Publica tu evento gratis</a>
      </div>
    </div>

    <!-- Hay eventos, pero ninguno calza con los filtros -->
    <div v-else-if="!filtered.length" class="empty">
      <p class="empty-title">No encontramos eventos con esos filtros</p>
      <p class="empty-text">Prueba con otra búsqueda, otra fecha u otra categoría.</p>
      <div class="empty-actions">
        <button type="button" class="ev-btn ev-btn-secondary" @click="clearFilters">Limpiar filtros</button>
      </div>
    </div>

    <!-- Masonry: CSS columns antes de montar (SSR), columnas balanceadas con JS después -->
    <div v-else-if="!mounted" class="masonry-css">
      <EventCard v-for="(event, index) in filtered" :key="event.id" class="masonry-item" :event="event" :priority="index < 3" />
    </div>
    <div v-else class="masonry" :style="{ '--cols': columnCount }">
      <div v-for="(col, ci) in columns" :key="ci" class="masonry-col">
        <EventCard
          v-for="item in col.items"
          :key="item.event.id"
          class="masonry-item"
          :event="item.event"
          :priority="item.index < 3"
          :style="{ '--i': item.index }"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.events {
  max-width: 1180px;
  margin: 0 auto;
  /* El header del sitio (AppHeader) es fijo */
  padding: 104px 16px 64px;
  font-family: "Prompt", system-ui, sans-serif;
  color: var(--text-1);
}
.events-head {
  text-align: center;
  margin-bottom: 28px;
}
.events-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 30px;
  line-height: 38px;
  font-weight: 700;
}
.events-sub {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 15px;
}

/* ---- Buscador y filtros ---- */
.toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.search {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 16px;
  color: var(--text-2);
  pointer-events: none;
}
.search input {
  width: 100%;
  height: 48px;
  padding: 0 44px 0 46px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface-0);
  font-size: 16px;
  color: var(--text-1);
  transition: border-color 160ms, box-shadow 160ms;
}
.search input::-webkit-search-cancel-button {
  display: none;
}
.search input:focus {
  outline: none;
  border-color: var(--text-1);
  box-shadow: 0 0 0 3px rgba(163, 230, 53, 0.45);
}
.search-clear {
  position: absolute;
  right: 10px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--text-2);
}
.search-clear:hover {
  background: var(--surface-1);
  color: var(--text-1);
}
.selects {
  display: flex;
  align-items: center;
  gap: 8px;
}
.selects-icon {
  display: none;
  flex: 0 0 auto;
  color: var(--text-2);
}
.select {
  flex: 1 1 0;
  min-width: 0;
}
.select select {
  width: 100%;
  height: 44px;
  padding: 0 32px 0 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface-0) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235b5b63' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 14px center;
  appearance: none;
  font-size: 14px;
  color: var(--text-1);
  cursor: pointer;
}
.select select:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}

.chips-row {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  margin: 0 -16px;
  padding: 2px 16px;
}
.chips::-webkit-scrollbar {
  display: none;
}
.chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r-pill);
  background: var(--surface-0);
  font-size: 14px;
  color: var(--text-1);
  white-space: nowrap;
  transition: background 160ms, color 160ms, border-color 160ms, transform 160ms;
}
.chip:hover {
  border-color: var(--text-1);
}
.chip:active {
  transform: scale(0.97);
}
.chip.is-active {
  background: var(--text-1);
  border-color: var(--text-1);
  color: #fff;
}
.chip-count {
  font-size: 12px;
  color: var(--text-3);
}
.chip.is-active .chip-count {
  color: rgba(255, 255, 255, 0.7);
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--text-1);
  cursor: pointer;
  user-select: none;
  align-self: flex-start;
}
.toggle input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}
.toggle-box {
  position: relative;
  width: 36px;
  height: 22px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  transition: background 200ms;
}
.toggle-box::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 200ms var(--ease-out, ease);
}
.toggle input:checked + .toggle-box {
  background: var(--text-1);
}
.toggle input:checked + .toggle-box::after {
  transform: translateX(14px);
}
.toggle input:focus-visible + .toggle-box {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}

.results {
  margin: 18px 0 14px;
  min-height: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--text-2);
}
.results-clear {
  font-size: 14px;
  color: var(--text-1);
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ---- Estados vacíos ---- */
.empty {
  max-width: 520px;
  margin: 24px auto 0;
  padding: 32px 24px;
  text-align: center;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-xl);
  background: var(--surface-1);
  animation: ev-fade-in 300ms ease both;
}
.empty-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
}
.empty-text {
  margin-top: 8px;
  color: var(--text-2);
  font-size: 15px;
  line-height: 22px;
}
.empty-actions {
  margin-top: 20px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

/* ---- Masonry ---- */
.masonry-css {
  columns: 1;
  column-gap: 20px;
}
.masonry-css .masonry-item {
  break-inside: avoid;
  margin-bottom: 20px;
}
.masonry {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 20px;
  align-items: start;
}
.masonry-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.masonry .masonry-item {
  animation: ev-rise 420ms var(--ease-out, ease) backwards;
  animation-delay: calc(min(var(--i, 0), 8) * 50ms);
}
@keyframes ev-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}

@media (min-width: 640px) {
  .events {
    padding: 120px 24px 80px;
  }
  .events-title {
    font-size: 36px;
    line-height: 44px;
  }
  .toolbar {
    flex-direction: row;
    align-items: center;
  }
  .selects {
    flex: 0 0 auto;
  }
  .selects-icon {
    display: block;
  }
  .select {
    flex: 0 0 auto;
  }
  .masonry-css {
    columns: 2;
  }
  .chips-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .chips {
    flex: 1 1 auto;
    margin: 0;
    padding: 2px 0;
    flex-wrap: wrap;
    overflow: visible;
  }
  .toggle {
    flex: 0 0 auto;
    align-self: center;
  }
}
@media (min-width: 1024px) {
  .masonry-css {
    columns: 3;
  }
}
</style>

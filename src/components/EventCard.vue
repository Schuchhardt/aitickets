<script setup>
import { computed } from "vue";
import { CalendarDays, MapPin, ArrowUpRight } from "lucide-vue-next";
import { formatEventDateRange } from "../utils/dateHelpers.js";
import { formatCLP } from "./event/eventView.js";
import { categoryIcon } from "./event/categoryIcons.js";

// Tarjeta del listado /eventos (grilla masonry de EventList.vue): la imagen conserva su proporción real
// (image_ratio, de events.cover_meta) para que la grilla quede escalonada sin recortes.
const props = defineProps({
  event: Object,
  // Las primeras tarjetas (sobre el pliegue) cargan la imagen con prioridad
  priority: Boolean,
});

const href = computed(() => `/eventos/${props.event.slug}`);
// Proporción acotada (ni tiras ni torres): 3:4 a 16:9
const ratio = computed(() => Math.min(16 / 9, Math.max(3 / 4, Number(props.event.image_ratio) || 4 / 5)));
const category = computed(() => props.event.categories?.find((c) => !/^evento cultural$/i.test(c)) || props.event.categories?.[0] || "");
const categoryIconCmp = computed(() => categoryIcon(category.value));
const priceLabel = computed(() => {
  if (props.event.is_free) return "Gratis";
  if (props.event.min_price != null) return `Desde ${formatCLP(props.event.min_price)}`;
  return "";
});
</script>

<template>
  <article class="card">
    <a :href="href" class="card-media" :style="{ aspectRatio: ratio }" tabindex="-1" aria-hidden="true">
      <img
        v-if="event.image_url"
        :src="event.image_url"
        :alt="event.name"
        :loading="priority ? 'eager' : 'lazy'"
        :fetchpriority="priority ? 'high' : 'auto'"
        decoding="async"
      />
      <span class="media-badges">
        <span v-if="category" class="badge badge-glass">
          <component :is="categoryIconCmp" :size="13" aria-hidden="true" />
          {{ category }}
        </span>
        <span v-if="event.is_demo" class="badge badge-demo">Ejemplo</span>
      </span>
    </a>

    <div class="card-body">
      <p v-if="event.start_date || event.dates?.length" class="card-date">
        <CalendarDays :size="14" aria-hidden="true" />
        {{ formatEventDateRange(event) }}
      </p>
      <h2 class="card-title">
        <a :href="href" class="card-link">{{ event.name }}</a>
      </h2>
      <p v-if="event.location" class="card-place">
        <MapPin :size="14" aria-hidden="true" />
        <span>{{ event.location }}</span>
      </p>
      <div class="card-foot">
        <span v-if="priceLabel" class="price" :class="{ 'is-free': event.is_free }">{{ priceLabel }}</span>
        <span class="go" aria-hidden="true"><ArrowUpRight :size="18" /></span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: var(--r-xl);
  overflow: hidden;
  box-shadow: var(--shadow-card);
  transition: transform 260ms var(--ease-out, ease), box-shadow 260ms;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05), 0 18px 40px rgba(0, 0, 0, 0.12);
}
.card:focus-within {
  outline: 2px solid var(--text-1);
  outline-offset: 3px;
}
.card-media {
  position: relative;
  display: block;
  overflow: hidden;
  background: var(--surface-1);
}
.card-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 600ms var(--ease-out, ease);
}
.card:hover .card-media img {
  transform: scale(1.04);
}
.media-badges {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  pointer-events: none;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--r-pill);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.badge-glass {
  background: rgba(255, 255, 255, 0.88);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  color: var(--text-1);
}
.badge-demo {
  background: rgba(10, 10, 11, 0.78);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  color: #fff;
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px 18px;
}
.card-date,
.card-place {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  line-height: 18px;
  color: var(--text-2);
}
.card-date svg,
.card-place svg {
  flex: 0 0 auto;
  margin-top: 2px;
}
.card-date {
  color: var(--text-1);
  font-weight: 500;
}
.card-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
  color: var(--text-1);
}
/* Toda la tarjeta es clickeable */
.card-link::after {
  content: "";
  position: absolute;
  inset: 0;
}
.card-link:focus-visible {
  outline: none;
}
.card-foot {
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.price {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.price.is-free {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--r-pill);
  background: #d9f99d;
  color: #1a2e05;
  font-size: 13px;
}
.go {
  margin-left: auto;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--surface-1);
  color: var(--text-1);
  transition: background 200ms, color 200ms, transform 260ms var(--ease-out, ease);
}
.card:hover .go {
  background: var(--text-1);
  color: #fff;
  transform: rotate(45deg);
}
@media (prefers-reduced-motion: reduce) {
  .card,
  .card-media img,
  .go {
    transition: none;
  }
  .card:hover,
  .card:hover .card-media img {
    transform: none;
  }
}
</style>

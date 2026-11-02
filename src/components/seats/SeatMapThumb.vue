<script setup>
// Miniatura de un mapa de asientos (selector de plantillas del editor): un SVG liviano con un punto por asiento.
import { computed } from "vue";
import { sectionLayout } from "../../lib/seatMap.mjs";

const props = defineProps({ map: { type: Object, required: true } });

const drawing = computed(() => {
  const sections = (props.map?.sections || []).map((sec) => sectionLayout(sec));
  const hasRing = sections.some((s) => s.ring);
  const width = Math.max(...sections.map((s) => s.width), 4);
  let y = hasRing ? 0.2 : 1.8;
  const parts = sections.map((s) => {
    const dx = (width - s.width) / 2;
    const part = { ...s, dx, dy: y };
    y += s.height + 1.2;
    return part;
  });
  return { width, height: y - 0.6, parts, hasRing };
});
</script>

<template>
  <svg :viewBox="`0 0 ${drawing.width.toFixed(2)} ${drawing.height.toFixed(2)}`" preserveAspectRatio="xMidYMid meet" aria-hidden="true" class="thumb">
    <path v-if="!drawing.hasRing" :d="`M ${drawing.width * 0.2} 0.9 Q ${drawing.width / 2} 0.1 ${drawing.width * 0.8} 0.9`" class="stage" />
    <g v-for="(p, i) in drawing.parts" :key="i" :transform="`translate(${p.dx.toFixed(2)} ${p.dy.toFixed(2)})`">
      <path v-if="p.ring" :d="`M ${p.ring.x - p.ring.r} ${p.ring.y} A ${p.ring.r} ${p.ring.r} 0 0 0 ${p.ring.x + p.ring.r} ${p.ring.y} Z`" class="ring" />
      <circle v-for="(t, j) in p.tables || []" :key="`t${j}`" :cx="t.x" :cy="t.y" :r="t.r" class="table" />
      <circle v-for="s in p.seats.filter((x) => !x.removed)" :key="s.key" :cx="s.x" :cy="s.y" r="0.36" class="seat" />
    </g>
  </svg>
</template>

<style scoped>
.thumb {
  width: 100%;
  height: 100%;
  display: block;
}
.seat {
  fill: #6b7280;
}
.table {
  fill: #e5e7eb;
}
.ring {
  fill: #fde68a;
}
.stage {
  fill: none;
  stroke: #9ca3af;
  stroke-width: 0.35;
}
</style>

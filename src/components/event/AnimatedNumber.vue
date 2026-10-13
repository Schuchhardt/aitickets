<script setup>
// A9: interpola montos al cambiar (300 ms, ease-out, cifras tabulares). Con prefers-reduced-motion salta directo.
import { ref, watch, onBeforeUnmount } from "vue";
import { formatCLP } from "./eventView.js";

const props = defineProps({
  value: { type: Number, default: 0 },
  // "clp" => $10.952 ; "plain" => 10952
  format: { type: String, default: "clp" },
});

const shown = ref(props.value);
let frame = null;

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

watch(
  () => props.value,
  (to) => {
    cancelAnimationFrame(frame);
    const from = shown.value;
    if (reduced() || from === to) {
      shown.value = to;
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 300);
      shown.value = Math.round(from + (to - from) * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  },
);
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
  <span class="ev-tabular">{{ format === "clp" ? formatCLP(shown) : shown }}</span>
</template>

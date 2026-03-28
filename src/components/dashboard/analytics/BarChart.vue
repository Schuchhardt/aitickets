<script setup>
import { computed } from "vue";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps({
  labelsJson: { type: String, required: true },
  datasetsJson: { type: String, required: true },
  title: { type: String, required: true },
  horizontal: { type: Boolean, default: false },
});

const labels = computed(() => {
  try { return JSON.parse(props.labelsJson); } catch { return []; }
});

const datasets = computed(() => {
  try { return JSON.parse(props.datasetsJson); } catch { return []; }
});

const isEmpty = computed(() => labels.value.length === 0);

const chartData = computed(() => ({
  labels: labels.value,
  datasets: datasets.value,
}));

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: props.horizontal ? "y" : "x",
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: "#111", titleFont: { family: "Prompt" }, bodyFont: { family: "Prompt" }, padding: 10, cornerRadius: 8 },
  },
  scales: {
    x: { grid: { display: props.horizontal }, ticks: { font: { family: "Prompt", size: 11 } }, beginAtZero: true },
    y: { grid: { display: !props.horizontal, color: "#f3f4f6" }, ticks: { font: { family: "Prompt", size: 11 } }, beginAtZero: true },
  },
}));
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
    <h3 class="font-bold text-lg text-gray-900 mb-4">{{ title }}</h3>
    <div v-if="isEmpty" class="h-64 flex items-center justify-center text-gray-400 text-sm">
      No hay datos disponibles
    </div>
    <div v-else class="h-64">
      <Bar :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

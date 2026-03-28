<script setup>
import { computed } from "vue";
import { Line } from "vue-chartjs";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const props = defineProps({
  labelsJson: { type: String, required: true },
  datasetsJson: { type: String, required: true },
  title: { type: String, required: true },
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

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: "index" },
  plugins: {
    legend: { display: true, position: "bottom", labels: { font: { family: "Prompt", size: 12 }, usePointStyle: true, padding: 16 } },
    tooltip: { backgroundColor: "#111", titleFont: { family: "Prompt" }, bodyFont: { family: "Prompt" }, padding: 10, cornerRadius: 8 },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: "Prompt", size: 11 }, maxTicksLimit: 10 } },
    y: { grid: { color: "#f3f4f6" }, ticks: { font: { family: "Prompt", size: 11 } }, beginAtZero: true },
  },
};
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
    <h3 class="font-bold text-lg text-gray-900 mb-4">{{ title }}</h3>
    <div v-if="isEmpty" class="h-64 flex items-center justify-center text-gray-400 text-sm">
      No hay datos disponibles
    </div>
    <div v-else class="h-64">
      <Line :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

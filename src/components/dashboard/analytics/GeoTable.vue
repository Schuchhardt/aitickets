<script setup>
import { computed } from "vue";

const props = defineProps({
  dataJson: { type: String, required: true },
  title: { type: String, required: true },
});

const data = computed(() => {
  try { return JSON.parse(props.dataJson); } catch { return []; }
});

const isEmpty = computed(() => data.value.length === 0);
</script>

<template>
  <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
    <h3 class="font-bold text-lg text-gray-900 mb-4">{{ title }}</h3>
    <div v-if="isEmpty" class="h-64 flex items-center justify-center text-gray-400 text-sm">
      No hay datos disponibles
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-100">
            <th class="text-left py-3 px-2 text-gray-500 font-medium">Ubicacion</th>
            <th class="text-right py-3 px-2 text-gray-500 font-medium">Visitas</th>
            <th class="text-right py-3 px-2 text-gray-500 font-medium w-32">%</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in data" :key="i" class="border-b border-gray-50 hover:bg-gray-50 transition">
            <td class="py-3 px-2 text-gray-900">{{ row.location }}</td>
            <td class="py-3 px-2 text-right text-gray-700 font-medium">{{ row.visits }}</td>
            <td class="py-3 px-2 text-right">
              <div class="flex items-center justify-end gap-2">
                <div class="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div class="h-full bg-black rounded-full" :style="{ width: row.percentage + '%' }"></div>
                </div>
                <span class="text-gray-500 text-xs w-8 text-right">{{ row.percentage }}%</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

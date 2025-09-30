<template>
  <div
    v-if="show"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
    @click.self="$emit('close')"
  >
    <div class="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
      <!-- Header -->
      <div class="sticky top-0 bg-white border-b border-gray-200 p-6 rounded-t-2xl">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-gray-900 font-['Unbounded']">
              Tus Órdenes
            </h2>
            <p class="text-gray-600 mt-1">{{ event?.name }}</p>
          </div>
          <button
            @click="$emit('close')"
            class="p-2 hover:bg-gray-100 rounded-full transition-colors"
            aria-label="Cerrar modal"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="p-6">
        <div v-if="eventOrders && eventOrders.length > 0" class="space-y-4">
          <!-- Orders List -->
          <div class="grid gap-4">
            <div
              v-for="order in eventOrders"
              :key="order.orderId"
              class="border border-gray-200 rounded-lg p-6 bg-white hover:shadow-md transition-shadow"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <!-- Order Header -->
                  <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-semibold text-gray-900 font-['Unbounded']">
                      Orden #{{ order.orderId }}
                    </h3>
                    <span class="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                      Pagado
                    </span>
                  </div>

                  <!-- Order Details -->
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="space-y-2">
                      <p class="text-sm text-gray-600">
                        <span class="font-medium">Fecha de compra:</span>
                        {{ formatDate(order.purchaseDate) }}
                      </p>
                      <p class="text-sm text-gray-600">
                        <span class="font-medium">Total pagado:</span>
                        ${{ formatPrice(order.amount) }}
                      </p>
                    </div>
                    <div class="space-y-2">
                      <p class="text-sm text-gray-600">
                        <span class="font-medium">Cantidad de entradas:</span>
                        {{ order.ticketsCount }}
                      </p>
                      <p class="text-sm text-gray-600">
                        <span class="font-medium">Entradas por:</span>
                        ${{ formatPrice(order.amount / order.ticketsCount) }} c/u
                      </p>
                    </div>
                  </div>

                  <!-- Tickets Preview -->
                  <div class="mb-4">
                    <h4 class="text-sm font-medium text-gray-900 mb-2">Entradas en esta orden:</h4>
                    <div class="space-y-2">
                      <div
                        v-for="(ticket, index) in order.tickets.slice(0, 3)"
                        :key="ticket.id || index"
                        class="flex items-center text-sm text-gray-600"
                      >
                        <svg class="w-4 h-4 mr-2 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                        </svg>
                        {{ ticket.first_name }} {{ ticket.last_name }}
                      </div>
                      <div v-if="order.tickets.length > 3" class="text-sm text-gray-500 ml-6">
                        +{{ order.tickets.length - 3 }} más
                      </div>
                    </div>
                  </div>

                  <!-- Actions -->
                  <div class="flex flex-col sm:flex-row gap-3">
                    <a
                      :href="`/order/${order.orderId}`"
                      target="_blank"
                      class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-medium transition-colors text-center inline-flex items-center justify-center"
                    >
                      <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                        <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
                      </svg>
                      Ver detalles y QR
                    </a>
                    <button
                      @click="downloadOrderTickets(order)"
                      class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 py-2 px-4 rounded-lg font-medium transition-colors"
                    >
                      Descargar PDF
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Summary -->
          <div class="border-t border-gray-200 pt-6 bg-gray-50 rounded-lg p-4">
            <div class="flex justify-between items-center">
              <div>
                <p class="text-lg font-semibold text-gray-900">
                  Total de órdenes: {{ eventOrders.length }}
                </p>
                <p class="text-sm text-gray-600">
                  Total de entradas: {{ totalTickets }}
                </p>
              </div>
              <div class="text-right">
                <p class="text-lg font-semibold text-gray-900">
                  Total pagado: ${{ formatPrice(totalAmount) }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="text-center py-8">
          <p class="text-gray-600">No se encontraron órdenes para este evento.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineProps, defineEmits, computed } from 'vue'
import { showInfo } from '../lib/toastBus.js'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  eventOrders: {
    type: Array,
    default: () => []
  },
  event: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close'])

// Computed properties for summary
const totalTickets = computed(() => {
  return props.eventOrders.reduce((total, order) => total + order.ticketsCount, 0)
})

const totalAmount = computed(() => {
  return props.eventOrders.reduce((total, order) => total + order.amount, 0)
})

// Format price with thousands separator
const formatPrice = (price) => {
  return price !== null && price !== undefined ? price.toLocaleString("es-CL") : "0";
}

// Format date
const formatDate = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleDateString('es-CL', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Download tickets for a specific order (placeholder)
const downloadOrderTickets = (order) => {
  showInfo(`Descargando entradas de la orden #${order.orderId}`)
}
</script>
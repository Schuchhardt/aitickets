<script setup>
import { ref, computed } from "vue";

const props = defineProps({
  event: Object, // El evento con sus tickets
});

const emit = defineEmits(["close"]);

const currentStep = ref(1);
const selectedTickets = ref({}); // Almacena la cantidad seleccionada por ticket
const buyerInfo = ref({
  firstName: "",
  lastName: "",
  email: "",
});

// ✅ Función para calcular el total de las entradas seleccionadas
const totalAmount = computed(() => {
  return Object.keys(selectedTickets.value).reduce((sum, ticketId) => {
    const ticket = props.event.tickets.find(t => t.id == ticketId);
    return sum + (ticket ? ticket.price * selectedTickets.value[ticketId] : 0);
  }, 0);
});

// ✅ Función para avanzar de paso
const nextStep = () => {
  if (currentStep.value < 3) currentStep.value++;
};

// ✅ Función para regresar al paso anterior
const prevStep = () => {
  if (currentStep.value > 1) currentStep.value--;
};

// ✅ Función para cerrar el modal si se hace clic fuera
const closeModal = (event) => {
  if (event.target.id === "modal-overlay") {
    emit("close");
  }
};

// ✅ Generar un link de pago basado en el total
const getPaymentLink = () => {
  return `https://payment-provider.com/pay?amount=${totalAmount.value}`;
};
</script>

<template>
  <div
    id="modal-overlay"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
    @click="closeModal"
  >
    <div class="bg-white rounded-lg shadow-xl max-w-3xl w-full" @click.stop>
      <!-- 🔹 Título centrado -->
      <div class="text-center py-4 border-b">
        <h2 class="text-2xl font-bold">{{ event.name }}</h2>
      </div>

      <!-- 🔹 Pasos -->
      <div class="flex justify-between border-b px-6 py-3 text-gray-600 text-sm font-semibold">
        <div class="flex-1 text-center" :class="currentStep === 1 ? 'text-black' : ''">
          1. Seleccionar entradas
        </div>
        <div class="flex-1 text-center" :class="currentStep === 2 ? 'text-black' : ''">
          2. Datos del comprador
        </div>
        <div class="flex-1 text-center" :class="currentStep === 3 ? 'text-black' : ''">
          3. Pago
        </div>
      </div>

      <!-- 🔹 Contenido del Paso -->
      <div class="p-6">
        <!-- ✅ Paso 1: Selección de Entradas -->
        <div v-if="currentStep === 1">
          <h3 class="text-lg font-semibold mb-4">Elige tus entradas</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- 🎫 Entradas disponibles -->
            <div>

              <!-- <div class="text-center border-b pb-4">
                <p class="text-gray-500 text-sm">Fecha</p>
                <p class="text-lg font-semibold">
                  {{ new Date(event.start_date).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "long" }) }}
                  - 
                  {{ new Date(event.end_date).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "long" }) }}
                </p>
                <p class="text-gray-500 text-sm">
                  {{ event.start_time }} - {{ event.end_time }}
                </p>
              </div> -->


              <div
                v-for="ticket in event.tickets.filter(t => t.max_quantity > 0 && !t.is_gift)"
                :key="ticket.id"
                class="border p-4 rounded-lg flex justify-between items-center"
              >
                <div>
                  <p class="font-medium">{{ ticket.ticket_name }}</p>
                  <p class="text-gray-500">{{ ticket.price > 0 ? `$${ticket.price}` : "Gratis" }}</p>
                </div>
                <select
                  v-model="selectedTickets[ticket.id]"
                  class="border rounded-md p-1"
                >
                  <option :value="0">0</option>
                  <option v-for="n in ticket.max_quantity" :key="n" :value="n">
                    {{ n }}
                  </option>
                </select>
              </div>
            </div>

            <!-- 💰 Total -->
            <div class="border p-4 rounded-lg">
              <h4 class="font-semibold text-lg mb-4">Resumen</h4>
              <ul class="mb-4">
                <li
                  v-for="ticketId in Object.keys(selectedTickets)"
                  :key="ticketId"
                  v-if="selectedTickets[ticketId] > 0"
                  class="flex justify-between"
                >
                  <span>
                    {{ event.tickets.find(t => t.id == ticketId)?.ticket_name }} (x{{ selectedTickets[ticketId] }})
                  </span>
                  <span class="font-medium">
                    ${{ event.tickets.find(t => t.id == ticketId)?.price * selectedTickets[ticketId] }}
                  </span>
                </li>
              </ul>
              <div class="flex justify-between text-xl font-bold">
                <span>Total:</span>
                <span>${{ totalAmount }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ✅ Paso 2: Datos del Comprador -->
        <div v-if="currentStep === 2">
          <h3 class="text-lg font-semibold mb-4">Datos del comprador</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              v-model="buyerInfo.firstName"
              type="text"
              placeholder="Nombre"
              class="border p-2 rounded-md w-full"
            />
            <input
              v-model="buyerInfo.lastName"
              type="text"
              placeholder="Apellido"
              class="border p-2 rounded-md w-full"
            />
            <input
              v-model="buyerInfo.email"
              type="email"
              placeholder="Correo electrónico"
              class="border p-2 rounded-md w-full col-span-2"
            />
          </div>
        </div>

        <!-- ✅ Paso 3: Pago -->
        <div v-if="currentStep === 3" class="text-center">
          <h3 class="text-lg font-semibold mb-4">Completa tu pago</h3>
          <p class="text-gray-600 mb-4">Haz clic en el botón para completar tu pago.</p>
          <a
            :href="getPaymentLink()"
            class="bg-black text-white px-6 py-2 rounded-md inline-block"
          >
            Ir a pagar
          </a>
        </div>
      </div>

      <!-- 🔹 Botones de Navegación -->
      <div class="flex justify-between p-6 border-t">
        <button
          v-if="currentStep > 1"
          @click="prevStep"
          class="text-gray-600 hover:text-black"
        >
          Atrás
        </button>
        <button
          v-if="currentStep < 3"
          @click="nextStep"
          class="bg-lime-500 text-white px-6 py-2 rounded-md"
        >
          Continuar
        </button>
      </div>
    </div>
  </div>
</template>

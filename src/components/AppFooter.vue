<script setup is:client>
import logoLight from "../images/logo.png";
import iconArrowGreen from "../images/icon-arrow-green.png";
import iconFacebook from "../images/icon-facebook.png";
import iconLinkedIn from "../images/icon-linkedin.png";
import { ref, onMounted } from "vue";

// Estado del formulario
const email = ref("");
const isFocused = ref(false);
const successMessage = ref("");
const errorMessage = ref("");

// Se obtiene el mensaje de éxito solo en el cliente
onMounted(() => {
  if (typeof window !== "undefined") {
    successMessage.value = localStorage.getItem("subscriptionSuccess") || "";
  }
});

const getTrackingSource = () => {
  const referrer = document.referrer;
  const params = new URLSearchParams(window.location.search);
  
  if (referrer) return referrer; // Si hay referrer, usarlo

  // Construir string con UTM si no hay referrer
  const utmParams = [
    params.get("utm_source") ? `utm_source=${params.get("utm_source")}` : "",
    params.get("utm_medium") ? `utm_medium=${params.get("utm_medium")}` : "",
    params.get("utm_campaign") ? `utm_campaign=${params.get("utm_campaign")}` : "",
    params.get("utm_term") ? `utm_term=${params.get("utm_term")}` : "",
    params.get("utm_content") ? `utm_content=${params.get("utm_content")}` : ""
  ].filter(Boolean).join("&");

  return utmParams || "direct"; // Si no hay UTM ni referrer, marcar como tráfico directo
}

// Función para manejar el envío del formulario
const submitForm = async (event) => {
  event.preventDefault(); // Evita recarga de la página
  
  if (email.value.trim() === "") return;
  
  try {
    // Simulación de llamada a la API (reemplázalo con fetch real)
    const response = await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        email: email.value,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: navigator.userAgent,
        referrer: getTrackingSource()
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Error desconocido");
    }

    // Guardar mensaje de éxito en localStorage solo en el cliente
    successMessage.value = "¡Gracias por suscribirte!";
    if (typeof window !== "undefined") {
      localStorage.setItem("subscriptionSuccess", successMessage.value);
    }

    email.value = "";
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error.message;
  }
};
</script>

<template>
  <footer class="bg-white py-6 border-t border-gray-200">
    <div class="container mx-auto flex flex-col lg:flex-row items-center justify-between space-y-6 lg:space-y-0 px-6">
      
      <!-- Logo con enlace al root -->
      <div class="flex justify-center lg:justify-start w-full lg:w-auto">
        <a href="/" class="cursor-pointer">
          <img :src="logoLight.src" alt="AI Tickets" class="h-8" />
        </a>
      </div>

      <!-- Formulario de suscripción o mensaje de éxito -->
      <div class="flex flex-col items-center lg:items-end w-full lg:w-auto">
        <p class="text-gray-900 font-bold text-sm font-['Unbounded']">
          Únete a la comunidad AI 🔥
        </p>
        <div v-if="!successMessage" class="relative mt-2">
          <form @submit.prevent="submitForm" class="flex">
            <input 
              v-model="email" 
              type="email"
              name="email" 
              placeholder="Ingresa tu correo"
              @focus="isFocused = true"
              @blur="isFocused = false"
              class="w-64 lg:w-80 border border-gray-300 py-2 pl-4 pr-16 rounded-full text-gray-600 font-['Prompt'] focus:outline-none focus:ring-2 focus:ring-gray-300 cursor-pointer"
              required
            />
            <button 
              type="submit"
              class="absolute right-2 top-1/2 transform -translate-y-1/2 w-10 h-10 rounded-full transition-transform duration-300 cursor-pointer flex items-center justify-center"
              :class="{ 'rotate-45': isFocused || email.length > 0 }">
              <img :src="iconArrowGreen.src" alt="Enviar" class="w-6 h-6 transition-transform duration-300" />
            </button>
          </form>
        </div>

        <!-- Mensaje de confirmación -->
        <p v-else class="text-green-600 font-bold mt-2 font-['Prompt']">{{ successMessage }}</p>

        <!-- Mensaje de error -->
        <p v-if="errorMessage" class="text-red-500 mt-2 text-sm font-['Prompt']">{{ errorMessage }}</p>
      </div>

    </div>

    <!-- 🌐 Redes sociales -->
    <div class="flex justify-center space-x-4 mt-4">
      <a href="https://www.facebook.com/profile.php?id=61573771138631" target="_blank" class="cursor-pointer">
        <img :src="iconFacebook.src" alt="Facebook" class="w-6 h-6" />
      </a>
      <a href="https://linkedin.com" target="_blank" class="cursor-pointer">
        <img :src="iconLinkedIn.src" alt="LinkedIn" class="w-6 h-6" />
      </a>
    </div>

    <!-- 📜 Links de términos y condiciones -->
    <div class="mt-6 text-center text-gray-500 text-sm font-['Prompt']">
      <div class="flex justify-center space-x-4">
        <a href="/terms" class="hover:underline">Términos y condiciones</a>
        <span>|</span>
        <a href="/privacy" class="hover:underline">Aviso de privacidad</a>
      </div>
    </div>

  </footer>
</template>

<style scoped>
/* ✅ Ahora la animación funciona correctamente */
.rotate-45 {
  transform: rotate(5deg);
}
</style>

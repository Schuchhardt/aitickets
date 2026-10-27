<script setup is:client>
import logoLight from "../images/logo.png";
import iconArrowGreen from "../images/icon-arrow-green.png";
import { ref, onMounted } from "vue";
import { LEGAL } from "../lib/legal";

// Enlaces internos del sitio por columna (no quitar ninguno: sostienen el SEO de las landings y guías)
const columns = [
  {
    title: "Producto",
    links: [
      { href: "/eventos", label: "Eventos" },
      { href: "/organizadores", label: "Para organizadores" },
      { href: "/organizadores/registro", label: "Crear cuenta de productor" },
      { href: "/precios", label: "Precios" },
      { href: "/web-gratis", label: "Web de eventos gratis" },
      { href: "/organizadores#ia", label: "Conecta tu IA" },
      { href: "/presentacion", label: "Presentación" },
    ],
  },
  {
    title: "Para quién",
    links: [
      { href: "/ticketera-stand-up", label: "Stand-up" },
      { href: "/ticketera-teatro", label: "Teatro" },
      { href: "/ticketera-musica-en-vivo", label: "Música en vivo" },
      { href: "/ticketera-talleres", label: "Talleres" },
    ],
  },
  {
    title: "Recursos",
    links: [
      { href: "/guias", label: "Guías" },
      { href: "/vender-entradas-online", label: "Vender entradas online" },
      { href: "/entradas-con-qr", label: "Entradas con QR" },
      { href: "/ventas-por-promotor", label: "Ventas por promotor" },
      { href: "/ticketeras-en-chile", label: "Ticketeras en Chile" },
    ],
    newsletter: true,
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Términos y condiciones" },
      { href: "/terminos-productores", label: "Términos para productores" },
      { href: "/privacy", label: "Aviso de privacidad" },
    ],
  },
];

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
  <!-- Cuatro columnas en desktop (rediseño, SPEC_landing_productores §5.10): Producto · Para quién · Recursos · Legal.
       Mismos enlaces internos de siempre (valor SEO); el formulario de la comunidad va en Recursos. -->
  <footer class="bg-white border-t border-gray-200 font-['Prompt']">
    <div class="max-w-[1120px] mx-auto px-4 md:px-8 pt-14 pb-10 grid gap-10 grid-cols-2 lg:grid-cols-5 text-sm">
      <div class="col-span-2 lg:col-span-1">
        <a href="/" class="inline-block cursor-pointer">
          <img :src="logoLight.src" alt="AI Tickets" class="h-8 w-auto" width="152" height="32" />
        </a>
        <p class="mt-3 text-xs text-gray-500">© 2026 {{ LEGAL.brand }}</p>
        <div class="flex space-x-4 mt-4">
          <a href="https://www.facebook.com/profile.php?id=61573771138631" target="_blank" rel="noopener noreferrer" class="cursor-pointer">
            <img src="https://cdn.simpleicons.org/facebook/000000" alt="Facebook" class="w-6 h-6" loading="lazy" width="24" height="24" />
          </a>
          <a href="https://www.linkedin.com/company/ai-tickets" target="_blank" rel="noopener noreferrer" class="cursor-pointer">
            <img src="https://upload.wikimedia.org/wikipedia/commons/8/81/LinkedIn_icon.svg" alt="LinkedIn" class="w-6 h-6" loading="lazy" width="24" height="24" />
          </a>
        </div>
      </div>

      <nav v-for="col in columns" :key="col.title" :aria-label="col.title" class="min-w-0">
        <p class="font-semibold text-gray-900">{{ col.title }}</p>
        <ul class="mt-3 flex flex-col gap-2.5 text-gray-600">
          <li v-for="link in col.links" :key="link.href"><a :href="link.href" class="hover:text-gray-900 hover:underline">{{ link.label }}</a></li>
        </ul>

        <!-- Formulario de suscripción o mensaje de éxito (columna Recursos) -->
        <div v-if="col.newsletter" class="mt-6">
          <p class="text-gray-900 font-semibold">Únete a la comunidad AI 🔥</p>
          <div v-if="!successMessage" class="relative mt-2">
            <form @submit.prevent="submitForm" class="flex">
              <input
                v-model="email"
                type="email"
                name="email"
                placeholder="Ingresa tu correo"
                aria-label="Tu correo"
                @focus="isFocused = true"
                @blur="isFocused = false"
                class="w-full max-w-64 border border-gray-300 py-2 pl-4 pr-12 rounded-full text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-300"
                required
              />
              <button
                type="submit"
                class="absolute right-1 top-1/2 transform -translate-y-1/2 w-9 h-9 rounded-full transition-transform duration-300 cursor-pointer flex items-center justify-center"
                :class="{ 'rotate-45': isFocused || email.length > 0 }"
                aria-label="Enviar"
              >
                <img :src="iconArrowGreen.src" alt="" class="w-5 h-5 transition-transform duration-300" />
              </button>
            </form>
          </div>
          <!-- Mensaje de confirmación -->
          <p v-else class="text-green-700 font-semibold mt-2">{{ successMessage }}</p>
          <!-- Mensaje de error -->
          <p v-if="errorMessage" class="text-red-600 mt-2 text-sm">{{ errorMessage }}</p>
        </div>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
/* ✅ Ahora la animación funciona correctamente */
.rotate-45 {
  transform: rotate(5deg);
}
</style>

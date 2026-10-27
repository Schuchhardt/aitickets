<script setup is:client>
import logoLight from "../images/logo.png";
import iconArrowGreen from "../images/icon-arrow-green.png";
import { computed, ref, onMounted } from "vue";
import { LEGAL } from "../lib/legal";

const props = defineProps({
  /**
   * 'dark': versión oscura para las landings con tema oscuro (/ticketera-stand-up); 'paper': fondo papel de la landing
   * de academias (/academias); 'sala': azul noche de sala de la landing de teatro (/ticketera-teatro), mismas clases
   * que 'dark' con otros colores. Mismos enlaces, otros colores.
   */
  tone: { type: String, required: false },
});
// Clases que cambian con el tono (el resto del footer es igual en todos)
const toneClasses = computed(() =>
  props.tone === 'paper'
    ? {
        footer: "bg-[#fbf7f0] border-[#1b1712]/10",
        logo: "",
        muted: "text-[#6f665c]",
        icon: "",
        title: "text-[#1b1712]",
        list: "text-[#5e554b]",
        link: "hover:text-[#1b1712] hover:underline",
        input: "border-[#1b1712]/20 bg-white text-[#3e372f] focus:ring-[#1b1712]/20",
        success: "text-green-700",
        error: "text-red-600",
      }
    : props.tone === 'sala'
    ? {
        footer: "bg-[#0c1220] border-white/10",
        logo: "invert",
        muted: "text-[#a49d8e]",
        icon: "invert",
        title: "text-[#f0e8d8]",
        list: "text-[#a49d8e]",
        link: "hover:text-white hover:underline",
        input: "border-white/20 bg-transparent text-[#f0e8d8] placeholder:text-[#8a8478] focus:ring-white/30",
        success: "text-lime-400",
        error: "text-red-400",
      }
    : props.tone === 'dark'
    ? {
        footer: "bg-[#0e0b09] border-white/10",
        logo: "invert",
        muted: "text-[#b5aba0]",
        icon: "invert",
        title: "text-[#f4ede4]",
        list: "text-[#b5aba0]",
        link: "hover:text-white hover:underline",
        input: "border-white/20 bg-transparent text-[#f4ede4] placeholder:text-[#8e8378] focus:ring-white/30",
        success: "text-lime-400",
        error: "text-red-400",
      }
    : {
        footer: "bg-white border-gray-200",
        logo: "",
        muted: "text-gray-500",
        icon: "",
        title: "text-gray-900",
        list: "text-gray-600",
        link: "hover:text-gray-900 hover:underline",
        input: "border-gray-300 text-gray-600 focus:ring-gray-300",
        success: "text-green-700",
        error: "text-red-600",
      },
);

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
      { href: "/academias", label: "Academias" },
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
  <footer class="border-t font-['Prompt']" :class="toneClasses.footer">
    <div class="max-w-[1120px] mx-auto px-4 md:px-8 pt-14 pb-10 grid gap-10 grid-cols-2 lg:grid-cols-5 text-sm">
      <div class="col-span-2 lg:col-span-1">
        <a href="/" class="inline-block cursor-pointer">
          <img :src="logoLight.src" alt="AI Tickets" class="h-8 w-auto" :class="toneClasses.logo" width="152" height="32" />
        </a>
        <p class="mt-3 text-xs" :class="toneClasses.muted">© 2026 {{ LEGAL.brand }}</p>
        <div class="flex space-x-4 mt-4">
          <a href="https://www.facebook.com/profile.php?id=61573771138631" target="_blank" rel="noopener noreferrer" class="cursor-pointer">
            <img src="https://cdn.simpleicons.org/facebook/000000" alt="Facebook" class="w-6 h-6" :class="toneClasses.icon" loading="lazy" width="24" height="24" />
          </a>
          <a href="https://www.linkedin.com/company/ai-tickets" target="_blank" rel="noopener noreferrer" class="cursor-pointer">
            <img src="https://upload.wikimedia.org/wikipedia/commons/8/81/LinkedIn_icon.svg" alt="LinkedIn" class="w-6 h-6" loading="lazy" width="24" height="24" />
          </a>
        </div>
      </div>

      <nav v-for="col in columns" :key="col.title" :aria-label="col.title" class="min-w-0">
        <p class="font-semibold" :class="toneClasses.title">{{ col.title }}</p>
        <ul class="mt-3 flex flex-col gap-2.5" :class="toneClasses.list">
          <li v-for="link in col.links" :key="link.href"><a :href="link.href" :class="toneClasses.link">{{ link.label }}</a></li>
        </ul>

        <!-- Formulario de suscripción o mensaje de éxito (columna Recursos) -->
        <div v-if="col.newsletter" class="mt-6">
          <p class="font-semibold" :class="toneClasses.title">Únete a la comunidad AI 🔥</p>
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
                class="w-full max-w-64 border py-2 pl-4 pr-12 rounded-full focus:outline-none focus:ring-2"
                :class="toneClasses.input"
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
          <p v-else class="font-semibold mt-2" :class="toneClasses.success">{{ successMessage }}</p>
          <!-- Mensaje de error -->
          <p v-if="errorMessage" class="mt-2 text-sm" :class="toneClasses.error">{{ errorMessage }}</p>
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

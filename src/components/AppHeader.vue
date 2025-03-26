<script setup>
import { ref } from 'vue';
import { Menu, X } from 'lucide-vue-next';
import logoLight from '../images/logo.png';

const mobileMenuOpen = ref(false);
const showMobileMenu = ref(false);

const toggleMenu = () => {
  if (mobileMenuOpen.value) {
    // Reproducir animación de salida antes de ocultar
    const menu = document.getElementById('mobile-menu');
    if (menu) {
      menu.classList.remove('animate__fadeInDown');
      menu.classList.add('animate__fadeOutUp');
      setTimeout(() => {
        showMobileMenu.value = false;
        mobileMenuOpen.value = false;
      }, 500); // espera la duración de la animación
    }
  } else {
    showMobileMenu.value = true;
    mobileMenuOpen.value = true;
  }
};
</script>

<template>
  <nav
    class="fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-white py-4 shadow-sm text-gray-900"
  >
    <div class="container mx-auto px-4 md:px-8">
      <div class="flex items-center justify-between">
        <a href="/" class="flex items-center space-x-2">
          <img :src="logoLight.src" alt="AI Tickets" class="h-8" />
        </a>

        <!-- Desktop Menu -->
        <div class="hidden md:flex items-center space-x-8">
          <a href="/eventos" class="text-sm font-medium font-[Unbounded] hover:text-ait-accent transition-colors">
            Eventos
          </a>
          <a href="/organizadores" class="text-sm font-medium font-[Unbounded] hover:text-ait-accent transition-colors">
            Para Organizadores
          </a>
        </div>

        <!-- <div class="hidden md:flex items-center space-x-4">
          <a
            href="/iniciar-sesion"
            :class="['text-sm font-medium px-4 py-2 rounded-full font-[Unbounded] transition-colors hover:bg-white/10']"
          >
            Iniciar Sesión/Registro
          </a> 
        </div>
        -->

        <!-- Mobile Menu Button -->
        <button type="button" class="md:hidden" @click="toggleMenu">
          <template v-if="!mobileMenuOpen">
            <Menu size="24" />
          </template>
          <template v-else>
            <X size="24" />
          </template>
        </button>
      </div>

      <!-- Mobile Menu -->
      <div
        v-if="showMobileMenu"
        id="mobile-menu"
        class="md:hidden fixed top-16 left-4 right-4 bg-white shadow-md p-4 text-gray-900 z-40 rounded-lg animate__animated"
        :class="mobileMenuOpen ? 'animate__fadeInDown' : ''"
      >
        <div class="flex flex-col space-y-4">
          <a href="/" class="text-sm font-medium px-4 py-2 hover:bg-secondary rounded-md transition-colors">
            Inicio
          </a>
          <a href="/eventos" class="text-sm font-medium px-4 py-2 hover:bg-secondary rounded-md transition-colors">
            Eventos
          </a>
          <a href="/organizadores" class="text-sm font-medium px-4 py-2 hover:bg-secondary rounded-md transition-colors">
            Para Organizadores
          </a>
          <!-- <div class="pt-2 border-t border-gray-100">
            <a href="/iniciar-sesion" class="block text-sm font-medium px-4 py-2 hover:bg-secondary rounded-md transition-colors">
              Iniciar Sesión/Registrarse
            </a>
          </div> -->
        </div>
      </div>
    </div>
  </nav>
</template>
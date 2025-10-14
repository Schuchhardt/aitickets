<script setup>
import { ref, onMounted } from 'vue';
import { Menu, X } from 'lucide-vue-next';
import logoLight from '../images/logo.png';

const mobileMenuOpen = ref(false);
const showMobileMenu = ref(false);
const currentPath = ref('/');

onMounted(() => {
  currentPath.value = window.location.pathname;
});

const toggleMenu = () => {
  if (mobileMenuOpen.value) {
    const menu = document.getElementById('mobile-menu');
    if (menu) {
      menu.classList.remove('animate__fadeInDown');
      menu.classList.add('animate__fadeOutUp');
      setTimeout(() => {
        showMobileMenu.value = false;
        mobileMenuOpen.value = false;
      }, 500);
    }
  } else {
    showMobileMenu.value = true;
    mobileMenuOpen.value = true;
  }
};
</script>

<template>
  <nav data-testid="navbar" class="fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-white py-4 shadow-sm text-gray-900">
    <div class="w-full max-w-screen-xl mx-auto px-4 md:px-8 overflow-hidden">
      <div class="flex items-center justify-between">
        <a href="/" data-testid="nav-logo" class="flex items-center space-x-2">
          <img :src="logoLight.src" alt="AI Tickets" class="h-8" />
        </a>

        <!-- Desktop Menu -->
        <div data-testid="nav-menu-desktop" class="hidden md:flex items-center space-x-8">
          <a
            v-if="currentPath !== '/'"
            href="/"
            data-testid="nav-link-home"
            class="text-sm font-medium font-[Unbounded] hover:bg-black hover:text-white text-black transition-colors"
          >
            Inicio
          </a>
          <a
            v-if="currentPath !== '/eventos'"
            href="/eventos"
            data-testid="nav-link-events"
            class="text-sm font-medium font-[Unbounded] hover:bg-black hover:text-white text-black transition-colors"
          >
            Eventos
          </a>
          <a
            v-if="currentPath !== '/organizadores'"
            href="/organizadores"
            data-testid="nav-link-producers"
            class="text-sm font-medium font-[Unbounded] hover:bg-black hover:text-white text-black transition-colors"
          >
            Para Organizadores
          </a>
        </div>

        <!-- Mobile Menu Button -->
        <button type="button" data-testid="nav-menu-mobile" class="md:hidden" @click="toggleMenu" aria-label="Toggle menu">
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
          <a
            href="/"
            :class="[
              'text-sm font-medium font-[Unbounded] px-4 py-2 hover:bg-secondary rounded-md transition-colors',
              currentPath === '/' ? 'bg-secondary bg-black text-white' : ''
            ]"
          >
            Inicio
          </a>
          <a
            href="/eventos"
            :class="[
              'text-sm font-medium font-[Unbounded] px-4 py-2 hover:bg-secondary rounded-md transition-colors',
              currentPath === '/eventos' ? 'bg-secondary bg-black text-white' : ''
            ]"
          >
            Eventos
          </a>
          <a
            href="/organizadores"
            :class="[
              'text-sm font-medium font-[Unbounded] px-4 py-2 hover:bg-secondary rounded-md transition-colors',
              currentPath === '/organizadores' ? 'bg-secondary bg-black text-white' : ''
            ]"
          >
            Para Organizadores
          </a>
        </div>
      </div>
    </div>
  </nav>
</template>

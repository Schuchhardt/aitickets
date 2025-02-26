<script setup>
import logoLight from "../images/logo.png"; // Importa el logo desde la carpeta `src/images`
</script>

<template>
  <header class="bg-white py-4 shadow-md">
    <div class="container mx-auto flex justify-center">
        <a href="/" class="cursor-pointer">
            <img :src="logoLight.src" alt="AI Tickets" class="h-8" />
        </a>
    </div>
  </header>
</template>

<style scoped>
/* No necesita estilos adicionales, pero puedes ajustar el tamaño si es necesario */
</style>

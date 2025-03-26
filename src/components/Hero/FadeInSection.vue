<template>
  <div
    :class="[
      className,
      'animate__animated',
      animationClass
    ]"
    :style="{
      animationDelay: `${delay}ms`,
    }"
  >
    <slot />
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  delay: { type: Number, default: 1000 },
  direction: {
    type: String,
    default: 'up', // up, down, left, right
  },
  className: { type: String, default: '' }
});

const animationClass = computed(() => {
  switch (props.direction) {
    case 'down':
      return 'animate__fadeInDown';
    case 'left':
      return 'animate__fadeInLeft';
    case 'right':
      return 'animate__fadeInRight';
    default:
      return 'animate__fadeInUp';
  }
});
</script>
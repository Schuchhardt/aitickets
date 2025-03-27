<template>
    <div :class="['gradient-bg', isAlt ? 'gradient-bg-alt' : '']">
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" result="goo" />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>
      <div class="gradients-container">
        <div class="g1"></div>
        <div class="g2"></div>
        <div class="g3"></div>
        <div class="g4"></div>
        <div class="g5"></div>
        <div class="interactive" ref="interactiveBlob"></div>
      </div>
    </div>
  </template>
  
  <script setup>
  import { onMounted, ref } from 'vue';
  
  const props = defineProps({
    variant: {
      type: String,
      default: 'normal', // 'normal' o 'alt'
    }
  });
  
  const isAlt = props.variant === 'alt';
  
  const interactiveBlob = ref(null);
  
  onMounted(() => {
    let curX = 0, curY = 0, tgX = 0, tgY = 0;
  
    function move() {
      curX += (tgX - curX) / 20;
      curY += (tgY - curY) / 20;
      if (interactiveBlob.value) {
        interactiveBlob.value.style.transform = `translate(${Math.round(curX)}px, ${Math.round(curY)}px)`;
      }
      requestAnimationFrame(move);
    }
  
    window.addEventListener('mousemove', (e) => {
        tgX = e.clientX;
        tgY = e.clientY;
    });
  
    move();
  });
  </script>


<style>
:root {
  --color-bg1: rgb(108, 0, 162);
  --color-bg2: rgb(0, 17, 82);
  --color1: 18, 113, 255;
  --color2: 221, 74, 255;
  --color3: 100, 220, 255;
  --color4: 200, 50, 50;
  --color5: 180, 180, 50;
  --color-interactive: 140, 100, 255;
  --circle-size: 40vw;
  --blending: hard-light;
}
</style>

<style scoped>
.gradient-bg {
  width: 100%;
  height: 100vh;
  position: absolute;
  overflow: hidden;
  background: linear-gradient(40deg, var(--color-bg1), var(--color-bg2));
  top: 0;
  left: 0;
  z-index: 0;
}

/* add height on table */
@media (max-width: 1024px) {
  .gradient-bg {
    height: 90vh;
  }
}


/* add 145vh on mobile */
@media (max-width: 640px) {
  .gradient-bg {
    height: 200vh;
  }
}




.gradient-bg-alt {
  --color-bg1: rgb(15, 10, 40);
  --color-bg2: rgb(10, 5, 30);
  --color1: 120, 60, 200;
  --color2: 80, 180, 255;
  --color3: 255, 100, 180;
  --color4: 140, 100, 255;
  --color5: 180, 80, 80;
  --color-interactive: 255, 255, 255;
}


.hero-text-shadow {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.gradient-bg svg {
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
}

.gradients-container {
  filter: url(#goo) blur(40px);
  width: 100%;
  height: 100%;
  position: relative;
}

.gradients-container div {
  position: absolute;
  mix-blend-mode: var(--blending);
  border-radius: 50%;
  will-change: transform;
}

.g1 {
  animation: moveVertical 30s ease infinite;
  top: 10%;
  left: 20%;
  background: radial-gradient(circle at center, rgba(var(--color1), 0.8), rgba(var(--color1), 0));
  width: var(--circle-size);
  height: var(--circle-size);
}

.g2 {
  animation: moveInCircle 20s reverse infinite;
  top: 50%;
  left: 50%;
  background: radial-gradient(circle at center, rgba(var(--color2), 0.8), rgba(var(--color2), 0));
  width: var(--circle-size);
  height: var(--circle-size);
}

.g3 {
  animation: moveInCircle 40s linear infinite;
  top: 70%;
  left: 10%;
  background: radial-gradient(circle at center, rgba(var(--color3), 0.8), rgba(var(--color3), 0));
  width: var(--circle-size);
  height: var(--circle-size);
}

.g4 {
  animation: moveHorizontal 40s ease infinite;
  top: 40%;
  left: 70%;
  background: radial-gradient(circle at center, rgba(var(--color4), 0.8), rgba(var(--color4), 0));
  width: var(--circle-size);
  height: var(--circle-size);
}

.g5 {
  animation: moveInCircle 20s ease infinite;
  top: 20%;
  left: 30%;
  background: radial-gradient(circle at center, rgba(var(--color5), 0.8), rgba(var(--color5), 0));
  width: var(--circle-size);
  height: var(--circle-size);
}

.interactive {
  width: 200%;
  height: 200%;
  top: 0;
  left: 0;
  background: radial-gradient(circle at center, rgba(var(--color-interactive), 0.8), rgba(var(--color-interactive), 0));
  opacity: 0.7;
  position: absolute;
  will-change: transform;
  pointer-events: none;
}

@keyframes moveInCircle {
  0% { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
  100% { transform: rotate(360deg); }
}

@keyframes moveVertical {
  0% { transform: translateY(-50%); }
  50% { transform: translateY(50%); }
  100% { transform: translateY(-50%); }
}

@keyframes moveHorizontal {
  0% { transform: translateX(-50%) translateY(-10%); }
  50% { transform: translateX(50%) translateY(10%); }
  100% { transform: translateX(-50%) translateY(-10%); }
}
</style>


  
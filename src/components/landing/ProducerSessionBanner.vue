<script setup>
// Aviso flotante en la portada y las landings para productores: si ya tiene la sesión iniciada, ofrece entrar
// directo al panel sin pasar por el login. Se puede cerrar (no vuelve a aparecer en esta pestaña).
import { ref, onMounted } from "vue";
import { fetchSession } from "../../lib/sessionHints.js";

const DISMISS_KEY = "ait_session_banner_dismissed";
const producer = ref(null);
const visible = ref(false);

onMounted(async () => {
  try {
    if (sessionStorage.getItem(DISMISS_KEY)) return;
  } catch {
    /* sin storage: se muestra igual */
  }
  const session = await fetchSession();
  producer.value = session?.producer || null;
  visible.value = Boolean(producer.value);
});

function dismiss() {
  visible.value = false;
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* nada */
  }
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="translate-y-4 opacity-0"
    leave-active-class="transition duration-200 ease-in"
    leave-to-class="translate-y-4 opacity-0"
  >
    <div
      v-if="visible"
      class="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-2xl bg-black p-4 text-white shadow-2xl ring-1 ring-white/10 sm:inset-x-auto sm:right-6 sm:bottom-6"
      role="status"
      data-testid="producer-session-banner"
    >
      <div class="flex items-start gap-3">
        <span class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-lime-400" aria-hidden="true"></span>
        <div class="min-w-0 flex-1 font-[Prompt]">
          <p class="font-semibold">
            Hola{{ producer.name ? `, ${producer.name}` : "" }} 👋
          </p>
          <p class="text-sm text-white/70">
            Ya tienes tu sesión iniciada{{ producer.organization ? ` en ${producer.organization}` : "" }}.
          </p>
          <a href="/dashboard" class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-lime-400 px-4 py-2 text-sm font-semibold font-[Unbounded] text-black hover:bg-lime-300 transition">
            Ir a mi panel <span aria-hidden="true">→</span>
          </a>
        </div>
        <button type="button" class="-mr-1 -mt-1 rounded p-1 text-white/50 hover:text-white" aria-label="Cerrar aviso" @click="dismiss">
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  </Transition>
</template>

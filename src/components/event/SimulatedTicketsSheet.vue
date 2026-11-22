<script setup>
// Panel con la entrada simulada de un registro gratis en la vista previa de un borrador (RsvpForm → "Ver mi entrada").
// Mismo formato que el checkout (CheckoutSheet.vue): bottom sheet en mobile, panel lateral de 480 px en desktop.
// Se monta solo después de una acción del usuario, así que el Teleport nunca se hidrata (ver ShareSheet.vue).
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import SimulatedTickets from "./SimulatedTickets.vue";
import { fireConfetti } from "./confetti.js";

const props = defineProps({
  event: { type: Object, required: true },
  result: { type: Object, required: true },
});
const emit = defineEmits(["close", "again"]);

const visible = ref(false);
const panel = ref(null);
const content = ref(null);
let opener = null;
let savedOverflow = "";
let leaveAction = "close";

function close(action = "close") {
  leaveAction = action;
  visible.value = false;
}
const afterLeave = () => emit(leaveAction);

function onKeydown(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    close();
    return;
  }
  if (e.key !== "Tab" || !panel.value) return;
  const items = [...panel.value.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (!panel.value.contains(document.activeElement) || (e.shiftKey && document.activeElement === first)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  opener = document.activeElement;
  savedOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKeydown);
  visible.value = true;
  nextTick(() =>
    setTimeout(() => {
      content.value?.focusTitle();
      fireConfetti({ origin: content.value?.titleEl || undefined });
    }, 120),
  );
});
onBeforeUnmount(() => {
  document.body.style.overflow = savedOverflow;
  document.removeEventListener("keydown", onKeydown);
  if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <div class="sheet-root ev-motion">
      <Transition name="overlay" appear>
        <div v-if="visible" class="overlay" aria-hidden="true" @click="close()"></div>
      </Transition>
      <Transition name="panel" appear @after-leave="afterLeave">
        <div v-if="visible" ref="panel" class="panel" role="dialog" aria-modal="true" aria-labelledby="sim-sheet-title" tabindex="-1" data-testid="sim-tickets-sheet">
          <header class="head">
            <span class="handle" aria-hidden="true"></span>
            <div class="head-row">
              <img v-if="event.image_url" :src="event.image_url" alt="" class="thumb" width="40" height="40" />
              <div class="head-text">
                <p id="sim-sheet-title" class="head-title">{{ event.name }}</p>
                <p class="head-sub">Vista previa · Entrada de muestra</p>
              </div>
              <button type="button" class="close" aria-label="Cerrar" @click="close()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </header>
          <div class="body">
            <SimulatedTickets ref="content" :event="event" :result="result" @close="close()" @again="close('again')" />
          </div>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-root {
  font-family: "Prompt", system-ui, sans-serif;
  color: var(--text-1);
}
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.4);
}
.panel {
  position: fixed;
  z-index: 61;
  left: 0;
  right: 0;
  bottom: 0;
  height: 92dvh;
  max-height: 92vh;
  background: var(--surface-0);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: var(--shadow-sheet);
  display: flex;
  flex-direction: column;
  outline: none;
}
@supports (height: 92dvh) {
  .panel {
    max-height: none;
  }
}
.head {
  flex: 0 0 auto;
  padding: 8px 16px 12px;
  border-bottom: 1px solid var(--border);
}
.handle {
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-2);
  margin: 0 auto 10px;
}
.head-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--r-sm);
  object-fit: cover;
  background: var(--surface-1);
  flex: 0 0 auto;
}
.head-text {
  flex: 1;
  min-width: 0;
}
.head-title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head-sub {
  font-size: 12px;
  line-height: 16px;
  color: var(--text-2);
}
.close {
  width: 44px;
  height: 44px;
  margin-right: -8px;
  border-radius: 50%;
  border: 0;
  background: none;
  color: var(--text-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: 0 0 auto;
}
.close:hover {
  background: var(--surface-1);
}
.close:focus-visible {
  outline: 2px solid var(--text-1);
}
.body {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 20px 16px calc(24px + env(safe-area-inset-bottom));
}
.overlay-enter-active {
  transition: opacity var(--dur-3) var(--ease-out);
}
.overlay-leave-active {
  transition: opacity 240ms var(--ease-in-out);
}
.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}
.panel-enter-active {
  transition: transform var(--dur-3) var(--ease-out);
}
.panel-leave-active {
  transition: transform 240ms var(--ease-in-out);
}
.panel-enter-from,
.panel-leave-to {
  transform: translateY(100%);
}
@media (min-width: 768px) {
  .panel {
    left: auto;
    top: 0;
    width: 480px;
    height: 100%;
    max-height: none;
    border-radius: 0;
    box-shadow: -8px 0 40px rgba(0, 0, 0, 0.12);
  }
  .handle {
    display: none;
  }
  .head {
    padding: 16px 24px;
  }
  .body {
    padding: 24px;
  }
  .panel-enter-from,
  .panel-leave-to {
    transform: translateX(100%);
  }
}
</style>

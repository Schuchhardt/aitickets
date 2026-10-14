<script setup>
// Modal "Compartir" de la página del evento: redes sociales, copiar link y el share nativo del sistema.
// Bottom sheet en mobile, diálogo centrado en desktop. El link es siempre el de la página pública (?ref=share),
// nunca el de una entrada u orden (shareActions.eventShareUrl).
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { Link as LinkIcon, Mail, MessageSquare, Share2, Linkedin, X, Check } from "lucide-vue-next";
import { eventShareUrl } from "./shareActions.js";
import { useGoogleAnalytics } from "../../composables/useGoogleAnalytics.js";
import { showError } from "../../lib/toastBus.js";

const props = defineProps({
  show: Boolean,
  event: { type: Object, required: true },
});
const emit = defineEmits(["close"]);
const { trackShare } = useGoogleAnalytics();

const url = computed(() => (props.show ? eventShareUrl(props.event, "share") : ""));
const text = computed(() => `Mira este evento: ${props.event?.name || ""}`);
const enc = encodeURIComponent;

// Íconos de marca: mismo CDN que usaba el modal anterior (blanco sobre el color de la marca)
const brand = (slug) => `https://cdn.simpleicons.org/${slug}/ffffff`;
const networks = computed(() => [
  { id: "whatsapp", label: "WhatsApp", bg: "#25D366", img: brand("whatsapp"), href: `https://wa.me/?text=${enc(`${text.value} ${url.value}`)}` },
  { id: "facebook", label: "Facebook", bg: "#0866FF", img: brand("facebook"), href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url.value)}` },
  { id: "x", label: "X", bg: "#0A0A0B", img: brand("x"), href: `https://twitter.com/intent/tweet?text=${enc(text.value)}&url=${enc(url.value)}` },
  { id: "telegram", label: "Telegram", bg: "#26A5E4", img: brand("telegram"), href: `https://t.me/share/url?url=${enc(url.value)}&text=${enc(text.value)}` },
  { id: "linkedin", label: "LinkedIn", bg: "#0A66C2", icon: Linkedin, href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url.value)}` },
  { id: "email", label: "Correo", bg: "#5B5B63", icon: Mail, href: `mailto:?subject=${enc(props.event?.name || "Evento")}&body=${enc(`${text.value}\n${url.value}`)}`, self: true },
  { id: "sms", label: "Mensaje", bg: "#5B5B63", icon: MessageSquare, href: `sms:?&body=${enc(`${text.value} ${url.value}`)}`, self: true, mobileOnly: true },
]);

const canNative = ref(false);
const isTouch = ref(false);
const copied = ref(false);
let copiedTimer = null;

async function copyLink() {
  try {
    await navigator.clipboard.writeText(url.value);
    copied.value = true;
    trackShare(props.event?.id, "copy_link");
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 2200);
  } catch {
    showError("No se pudo copiar el link");
  }
}
async function nativeShare() {
  try {
    await navigator.share({ title: props.event?.name || "Evento", text: text.value, url: url.value });
    trackShare(props.event?.id, "native");
    emit("close");
  } catch {
    /* cancelado */
  }
}
const onNetwork = (n) => trackShare(props.event?.id, n.id);

// ---- Diálogo: foco, Escape y scroll del fondo ----
const dialog = ref(null);
let lastFocus = null;
const onKey = (e) => {
  if (e.key === "Escape") emit("close");
};
watch(
  () => props.show,
  async (open) => {
    if (typeof window === "undefined") return;
    if (open) {
      canNative.value = typeof navigator.share === "function";
      isTouch.value = window.matchMedia("(pointer: coarse)").matches;
      lastFocus = document.activeElement;
      document.addEventListener("keydown", onKey);
      document.documentElement.style.overflow = "hidden";
      await nextTick();
      dialog.value?.querySelector("a, button")?.focus({ preventScroll: true });
    } else {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
      copied.value = false;
      lastFocus?.focus?.({ preventScroll: true });
    }
  },
);
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKey);
  document.documentElement.style.overflow = "";
  clearTimeout(copiedTimer);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="share">
      <div v-if="show" class="share-root ev-motion" @click.self="emit('close')">
        <div ref="dialog" class="share-sheet" role="dialog" aria-modal="true" aria-labelledby="share-title">
          <span class="grabber" aria-hidden="true"></span>
          <header class="share-head">
            <h2 id="share-title" class="share-title">Compartir evento</h2>
            <button type="button" class="close" aria-label="Cerrar" @click="emit('close')"><X :size="20" aria-hidden="true" /></button>
          </header>

          <div class="preview">
            <img v-if="event.image_url" :src="event.image_url" alt="" class="preview-img" loading="lazy" decoding="async" />
            <div class="preview-text">
              <p class="preview-name">{{ event.name }}</p>
              <p class="preview-url">{{ url.replace(/^https?:\/\//, "").replace(/\?.*$/, "") }}</p>
            </div>
          </div>

          <ul class="grid" aria-label="Redes">
            <li v-for="(n, i) in networks.filter((n) => !n.mobileOnly || isTouch)" :key="n.id" class="item" :style="{ '--i': i }">
              <a :href="n.href" :target="n.self ? undefined : '_blank'" rel="noopener noreferrer" class="net" @click="onNetwork(n)">
                <span class="net-icon" :style="{ background: n.bg }">
                  <img v-if="n.img" :src="n.img" alt="" width="22" height="22" loading="lazy" />
                  <component :is="n.icon" v-else :size="22" color="#fff" aria-hidden="true" />
                </span>
                <span class="net-label">{{ n.label }}</span>
              </a>
            </li>
            <li v-if="canNative" class="item" :style="{ '--i': networks.length }">
              <button type="button" class="net" @click="nativeShare">
                <span class="net-icon net-icon-plain"><Share2 :size="22" aria-hidden="true" /></span>
                <span class="net-label">Más opciones</span>
              </button>
            </li>
          </ul>

          <div class="copy">
            <span class="copy-url">{{ url }}</span>
            <button type="button" class="ev-btn copy-btn" :class="copied ? 'is-copied' : 'ev-btn-primary'" @click="copyLink">
              <Transition name="swap" mode="out-in">
                <span v-if="copied" key="ok" class="copy-label"><Check :size="18" aria-hidden="true" /> Copiado</span>
                <span v-else key="copy" class="copy-label"><LinkIcon :size="18" aria-hidden="true" /> Copiar link</span>
              </Transition>
            </button>
          </div>
          <p class="sr-only" aria-live="polite">{{ copied ? "Link copiado" : "" }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.share-root {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(10, 10, 11, 0.48);
  backdrop-filter: blur(2px);
  font-family: "Prompt", system-ui, sans-serif;
}
.share-sheet {
  width: 100%;
  max-height: 92vh;
  overflow-y: auto;
  background: var(--surface-0);
  color: var(--text-1);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  padding: 8px 20px calc(20px + env(safe-area-inset-bottom));
  box-shadow: var(--shadow-sheet);
}
.grabber {
  display: block;
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--border-strong);
  margin: 0 auto 8px;
}
.share-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.share-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 18px;
  font-weight: 700;
}
.close {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 0;
  background: var(--surface-1);
  color: var(--text-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform var(--dur-2) var(--ease-out), background-color var(--dur-1);
}
.close:hover {
  background: var(--surface-2);
  transform: rotate(90deg);
}
.close:focus-visible,
.net:focus-visible {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: var(--r-lg);
  background: var(--surface-1);
  margin-bottom: 20px;
}
.preview-img {
  width: 52px;
  height: 52px;
  border-radius: var(--r-sm);
  object-fit: cover;
  flex: 0 0 auto;
}
.preview-text {
  min-width: 0;
}
.preview-name {
  font-weight: 600;
  font-size: 15px;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-url {
  font-size: 13px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px 8px;
  margin-bottom: 20px;
}
/* Los botones entran en cascada */
.item {
  animation: ev-fade-up var(--dur-3) var(--ease-out) both;
  animation-delay: calc(60ms + var(--i, 0) * 35ms);
}
.net {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-decoration: none;
  color: var(--text-1);
  background: none;
  border: 0;
  padding: 4px 0;
  font: inherit;
  cursor: pointer;
  border-radius: var(--r-md);
}
.net-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--dur-2) var(--ease-spring), box-shadow var(--dur-2);
}
.net-icon-plain {
  background: var(--surface-1);
  box-shadow: inset 0 0 0 1px var(--border);
}
.net:hover .net-icon {
  transform: translateY(-3px) scale(1.06);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.14);
}
.net:active .net-icon {
  transform: scale(0.94);
}
.net-label {
  font-size: 12px;
  line-height: 16px;
  color: var(--text-2);
}
.copy {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 14px;
  border-radius: var(--r-md);
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
.copy-url {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copy-btn {
  min-height: 40px;
  padding: 0 14px;
  font-size: 14px;
  flex: 0 0 auto;
}
.copy-btn.is-copied {
  background: var(--brand-lime);
  color: var(--text-1);
}
.copy-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

/* Entrada / salida: sube desde abajo (mobile), escala (desktop) */
.share-enter-active,
.share-leave-active {
  transition: background-color var(--dur-3) var(--ease-out);
}
.share-enter-active .share-sheet,
.share-leave-active .share-sheet {
  transition: transform var(--dur-3) var(--ease-out), opacity var(--dur-2);
}
.share-enter-from,
.share-leave-to {
  background-color: transparent;
}
.share-enter-from .share-sheet,
.share-leave-to .share-sheet {
  transform: translateY(100%);
}
.swap-enter-active,
.swap-leave-active {
  transition: opacity var(--dur-1), transform var(--dur-2) var(--ease-spring);
}
.swap-enter-from {
  opacity: 0;
  transform: scale(0.6);
}
.swap-leave-to {
  opacity: 0;
}

@media (min-width: 640px) {
  .share-root {
    align-items: center;
    padding: 24px;
  }
  .share-sheet {
    max-width: 440px;
    border-radius: var(--r-xl);
    padding: 20px 24px 24px;
  }
  .grabber {
    display: none;
  }
  .share-enter-from .share-sheet,
  .share-leave-to .share-sheet {
    transform: translateY(12px) scale(0.96);
    opacity: 0;
  }
}
</style>

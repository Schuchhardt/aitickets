<script setup>
// Muro de asistentes: quien tiene entrada reacciona al evento con un emoji y, si quiere, un mensaje corto que ven los
// demás asistentes (solo en las páginas de orden/entrada). Una reacción por persona: publicar de nuevo la actualiza.
// API: /api/orders/feed (con el id de la orden). Sin orderId (página de una entrada suelta) es solo lectura.
// #quienes-van: destino del link "Ver quiénes van →" de la card de la página del evento.
import { ref, computed, nextTick } from "vue";

const EMOJIS = ["🔥", "🙌", "🎉", "❤️", "😍", "🤘", "💃", "🥳"];
const MAX = 280;

const props = defineProps({
  orderId: { type: String, required: false },
  initialFeed: { type: Object, required: false },
  // El evento ya terminó: se sigue viendo y se puede reaccionar ("¿cómo estuvo?")
  ended: { type: Boolean, required: false },
});

const feed = ref(props.initialFeed || { posts: [], reactions: [], total: 0, mine: null });
const editing = ref(!feed.value.mine);
const emoji = ref(feed.value.mine?.emoji || "");
const message = ref(feed.value.mine?.message || "");
const busy = ref(false);
const error = ref("");
const messageInput = ref(null);

const canPost = computed(() => Boolean(props.orderId));
const mine = computed(() => feed.value.mine);
const others = computed(() => (feed.value.posts || []).filter((p) => !p.mine));
const remaining = computed(() => MAX - Array.from(message.value || "").length);
const placeholder = computed(() => (props.ended ? "¿Cómo lo pasaste? (opcional)" : "Escribe algo para los demás asistentes (opcional)"));

const rtf = typeof Intl !== "undefined" && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat("es", { numeric: "auto" }) : null;
/** "hace 5 minutos", "ayer"... */
function timeAgo(iso) {
  const ms = new Date(iso).getTime();
  if (!rtf || !Number.isFinite(ms)) return "";
  const minutes = Math.round((ms - Date.now()) / 60000);
  if (Math.abs(minutes) < 1) return "recién";
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, "day");
  return rtf.format(Math.round(days / 30), "month");
}

async function pick(e) {
  emoji.value = e;
  error.value = "";
  await nextTick();
  messageInput.value?.focus({ preventScroll: true });
}

async function send(action) {
  if (busy.value || !canPost.value) return;
  if (action === "react" && !emoji.value) {
    error.value = "Elige un emoji.";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const res = await fetch("/api/orders/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "delete" ? { orderId: props.orderId, action } : { orderId: props.orderId, action, emoji: emoji.value, message: message.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "No pudimos publicar. Inténtalo de nuevo.");
    feed.value = data.feed;
    editing.value = !data.feed.mine;
    if (action === "delete") {
      emoji.value = "";
      message.value = "";
    }
  } catch (err) {
    error.value = err.message || "No pudimos conectar. Inténtalo de nuevo.";
  } finally {
    busy.value = false;
  }
}

function edit() {
  emoji.value = mine.value?.emoji || "";
  message.value = mine.value?.message || "";
  editing.value = true;
}
</script>

<template>
  <section id="quienes-van" class="scroll-mt-6 rounded-2xl bg-white border border-gray-200 p-5 font-[Prompt]" aria-labelledby="feed-title">
    <div class="flex items-baseline justify-between gap-3">
      <h2 id="feed-title" class="font-semibold font-[Unbounded] text-gray-900">{{ ended ? "Así lo vivieron" : "Quiénes van" }}</h2>
      <p v-if="feed.total" class="text-xs text-gray-500">{{ feed.total }} {{ feed.total === 1 ? "reacción" : "reacciones" }}</p>
    </div>
    <p class="mt-0.5 text-xs text-gray-500">Solo lo ven las personas con entrada para este evento.</p>

    <div v-if="feed.reactions?.length" class="mt-3 flex flex-wrap gap-1.5">
      <span v-for="r in feed.reactions" :key="r.emoji" class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-sm">
        <span aria-hidden="true">{{ r.emoji }}</span><span class="tabular-nums text-xs text-gray-600">{{ r.count }}</span>
      </span>
    </div>

    <!-- Mi reacción -->
    <template v-if="canPost">
      <div v-if="mine && !editing" class="mt-4 flex items-start gap-3 rounded-xl bg-lime-50 border border-lime-200 p-3">
        <span class="text-2xl leading-none" aria-hidden="true">{{ mine.emoji }}</span>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-gray-900"><strong>Tú</strong><span v-if="mine.message"> · <span class="break-words">{{ mine.message }}</span></span></p>
          <p v-if="mine.hidden" class="text-xs text-amber-700">La productora ocultó tu publicación del muro.</p>
        </div>
        <div class="flex shrink-0 gap-2 text-xs">
          <button type="button" class="font-semibold text-gray-700 underline hover:text-black" @click="edit">Editar</button>
          <button type="button" class="text-gray-500 underline hover:text-black disabled:opacity-50" :disabled="busy" @click="send('delete')">Borrar</button>
        </div>
      </div>

      <form v-else class="mt-4" @submit.prevent="send('react')">
        <p class="text-sm text-gray-700">{{ ended ? "¿Cómo estuvo?" : "¿Con qué ganas vas?" }}</p>
        <div class="mt-2 grid grid-cols-8 gap-1 sm:gap-1.5 max-w-sm" role="radiogroup" aria-label="Reacción">
          <button
            v-for="e in EMOJIS"
            :key="e"
            type="button"
            role="radio"
            :aria-checked="emoji === e"
            :aria-label="`Reaccionar con ${e}`"
            class="aspect-square w-full rounded-full border text-lg sm:text-xl leading-none transition"
            :class="emoji === e ? 'border-gray-900 bg-lime-100 scale-110' : 'border-gray-200 bg-white hover:border-gray-400'"
            @click="pick(e)"
          >{{ e }}</button>
        </div>
        <div v-if="emoji" class="mt-3 space-y-2">
          <label class="sr-only" for="feed-message">Mensaje (opcional)</label>
          <input
            id="feed-message"
            ref="messageInput"
            v-model="message"
            type="text"
            :maxlength="MAX"
            :placeholder="placeholder"
            class="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-900 focus:ring-2 focus:ring-lime-300"
          />
          <div class="flex items-center justify-between gap-3">
            <span class="text-xs" :class="remaining < 20 ? 'text-amber-700' : 'text-gray-400'">{{ remaining }}</span>
            <div class="flex gap-2">
              <button v-if="mine" type="button" class="rounded-lg px-3 py-2 text-sm text-gray-600 hover:text-black" @click="editing = false">Cancelar</button>
              <button type="submit" class="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50" :disabled="busy">
                {{ busy ? "Publicando…" : mine ? "Guardar" : "Publicar" }}
              </button>
            </div>
          </div>
        </div>
        <p v-if="error" class="mt-2 text-sm text-red-600" role="alert">{{ error }}</p>
      </form>
    </template>

    <!-- Lo que publicaron los demás -->
    <ul v-if="others.length" class="mt-4 space-y-3">
      <li v-for="p in others" :key="p.id" class="flex items-start gap-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg leading-none" aria-hidden="true">{{ p.emoji }}</span>
        <div class="min-w-0">
          <p class="text-sm text-gray-900">
            <strong>{{ p.name }}</strong>
            <span class="text-xs text-gray-400"> · {{ timeAgo(p.created_at) }}</span>
          </p>
          <p v-if="p.message" class="text-sm text-gray-700 break-words">{{ p.message }}</p>
        </div>
      </li>
    </ul>
    <p v-else-if="!mine" class="mt-4 text-sm text-gray-500">{{ canPost ? "Sé la primera persona en reaccionar." : "Todavía nadie ha reaccionado." }}</p>
  </section>
</template>

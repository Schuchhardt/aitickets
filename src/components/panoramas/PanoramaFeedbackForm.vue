<script setup>
// "¿Fuiste?" de un panorama: calificación, comentario y comprobante de asistencia (pantallazo de la entrada, PDF o el
// correo de compra en .eml). POST /api/panoramas/reviews (multipart). Nada se publica hasta que el equipo revisa el
// comprobante. Antiabuso: honeypot, tiempo mínimo de llenado, límite por IP/correo en el servidor y Turnstile (si
// está configurado, se carga recién al empezar a llenar).
import { computed, reactive, ref } from "vue";
import StarRating from "../event/StarRating.vue";
import { useTurnstile } from "../event/useTurnstile.js";
import { prepareImageForUpload, MAX_SOURCE_BYTES } from "../../lib/clientImage.js";

const props = defineProps({
  eventId: { type: Number, required: true },
  eventName: { type: String, required: true },
  /** Funciones que ya empezaron: [{ id, label }] */
  dates: { type: Array, required: true },
  commentMin: { type: Number, default: 15 },
  commentMax: { type: Number, default: 1000 },
  maxMb: { type: Number, default: 5 },
});

const form = reactive({ rating: 0, comment: "", name: "", email: "", dateId: props.dates.length === 1 ? String(props.dates[0].id) : "", hp: "" });
const file = ref(null);
const fileInput = ref(null);
const startedAt = Date.now();
const status = ref("idle"); // idle | sending | sent
const error = ref("");
const okMessage = ref("");
const captchaBox = ref(null);
const turnstile = useTurnstile(captchaBox);

const length = computed(() => form.comment.trim().length);
const fileLabel = computed(() => (file.value ? `${file.value.name} · ${(file.value.size / 1024 / 1024).toFixed(1)} MB` : ""));

const preparing = ref(false);
async function onFile(e) {
  error.value = "";
  turnstile.start();
  let f = e.target.files?.[0] || null;
  const reject = (msg) => {
    error.value = msg;
    e.target.value = "";
    file.value = null;
  };
  if (!f) return (file.value = null);
  // Fotos de celular grandes: se achican en el navegador (JPEG) para entrar bajo el límite
  if (f.type?.startsWith("image/") && f.size > props.maxMb * 1024 * 1024) {
    if (f.size > MAX_SOURCE_BYTES) return reject("La imagen es demasiado grande. Sube un pantallazo.");
    preparing.value = true;
    f = await prepareImageForUpload(f);
    preparing.value = false;
  }
  if (f.size > props.maxMb * 1024 * 1024) return reject(`El archivo no debe superar los ${props.maxMb} MB.`);
  file.value = f;
}

async function submit() {
  error.value = "";
  if (!form.rating) return (error.value = "Elige de 1 a 5 estrellas.");
  if (length.value < props.commentMin) return (error.value = `Cuéntanos un poco más (mínimo ${props.commentMin} caracteres).`);
  if (length.value > props.commentMax) return (error.value = `Máximo ${props.commentMax} caracteres.`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return (error.value = "Escribe un correo válido.");
  if (props.dates.length > 1 && !form.dateId) return (error.value = "Elige a qué función fuiste.");
  if (!file.value) return (error.value = "Sube tu comprobante: pantallazo de la entrada, PDF o el correo de compra.");

  status.value = "sending";
  try {
    const token = await turnstile.getToken();
    const body = new FormData();
    body.set("event_id", String(props.eventId));
    body.set("rating", String(form.rating));
    body.set("comment", form.comment.trim());
    body.set("name", form.name.trim());
    body.set("email", form.email.trim());
    if (form.dateId) body.set("date_id", form.dateId);
    body.set("file", file.value);
    body.set("hp", form.hp);
    body.set("started_at", String(startedAt));
    if (token) body.set("turnstile_token", token);
    const res = await fetch("/api/panoramas/reviews", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      turnstile.reset();
      status.value = "idle";
      error.value = data.message || "No pudimos enviar tu comentario. Inténtalo de nuevo.";
      return;
    }
    okMessage.value = data.message || "¡Gracias! Revisaremos tu comprobante y publicaremos tu comentario.";
    status.value = "sent";
  } catch {
    turnstile.reset();
    status.value = "idle";
    error.value = "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
  }
}
</script>

<template>
  <div v-if="status === 'sent'" class="rounded-2xl border border-lime-300 bg-lime-50 p-6" role="status">
    <p class="text-lg font-semibold font-['Unbounded']">¡Comentario recibido!</p>
    <p class="mt-2 text-gray-700">{{ okMessage }}</p>
  </div>

  <form v-else class="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 space-y-5" novalidate @submit.prevent="submit" @focusin="turnstile.start()">
    <div>
      <p class="font-semibold">¿Cómo estuvo {{ eventName }}?</p>
      <div class="mt-2"><StarRating v-model="form.rating" :readonly="false" :size="30" label="Tu calificación" show-label /></div>
    </div>

    <div>
      <label for="pf-comment" class="block font-semibold">Tu comentario</label>
      <textarea
        id="pf-comment"
        v-model="form.comment"
        rows="4"
        :maxlength="commentMax"
        class="mt-2 w-full rounded-lg border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-lime-400"
        placeholder="¿Qué tal el lugar, el sonido, la puntualidad, el ambiente? ¿Lo recomiendas?"
      ></textarea>
      <p class="text-xs text-gray-500 text-right">{{ length }}/{{ commentMax }}</p>
    </div>

    <div v-if="dates.length > 1">
      <label for="pf-date" class="block font-semibold">¿A qué función fuiste?</label>
      <select id="pf-date" v-model="form.dateId" class="mt-2 w-full rounded-lg border border-gray-300 p-3 bg-white">
        <option value="" disabled>Elige la fecha</option>
        <option v-for="d in dates" :key="d.id" :value="String(d.id)">{{ d.label }}</option>
      </select>
    </div>

    <div class="grid md:grid-cols-2 gap-4">
      <div>
        <label for="pf-name" class="block font-semibold">Nombre o apodo <span class="font-normal text-gray-500">(opcional)</span></label>
        <input id="pf-name" v-model="form.name" type="text" maxlength="60" autocomplete="given-name" class="mt-2 w-full rounded-lg border border-gray-300 p-3" placeholder="Así aparecerás" />
      </div>
      <div>
        <label for="pf-email" class="block font-semibold">Correo</label>
        <input id="pf-email" v-model="form.email" type="email" maxlength="254" autocomplete="email" inputmode="email" class="mt-2 w-full rounded-lg border border-gray-300 p-3" placeholder="tu@correo.cl" />
      </div>
    </div>

    <div>
      <p class="block font-semibold">Comprobante de que fuiste</p>
      <p class="text-sm text-gray-600">Pantallazo de la entrada o del QR, el PDF, o el correo de compra guardado como .eml. Máximo {{ maxMb }} MB.</p>
      <label class="mt-2 flex items-center gap-3 rounded-lg border-2 border-dashed border-gray-300 p-4 cursor-pointer hover:border-black transition">
        <span class="shrink-0 rounded-md bg-black text-white text-sm font-semibold px-3 py-2">Elegir archivo</span>
        <span class="text-sm text-gray-700 truncate">{{ preparing ? "Preparando la imagen…" : fileLabel || "Ningún archivo elegido" }}</span>
        <input ref="fileInput" type="file" class="sr-only" accept="image/*,application/pdf,.pdf,.eml,message/rfc822" @change="onFile" />
      </label>
    </div>

    <!-- Honeypot: invisible para personas -->
    <div class="hidden" aria-hidden="true">
      <label>No llenar <input v-model="form.hp" type="text" tabindex="-1" autocomplete="off" /></label>
    </div>

    <div ref="captchaBox"></div>

    <p class="text-xs text-gray-500">
      Tu correo y el comprobante no se publican: solo los ve el equipo de AI Tickets para validar que asististe. Publicamos tu calificación, tu comentario y
      el nombre que elijas (o "Asistente verificado").
    </p>

    <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>

    <button
      type="submit"
      :disabled="status === 'sending' || preparing"
      class="w-full md:w-auto bg-black text-white font-semibold px-6 py-3 rounded-lg hover:bg-gray-800 disabled:opacity-60 transition"
    >
      {{ status === "sending" ? "Enviando…" : "Enviar comentario" }}
    </button>
  </form>
</template>

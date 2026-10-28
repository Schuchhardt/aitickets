<script setup>
// Reseñas en la página del evento terminado, en cartelera si la productora lo activó (review_settings.show_while_on_sale)
// o con el link del correo "¿Cómo estuvo?": resumen de
// calificaciones, formulario para calificar de 1 a 5 con comentario público y privado, subida de fotos a la
// galería compartida, comentarios de otros asistentes y la galería de fotos de los asistentes.
// Para calificar hay que validar la asistencia (las APIs devuelven un token firmado, netlify/lib/review-token.mjs):
//   - link del correo (#resena=<token>, se guarda en sessionStorage y se borra de la URL),
//   - compra hecha en este navegador (localStorage "purchase_event_<id>"),
//   - "Validar con mi correo" (llega un link) o "Validar con mi entrada" (link o código de la orden/entrada).
// En un sitio de productor con dominio propio las APIs viven en aitickets.cl: ahí se enlaza a la página principal.
import { ref, computed, onMounted } from "vue";
import StarRating from "./StarRating.vue";
import EventGallery from "../EventGallery.vue";
import AutoHeight from "./AutoHeight.vue";
import { storedOrders } from "./checkoutApi.js";
import { readReviewHash, formatRating, reviewsCountLabel, formatReviewDate } from "./eventView.js";
import { prepareImageForUpload } from "../../lib/clientImage.js";
import { PUBLIC_COMMENT_MAX, PRIVATE_COMMENT_MAX, PUBLIC_REVIEWS_PAGE } from "../../../netlify/lib/reviews.mjs";

const props = defineProps({
  event: { type: Object, required: true },
  ended: { type: Boolean, default: true },
  // Origen de aitickets.cl cuando la página se ve en un dominio propio del productor (APIs no disponibles)
  externalOrigin: { type: String, default: "" },
});

const STORAGE_KEY = `aitickets_review_${props.event.id}`;
const readStored = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
};
const writeStored = (value) => {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage no disponible */
  }
};

async function api(path, { method = "POST", body, form } = {}) {
  const res = await fetch(path, {
    method,
    headers: form ? undefined : { "Content-Type": "application/json" },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "Algo falló. Inténtalo de nuevo.");
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- Resumen y comentarios públicos ----
const data = ref(props.event.reviews || null);
const summary = computed(() => data.value?.summary || { count: 0, average: null, distribution: {} });
const list = ref([...(props.event.reviews?.reviews || [])]);
const total = ref(props.event.reviews?.comments_total ?? list.value.length);
const loadingMore = ref(false);
const hasMore = computed(() => !props.externalOrigin && list.value.length < total.value);
const photos = computed(() =>
  (data.value?.photos || []).map((p) => ({ id: p.id, url: p.url, thumb_url: p.thumb_url, caption: p.name ? `Foto de ${p.name}` : null })),
);
const bars = computed(() =>
  [5, 4, 3, 2, 1].map((n) => {
    const count = Number(summary.value.distribution?.[n]) || 0;
    return { n, count, pct: summary.value.count ? Math.round((count / summary.value.count) * 100) : 0 };
  }),
);

async function loadMore() {
  loadingMore.value = true;
  try {
    const more = await api(`/api/reviews?eventId=${props.event.id}&offset=${list.value.length}`, { method: "GET" });
    const seen = new Set(list.value.map((r) => r.id));
    list.value.push(...(more.reviews || []).filter((r) => !seen.has(r.id)));
    total.value = more.comments_total ?? total.value;
  } catch {
    /* se puede reintentar */
  } finally {
    loadingMore.value = false;
  }
}

// ---- Validación de asistencia ----
const token = ref("");
const session = ref(null);
const sessionError = ref("");
const loadingSession = ref(false);
const mode = ref("choose"); // choose | email | ticket
const email = ref("");
const reference = ref("");
const verifyBusy = ref(false);
const verifyError = ref("");
const emailSent = ref("");
const browserOrders = ref([]);

function applySession(payload) {
  session.value = payload;
  if (payload.review) {
    rating.value = rating.value || payload.review.rating;
    publicComment.value = payload.review.public_comment || "";
    privateComment.value = payload.review.private_comment || "";
  }
}

async function openSession(t) {
  loadingSession.value = true;
  sessionError.value = "";
  try {
    applySession(await api("/api/reviews/session", { body: { token: t } }));
    token.value = t;
    writeStored(t);
  } catch (e) {
    sessionError.value = e.message;
    if (e.status === 401 || e.status === 403) writeStored("");
  } finally {
    loadingSession.value = false;
  }
}

async function verify(ref_) {
  verifyBusy.value = true;
  verifyError.value = "";
  try {
    const payload = await api("/api/reviews/verify", { body: { eventId: props.event.id, reference: ref_ } });
    token.value = payload.token;
    writeStored(payload.token);
    applySession(payload);
  } catch (e) {
    verifyError.value = e.message;
  } finally {
    verifyBusy.value = false;
  }
}

async function requestLink() {
  verifyBusy.value = true;
  verifyError.value = "";
  try {
    const res = await api("/api/reviews/request-link", { body: { eventId: props.event.id, email: email.value } });
    emailSent.value = res.message || "Revisa tu correo.";
  } catch (e) {
    verifyError.value = e.message;
  } finally {
    verifyBusy.value = false;
  }
}

function signOut() {
  writeStored("");
  token.value = "";
  session.value = null;
  mode.value = "choose";
  rating.value = 0;
  publicComment.value = "";
  privateComment.value = "";
  saved.value = null;
}

// ---- Formulario ----
const rating = ref(0);
const publicComment = ref("");
const privateComment = ref("");
const saving = ref(false);
const saveError = ref("");
const saved = ref(null); // { created, reward }
const editing = ref(false);
const showForm = computed(() => session.value && (!session.value.review || editing.value) && !saved.value);

async function submit() {
  if (!rating.value) {
    saveError.value = "Elige de 1 a 5 estrellas.";
    return;
  }
  saving.value = true;
  saveError.value = "";
  try {
    const res = await api("/api/reviews", {
      body: { token: token.value, rating: rating.value, public_comment: publicComment.value, private_comment: privateComment.value },
    });
    applySession(res);
    saved.value = { created: res.created, reward: res.reward };
    editing.value = false;
  } catch (e) {
    saveError.value = e.message;
  } finally {
    saving.value = false;
  }
}

const copied = ref(false);
async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    window.prompt("Copia tu código:", code);
  }
}
const formatUntil = (iso) => (iso ? new Date(iso).toLocaleDateString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "long", year: "numeric" }) : "");

// ---- Fotos ----
const fileInput = ref(null);
const uploading = ref("");
const photoMessage = ref("");
const photoError = ref("");
const myPhotos = computed(() => session.value?.photos || []);
const slotsLeft = computed(() => Math.max(0, (session.value?.max_photos || 6) - myPhotos.value.length));

async function onFiles(e) {
  const files = Array.from(e.target.files || []).slice(0, slotsLeft.value);
  e.target.value = "";
  if (!files.length) return;
  photoError.value = "";
  photoMessage.value = "";
  for (let i = 0; i < files.length; i++) {
    uploading.value = files.length > 1 ? `Subiendo ${i + 1} de ${files.length}…` : "Subiendo…";
    try {
      const prepared = await prepareImageForUpload(files[i]);
      const form = new FormData();
      form.append("token", token.value);
      form.append("file", prepared);
      const res = await api("/api/reviews/photos", { form });
      session.value = { ...session.value, photos: res.photos };
      photoMessage.value = res.message || "";
    } catch (err) {
      photoError.value = err.message;
      break;
    }
  }
  uploading.value = "";
}

async function removePhoto(photo) {
  if (!window.confirm("¿Borrar esta foto?")) return;
  try {
    const res = await api("/api/reviews/photos", { body: { token: token.value, action: "delete", id: photo.id } });
    session.value = { ...session.value, photos: res.photos };
  } catch (err) {
    photoError.value = err.message;
  }
}

// ---- Inicio ----
const root = ref(null);
onMounted(() => {
  browserOrders.value = storedOrders(props.event.id).filter((o) => o?.orderId);
  if (props.externalOrigin) return;
  const fromHash = readReviewHash(window.location.hash);
  if (fromHash) {
    if (fromHash.rating) rating.value = fromHash.rating;
    // El token no se queda en la URL (ni en el historial ni en lo que se comparta)
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + "#resenas");
    openSession(fromHash.token).then(() => root.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  const stored = readStored();
  if (stored) openSession(stored);
});

const reviewUrl = computed(() => `${props.externalOrigin}/eventos/${encodeURIComponent(props.event.slug || "")}#resenas`);
const organizer = computed(() => props.event.organization?.name || "la productora");
</script>

<template>
  <section id="resenas" ref="root" class="reviews" aria-labelledby="resenas-title" data-testid="event-reviews">
    <h2 id="resenas-title" class="section-title">{{ summary.count ? "Reseñas" : "¿Cómo estuvo?" }}</h2>

    <div v-if="summary.count" class="summary" data-testid="reviews-summary">
      <div class="avg">
        <p class="avg-num ev-tabular">{{ formatRating(summary.average) }}</p>
        <StarRating :model-value="summary.average || 0" :size="18" label="Promedio" />
        <p class="avg-count">{{ reviewsCountLabel(summary.count) }}</p>
      </div>
      <ul class="bars" aria-label="Distribución de calificaciones">
        <li v-for="b in bars" :key="b.n" class="bar-row">
          <span class="bar-n">{{ b.n }}★</span>
          <span class="bar"><span class="bar-fill" :style="{ width: `${b.pct}%` }"></span></span>
          <span class="bar-c ev-tabular">{{ b.count }}</span>
        </li>
      </ul>
    </div>

    <!-- Calificar -->
    <div class="card" data-testid="review-card">
      <template v-if="externalOrigin">
        <p class="card-title">¿Fuiste? Califica el evento</p>
        <p class="muted">Cuéntanos cómo lo pasaste y sube tus fotos a la galería.</p>
        <a class="ev-btn ev-btn-primary" :href="reviewUrl">Calificar el evento</a>
      </template>

      <p v-else-if="loadingSession" class="muted"><span class="ev-spinner ev-spinner-dark" aria-hidden="true"></span> Cargando…</p>

      <!-- Sin validar -->
      <template v-else-if="!session">
        <p class="card-title">¿Fuiste? Califica el evento</p>
        <p class="muted">Califícalo de 1 a 5, deja un comentario público o uno privado para {{ organizer }} y sube tus fotos a la galería.</p>
        <p v-if="sessionError" class="ev-error" role="alert">{{ sessionError }}</p>

        <AutoHeight>
          <div v-if="mode === 'choose'" class="choices">
            <button v-for="o in browserOrders.slice(0, 1)" :key="o.orderId" type="button" class="ev-btn ev-btn-primary" :aria-busy="verifyBusy" :disabled="verifyBusy" data-testid="review-with-order" @click="verify(o.orderId)">
              Calificar con mi compra{{ o.email ? ` (${o.email})` : "" }}
            </button>
            <button type="button" class="ev-btn" :class="browserOrders.length ? 'ev-btn-secondary' : 'ev-btn-primary'" data-testid="review-with-email" @click="mode = 'email'">Validar con mi correo</button>
            <button type="button" class="ev-btn ev-btn-secondary" data-testid="review-with-ticket" @click="mode = 'ticket'">Validar con mi entrada</button>
            <p v-if="verifyError" class="ev-error" role="alert">{{ verifyError }}</p>
          </div>

          <form v-else-if="mode === 'email'" class="stack" @submit.prevent="requestLink">
            <template v-if="!emailSent">
              <label class="ev-label" for="review-email">El correo con el que compraste o te registraste</label>
              <input id="review-email" v-model.trim="email" class="ev-field" type="email" autocomplete="email" inputmode="email" required placeholder="tu@correo.cl" />
              <button type="submit" class="ev-btn ev-btn-primary" :aria-busy="verifyBusy" :disabled="verifyBusy || !email">Enviarme el link para calificar</button>
            </template>
            <p v-else class="ok" role="status">{{ emailSent }}</p>
            <p v-if="verifyError" class="ev-error" role="alert">{{ verifyError }}</p>
            <button type="button" class="ev-link back" @click="mode = 'choose'; emailSent = ''; verifyError = ''">← Otras formas de validar</button>
          </form>

          <form v-else class="stack" @submit.prevent="verify(reference)">
            <label class="ev-label" for="review-ref">Link de tu entrada u orden</label>
            <input id="review-ref" v-model.trim="reference" class="ev-field" type="text" autocomplete="off" required placeholder="https://aitickets.cl/order/…" />
            <p class="hint">Está en el botón "Ver mis entradas" del correo con tus entradas. También sirve el código de tu QR.</p>
            <button type="submit" class="ev-btn ev-btn-primary" :aria-busy="verifyBusy" :disabled="verifyBusy || !reference">Validar entrada</button>
            <p v-if="verifyError" class="ev-error" role="alert">{{ verifyError }}</p>
            <button type="button" class="ev-link back" @click="mode = 'choose'; verifyError = ''">← Otras formas de validar</button>
          </form>
        </AutoHeight>
      </template>

      <!-- Validado -->
      <template v-else>
        <p class="who">
          <span>Calificando como <strong>{{ session.name || "asistente" }}</strong> · {{ session.email }}</span>
          <button type="button" class="ev-link small" @click="signOut">No soy yo</button>
        </p>

        <form v-if="showForm" class="stack" data-testid="review-form" @submit.prevent="submit">
          <div>
            <p class="ev-label">¿Cómo estuvo?</p>
            <StarRating v-model="rating" :readonly="false" :size="34" label="Tu calificación" show-label />
          </div>
          <div v-if="session.reward_offer && !session.review" class="reward-offer">
            🎁 Al calificar recibes un código de <strong>{{ session.reward_offer.label }}</strong> para el próximo evento de {{ organizer }}.
          </div>
          <div>
            <label class="ev-label" for="review-public">Comentario público <span class="opt">(opcional)</span></label>
            <textarea id="review-public" v-model="publicComment" class="ev-field area" rows="3" :maxlength="PUBLIC_COMMENT_MAX" placeholder="¿Qué fue lo mejor? Se verá en esta página con tu nombre y la inicial de tu apellido."></textarea>
          </div>
          <div>
            <label class="ev-label" for="review-private">Mensaje privado para {{ organizer }} <span class="opt">(opcional)</span></label>
            <textarea id="review-private" v-model="privateComment" class="ev-field area" rows="3" :maxlength="PRIVATE_COMMENT_MAX" placeholder="Sugerencias, algo que mejorar… Solo lo verá la productora."></textarea>
          </div>
          <p v-if="saveError" class="ev-error" role="alert">{{ saveError }}</p>
          <button type="submit" class="ev-btn ev-btn-primary" :aria-busy="saving" :disabled="saving" data-testid="review-submit">
            <span v-if="saving" class="ev-spinner" aria-hidden="true"></span>
            {{ session.review ? "Guardar cambios" : "Enviar calificación" }}
          </button>
        </form>

        <div v-else class="stack" data-testid="review-done">
          <p class="card-title">{{ saved?.created ? "¡Gracias por calificar!" : "Tu calificación" }}</p>
          <div class="mine">
            <StarRating :model-value="session.review?.rating || 0" :size="20" label="Tu calificación" />
            <p v-if="session.review?.public_comment" class="mine-text">“{{ session.review.public_comment }}”</p>
            <p v-if="session.review?.private_comment" class="mine-private">Privado para {{ organizer }}: {{ session.review.private_comment }}</p>
            <button type="button" class="ev-link small" @click="editing = true; saved = null">Editar</button>
          </div>
          <div v-if="session.reward" class="reward" data-testid="review-reward">
            <p class="reward-title">🎁 Tu código de {{ session.reward.label }}</p>
            <div class="reward-row">
              <code class="reward-code">{{ session.reward.code }}</code>
              <button type="button" class="ev-btn ev-btn-secondary small-btn" @click="copyCode(session.reward.code)">{{ copied ? "¡Copiado!" : "Copiar" }}</button>
            </div>
            <p class="hint">Un uso, en cualquier evento de {{ organizer }}<template v-if="session.reward.valid_until">, hasta el {{ formatUntil(session.reward.valid_until) }}</template>. También te lo enviamos por correo.</p>
          </div>
        </div>

        <!-- Fotos -->
        <div class="photos">
          <p class="ev-label">Tus fotos del evento <span class="opt">({{ myPhotos.length }}/{{ session.max_photos }})</span></p>
          <p class="hint">Se suman a la galería compartida de esta página{{ session.moderate_photos ? " cuando la productora las revise" : "" }}.</p>
          <ul v-if="myPhotos.length" class="thumbs">
            <li v-for="p in myPhotos" :key="p.id" class="thumb">
              <img :src="p.thumb_url || p.url" alt="Tu foto" loading="lazy" />
              <span v-if="p.status === 'pending'" class="tag">En revisión</span>
              <span v-else-if="p.status === 'hidden'" class="tag">Oculta</span>
              <button type="button" class="thumb-del" aria-label="Borrar foto" @click="removePhoto(p)">×</button>
            </li>
          </ul>
          <input ref="fileInput" type="file" accept="image/*" multiple class="sr-only" data-testid="review-photo-input" @change="onFiles" />
          <button v-if="slotsLeft" type="button" class="ev-btn ev-btn-secondary" :disabled="Boolean(uploading)" @click="fileInput?.click()">
            <span v-if="uploading" class="ev-spinner ev-spinner-dark" aria-hidden="true"></span>
            {{ uploading || "📷 Subir fotos" }}
          </button>
          <p v-if="photoMessage" class="ok" role="status">{{ photoMessage }}</p>
          <p v-if="photoError" class="ev-error" role="alert">{{ photoError }}</p>
        </div>
      </template>
    </div>

    <!-- Comentarios públicos -->
    <ul v-if="list.length" class="list" data-testid="reviews-list">
      <li v-for="r in list" :key="r.id" class="item">
        <div class="item-head">
          <span class="avatar" aria-hidden="true">{{ (r.name || "A").charAt(0) }}</span>
          <div>
            <p class="item-name">{{ r.name }}</p>
            <p class="item-meta"><StarRating :model-value="r.rating" :size="14" /> · {{ formatReviewDate(r.created_at) }}</p>
          </div>
        </div>
        <p class="item-text">{{ r.comment }}</p>
      </li>
    </ul>
    <button v-if="hasMore" type="button" class="ev-btn ev-btn-secondary more" :aria-busy="loadingMore" :disabled="loadingMore" @click="loadMore">Ver más reseñas</button>

    <EventGallery
      v-if="photos.length"
      :images="photos"
      :event-name="event.name"
      title="Fotos de los asistentes"
      section-id="fotos-asistentes"
      test-id="attendee-gallery"
      embedded
      class="attendee-gallery"
    />
  </section>
</template>

<style scoped>
.reviews {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 40px;
  scroll-margin-top: 96px;
  font-family: "Prompt", system-ui, sans-serif;
  color: var(--text-1);
}
.section-title {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  align-items: center;
}
.avg {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.avg-num {
  font-family: "Unbounded", system-ui, sans-serif;
  font-size: 40px;
  line-height: 44px;
  font-weight: 700;
}
.avg-count {
  font-size: 13px;
  color: var(--text-2);
}
.bars {
  flex: 1 1 220px;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bar-row {
  display: grid;
  grid-template-columns: 28px 1fr 32px;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-2);
}
.bar {
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  background: #f5b301;
  border-radius: inherit;
  transition: width var(--dur-4) var(--ease-out);
}
.bar-c {
  text-align: right;
}
.card {
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-card);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 560px;
}
.card-title {
  font-size: 16px;
  font-weight: 600;
}
.muted,
.hint {
  font-size: 14px;
  line-height: 20px;
  color: var(--text-2);
}
.hint {
  font-size: 13px;
}
.muted {
  display: flex;
  align-items: center;
  gap: 8px;
}
.choices,
.stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stack {
  gap: 14px;
}
.back {
  align-self: flex-start;
  font-size: 14px;
  padding: 4px 0;
  background: none;
  border: 0;
  cursor: pointer;
}
.ok {
  font-size: 14px;
  line-height: 20px;
  color: #166534;
  background: #f0fdf4;
  border-radius: var(--r-md);
  padding: 10px 12px;
}
.who {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  font-size: 13px;
  color: var(--text-2);
}
.small {
  font-size: 13px;
  background: none;
  border: 0;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.opt {
  font-weight: 400;
  color: var(--text-2);
}
.area {
  height: auto;
  min-height: 88px;
  padding: 10px 14px;
  line-height: 22px;
  resize: vertical;
}
.reward-offer {
  font-size: 14px;
  line-height: 20px;
  background: color-mix(in srgb, var(--brand-lime) 22%, #fff);
  border-radius: var(--r-md);
  padding: 10px 12px;
}
.mine {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.mine-text {
  font-size: 15px;
  line-height: 22px;
  white-space: pre-line;
}
.mine-private {
  font-size: 13px;
  color: var(--text-2);
  white-space: pre-line;
}
.reward {
  border: 1px dashed var(--text-1);
  border-radius: var(--r-md);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: color-mix(in srgb, var(--brand-lime) 14%, #fff);
}
.reward-title {
  font-weight: 600;
  font-size: 15px;
}
.reward-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.reward-code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1px;
}
.small-btn {
  min-height: 36px;
  font-size: 14px;
  padding: 0 14px;
}
.photos {
  border-top: 1px solid var(--border);
  padding-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 8px;
}
.thumb {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--surface-1);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tag {
  position: absolute;
  left: 4px;
  bottom: 4px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  border-radius: 6px;
  padding: 1px 6px;
}
.thumb-del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 0;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 16px;
  line-height: 24px;
  cursor: pointer;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.item {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 16px;
  background: var(--surface-0);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.item-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--brand-lime);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 15px;
  flex: 0 0 auto;
}
.item-name {
  font-size: 14px;
  font-weight: 600;
}
.item-meta {
  font-size: 12px;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 4px;
}
.item-text {
  font-size: 15px;
  line-height: 22px;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.more {
  align-self: flex-start;
}
.attendee-gallery {
  margin-top: 16px;
}
</style>

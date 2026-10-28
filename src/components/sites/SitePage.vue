<script setup>
// Inicio de un sitio de productor armado con secciones (content.sections, src/lib/siteTemplates.ts) y el estilo de su
// plantilla ([data-niche], src/styles/site-niches.css). Se renderiza en el servidor; con live (vista previa del editor,
// /o/<slug>?editor=1, solo el dueño) se hidrata y redibuja con el borrador que le manda el editor por postMessage.
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";
import BannerStrip from "./BannerStrip.vue";
import SiteFooter from "./SiteFooter.vue";
import { formatEventDateRange } from "../../utils/dateHelpers.js";
import {
  GOOGLE_FONT_QUERIES,
  SITE_TEMPLATES,
  TEMPLATE_INFO,
  fontStack,
  plainTextToHtml,
  readableOn,
  resolveThemeFor,
  sanitizeSections,
  videoEmbedUrl,
} from "../../lib/siteTemplates";
import "../../styles/site-niches.css";

const props = defineProps({
  site: { type: Object, required: true }, // PublicSiteProps (src/lib/sites.ts)
  sections: { type: Array, required: true }, // SiteSection[] saneadas
  events: { type: Array, required: false }, // SiteEventCard[]
  banners: { type: Array, required: false },
  aboutHtml: { type: String, default: "" },
  base: { type: String, default: "" },
  /** Nombre de la organización (para el borrador sin "Nombre a mostrar"). */
  fallbackName: { type: String, default: "" },
  live: { type: Boolean, default: false },
});

const state = reactive({
  template: props.site.template,
  theme: props.site.theme,
  name: props.site.name,
  tagline: props.site.content?.tagline || "",
  aboutHtml: props.aboutHtml,
  sections: props.sections,
});

const info = computed(() => TEMPLATE_INFO[state.template] || TEMPLATE_INFO.clasico);
const visible = computed(() => state.sections.filter((s) => !s.hidden && (s.type !== "contact" || props.site.contact_form_enabled)));
const cssVars = computed(() => ({
  "--site-primary": state.theme.primary,
  "--site-accent": state.theme.accent,
  "--site-bg": state.theme.background,
  "--site-text": state.theme.text,
  "--site-on-primary": readableOn(state.theme.primary),
  "--site-on-accent": readableOn(state.theme.accent),
  "--site-font": fontStack(state.theme.font),
}));

const events = computed(() => props.events || []);
const banners = computed(() => props.banners || []);
const heroBanner = computed(() => banners.value.find((b) => b.placement === "hero") || null);
function heroImage(section) {
  return section.data.image_url || state.theme.hero_image_url || heroBanner.value?.image_url || events.value[0]?.image_url || null;
}
const faqSection = computed(() => visible.value.find((s) => s.type === "faq"));
const hasHeroFirst = computed(() => visible.value[0]?.type === "hero" && info.value.hero !== "split");

const eventHref = (event) => `${props.base}/eventos/${event.slug}`;
const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
function dayParts(event) {
  const date = event.dates?.[0]?.date || (event.start_date ? String(event.start_date).slice(0, 10) : "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? { day: String(Number(m[3])), month: MONTHS[Number(m[2]) - 1] } : { day: "", month: "" };
}
function ctaHref(url) {
  if (!url) return "#eventos";
  if (url === "contacto") return `${props.base}/contacto`;
  return url;
}
const isExternal = (url) => /^https?:\/\//.test(url || "");
const altSection = (type) => type === "highlights" || type === "testimonials";
const eventsLayout = (section) => section.data.layout || info.value.events;

// --- Vista previa en vivo (editor) ---
const loadedFonts = new Set();
function ensureFont(font) {
  const query = GOOGLE_FONT_QUERIES[font];
  if (!query || loadedFonts.has(font) || typeof document === "undefined") return;
  loadedFonts.add(font);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
  document.head.appendChild(link);
}

function onMessage(event) {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  if (event.data?.type !== "aitickets:site-draft") return;
  const draft = event.data.draft || {};
  if (SITE_TEMPLATES.includes(draft.template)) state.template = draft.template;
  state.theme = resolveThemeFor(state.template, draft.theme || {});
  state.name = String(draft.title || "").trim() || props.fallbackName || props.site.name;
  state.tagline = String(draft.tagline || "");
  state.aboutHtml = plainTextToHtml(draft.about || "");
  state.sections = sanitizeSections(draft.sections);
  ensureFont(state.theme.font);
}

onMounted(() => {
  if (!props.live) return;
  window.addEventListener("message", onMessage);
  window.parent?.postMessage({ type: "aitickets:site-preview-ready" }, window.location.origin);
});
onBeforeUnmount(() => window.removeEventListener("message", onMessage));
</script>

<template>
  <div class="sn-page" :data-niche="state.template" :style="cssVars">
    <BannerStrip :banners="banners" placement="top_bar" />

    <header class="sn-header" :class="{ 'sn-header--over': hasHeroFirst && !!heroImage(visible[0]) }">
      <div class="sn-wrap sn-header-inner">
        <a :href="base || '/'" class="sn-logo">
          <img v-if="state.theme.logo_url" :src="state.theme.logo_url" :alt="state.name" height="40" />
          <span v-else>{{ state.name }}</span>
        </a>
        <nav class="sn-nav" aria-label="Secciones">
          <a :href="`${base || '/'}#eventos`" class="sn-nav-extra">Eventos</a>
          <a v-if="faqSection" :href="`#${faqSection.id}`" class="sn-nav-extra">Preguntas</a>
          <a v-if="site.contact_form_enabled" :href="`${base}/contacto`" class="sn-nav-extra">Contacto</a>
          <a :href="`${base || '/'}#eventos`" class="sn-btn sn-btn--sm">Entradas</a>
        </nav>
      </div>
    </header>

    <main>
      <template v-for="section in visible" :key="section.id">
        <!-- Portada -->
        <section
          v-if="section.type === 'hero'"
          :id="section.id"
          class="sn-hero"
          :class="[`sn-hero--${info.hero}`, { 'no-media': !heroImage(section) }]"
          data-section="hero"
        >
          <template v-if="info.hero === 'split'">
            <div class="sn-wrap sn-hero-grid" :class="{ 'has-media': !!heroImage(section) }">
              <div>
                <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
                <h1 class="sn-h1"><span>{{ section.data.title || state.name }}</span></h1>
                <p v-if="section.data.subtitle || state.tagline" class="sn-lead sn-hero-sub">{{ section.data.subtitle || state.tagline }}</p>
                <div class="sn-hero-actions">
                  <a href="#eventos" class="sn-btn">{{ section.data.button_label || "Ver eventos" }}</a>
                  <a v-if="heroBanner?.link_url" :href="heroBanner.link_url" rel="noopener" class="sn-btn sn-btn--ghost">Destacado</a>
                </div>
              </div>
              <img v-if="heroImage(section)" :src="heroImage(section)" :alt="heroBanner?.alt || state.name" class="sn-hero-img" fetchpriority="high" />
            </div>
          </template>
          <template v-else>
            <img v-if="heroImage(section)" :src="heroImage(section)" :alt="heroBanner?.alt || state.name" class="sn-hero-bg" fetchpriority="high" />
            <div class="sn-hero-shade"></div>
            <div class="sn-wrap sn-hero-body">
              <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
              <h1 class="sn-h1"><span>{{ section.data.title || state.name }}</span></h1>
              <p v-if="section.data.subtitle || state.tagline" class="sn-lead sn-hero-sub">{{ section.data.subtitle || state.tagline }}</p>
              <div class="sn-hero-actions">
                <a href="#eventos" class="sn-btn">{{ section.data.button_label || "Ver eventos" }}</a>
                <a v-if="heroBanner?.link_url" :href="heroBanner.link_url" rel="noopener" class="sn-btn sn-btn--ghost">Destacado</a>
              </div>
            </div>
          </template>
        </section>

        <!-- Próximos eventos -->
        <template v-else-if="section.type === 'events'">
          <section id="eventos" class="sn-section" data-section="events">
            <div class="sn-wrap">
              <div class="sn-head">
                <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
                <h2 class="sn-h2"><span>{{ section.data.title || info.copy.eventsTitle }}</span></h2>
                <p v-if="section.data.text" class="sn-lead" style="margin-top: 1rem">{{ section.data.text }}</p>
              </div>
              <div data-testid="site-event-grid">
                <p v-if="!events.length" class="sn-empty">{{ info.copy.emptyEvents }}</p>

                <div v-else-if="eventsLayout(section) === 'list'" class="sn-events-list">
                  <a v-for="event in events" :key="event.id" :href="eventHref(event)" class="sn-erow">
                    <span class="sn-erow-date" aria-hidden="true">
                      <span class="sn-erow-day">{{ dayParts(event).day }}</span>
                      <span class="sn-erow-month">{{ dayParts(event).month }}</span>
                    </span>
                    <span class="min-w-0">
                      <span class="sn-erow-name block">{{ event.name }}</span>
                      <span class="sn-muted block text-sm mt-1">
                        {{ formatEventDateRange(event) }}<template v-if="event.location"> · {{ event.location }}</template>
                      </span>
                    </span>
                    <span class="sn-btn sn-btn--sm sn-erow-cta">{{ info.buyLabel }}</span>
                  </a>
                </div>

                <div v-else-if="eventsLayout(section) === 'posters'" class="sn-events-posters">
                  <a v-for="(event, i) in events" :key="event.id" :href="eventHref(event)" class="sn-poster">
                    <div class="relative">
                      <img v-if="event.image_url" :src="event.image_url" :alt="event.name" class="sn-poster-img" :loading="i < 3 ? 'eager' : 'lazy'" decoding="async" />
                      <div v-else class="sn-poster-img"></div>
                      <span class="sn-poster-date">{{ dayParts(event).day }} {{ dayParts(event).month }}</span>
                    </div>
                    <div class="sn-poster-body">
                      <h3 class="sn-ecard-name">{{ event.name }}</h3>
                      <p class="sn-ecard-date mt-1">{{ formatEventDateRange(event) }}</p>
                      <p v-if="event.location" class="sn-ecard-place mt-1">{{ event.location }}</p>
                    </div>
                  </a>
                </div>

                <div v-else class="sn-events-cards">
                  <a v-for="(event, i) in events" :key="event.id" :href="eventHref(event)" class="sn-ecard">
                    <img v-if="event.image_url" :src="event.image_url" :alt="event.name" class="sn-ecard-img" :loading="i < 3 ? 'eager' : 'lazy'" decoding="async" />
                    <div v-else class="sn-ecard-img"></div>
                    <div class="sn-ecard-body">
                      <span class="sn-ecard-date">{{ formatEventDateRange(event) }}</span>
                      <h3 class="sn-ecard-name">{{ event.name }}</h3>
                      <p v-if="event.location" class="sn-ecard-place">{{ event.location }}</p>
                      <div class="sn-ecard-cta"><span class="sn-btn sn-btn--sm">{{ info.buyLabel }}</span></div>
                    </div>
                  </a>
                </div>
              </div>
            </div>
          </section>
          <BannerStrip :banners="banners" placement="inline" />
        </template>

        <!-- Sobre nosotros -->
        <section v-else-if="section.type === 'about' && state.aboutHtml" :id="section.id" class="sn-section" data-section="about">
          <div class="sn-wrap sn-about">
            <div>
              <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
              <h2 class="sn-h2"><span>{{ section.data.title || "Sobre nosotros" }}</span></h2>
            </div>
            <div class="sn-prose" v-html="state.aboutHtml"></div>
          </div>
        </section>

        <!-- Destacados -->
        <section v-else-if="section.type === 'highlights' && section.data.items?.length" :id="section.id" class="sn-section" :class="{ 'sn-section--alt': altSection(section.type) }" data-section="highlights">
          <div class="sn-wrap">
            <div class="sn-head">
              <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
              <h2 v-if="section.data.title" class="sn-h2"><span>{{ section.data.title }}</span></h2>
            </div>
            <div class="sn-grid3">
              <div v-for="(item, i) in section.data.items" :key="i" class="sn-hl">
                <span class="sn-hl-num">{{ String(i + 1).padStart(2, "0") }}</span>
                <h3 v-if="item.title" class="sn-h3">{{ item.title }}</h3>
                <p v-if="item.text">{{ item.text }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- Galería -->
        <section v-else-if="section.type === 'gallery' && section.data.items?.length" :id="section.id" class="sn-section" data-section="gallery">
          <div class="sn-wrap">
            <div v-if="section.data.title || section.data.eyebrow" class="sn-head">
              <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
              <h2 v-if="section.data.title" class="sn-h2"><span>{{ section.data.title }}</span></h2>
            </div>
            <div class="sn-gallery">
              <figure v-for="(item, i) in section.data.items" :key="i">
                <img :src="item.image_url" :alt="item.caption || ''" loading="lazy" decoding="async" />
                <figcaption v-if="item.caption">{{ item.caption }}</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <!-- Video -->
        <section v-else-if="section.type === 'video' && videoEmbedUrl(section.data.url)" :id="section.id" class="sn-section" data-section="video">
          <div class="sn-wrap">
            <div v-if="section.data.title || section.data.eyebrow || section.data.text" class="sn-head">
              <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
              <h2 v-if="section.data.title" class="sn-h2"><span>{{ section.data.title }}</span></h2>
              <p v-if="section.data.text" class="sn-lead" style="margin-top: 1rem">{{ section.data.text }}</p>
            </div>
            <div class="sn-video">
              <iframe
                :src="videoEmbedUrl(section.data.url)"
                :title="section.data.title || 'Video'"
                loading="lazy"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowfullscreen
                referrerpolicy="strict-origin-when-cross-origin"
              ></iframe>
            </div>
          </div>
        </section>

        <!-- Preguntas frecuentes -->
        <section v-else-if="section.type === 'faq' && section.data.items?.length" :id="section.id" class="sn-section" data-section="faq">
          <div class="sn-wrap">
            <div class="sn-head">
              <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
              <h2 class="sn-h2"><span>{{ section.data.title || "Preguntas frecuentes" }}</span></h2>
            </div>
            <div class="sn-faq">
              <details v-for="(item, i) in section.data.items" :key="i">
                <summary>{{ item.question }}</summary>
                <p>{{ item.answer }}</p>
              </details>
            </div>
          </div>
        </section>

        <!-- Opiniones -->
        <section v-else-if="section.type === 'testimonials' && section.data.items?.length" :id="section.id" class="sn-section" :class="{ 'sn-section--alt': altSection(section.type) }" data-section="testimonials">
          <div class="sn-wrap">
            <div class="sn-head">
              <span v-if="section.data.eyebrow" class="sn-eyebrow">{{ section.data.eyebrow }}</span>
              <h2 v-if="section.data.title" class="sn-h2"><span>{{ section.data.title }}</span></h2>
            </div>
            <div class="sn-quotes">
              <figure v-for="(item, i) in section.data.items" :key="i" class="sn-quote">
                <blockquote>{{ item.quote }}</blockquote>
                <figcaption v-if="item.author">— {{ item.author }}</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <!-- Llamado a la acción -->
        <section v-else-if="section.type === 'cta' && section.data.title" :id="section.id" class="sn-section" data-section="cta">
          <div class="sn-wrap">
            <div class="sn-cta">
              <div>
                <h2 class="sn-h2"><span>{{ section.data.title }}</span></h2>
                <p v-if="section.data.text">{{ section.data.text }}</p>
              </div>
              <a
                :href="ctaHref(section.data.button_url)"
                class="sn-btn"
                :target="isExternal(section.data.button_url) ? '_blank' : undefined"
                :rel="isExternal(section.data.button_url) ? 'noopener noreferrer' : undefined"
              >{{ section.data.button_label || "Ver eventos" }}</a>
            </div>
          </div>
        </section>

        <!-- Contacto -->
        <section v-else-if="section.type === 'contact'" :id="section.id" class="sn-section" data-section="contact">
          <div class="sn-wrap">
            <div class="sn-contact">
              <h2 class="sn-h2"><span>{{ section.data.title || info.copy.contactTitle }}</span></h2>
              <p>{{ section.data.text || info.copy.contactText }}</p>
              <a :href="`${base}/contacto`" class="sn-btn">Escríbenos</a>
            </div>
          </div>
        </section>
      </template>
    </main>

    <SiteFooter :site="{ ...site, name: state.name, content: { ...site.content, tagline: state.tagline } }" :base="base" />
  </div>
</template>

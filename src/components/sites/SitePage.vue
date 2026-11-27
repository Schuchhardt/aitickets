<script setup>
// Inicio de un sitio de productor armado con secciones (content.sections, src/lib/siteTemplates.ts), el estilo de su
// plantilla ([data-niche], src/styles/site-niches.css) y el tipo de menú (content.layout: barra superior, centrada o
// lateral). Se renderiza en el servidor y no se hidrata: pestañas, carruseles, ventanas y videos los activa
// src/lib/siteInteractions.js por delegación.
//
// Con live (vista previa del editor, /o/<slug>?editor=1, solo el dueño) se hidrata, redibuja con el borrador que le
// manda el editor por postMessage y permite editar los textos ahí mismo (src/lib/siteLiveEditing.js): cada texto lleva
// data-edit="<destino>" (applyTextEdit en src/lib/siteTemplates.ts) y cada sección data-section-id.
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, provide, reactive } from "vue";
import BannerStrip from "./BannerStrip.vue";
import SiteFooter from "./SiteFooter.vue";
import SnHeader from "./sections/SnHeader.vue";
import SnHero from "./sections/SnHero.vue";
import SnEvents from "./sections/SnEvents.vue";
import SnAbout from "./sections/SnAbout.vue";
import SnFeature from "./sections/SnFeature.vue";
import SnHighlights from "./sections/SnHighlights.vue";
import SnTabs from "./sections/SnTabs.vue";
import SnPeople from "./sections/SnPeople.vue";
import SnGallery from "./sections/SnGallery.vue";
import SnVideo from "./sections/SnVideo.vue";
import SnFaq from "./sections/SnFaq.vue";
import SnTestimonials from "./sections/SnTestimonials.vue";
import SnCta from "./sections/SnCta.vue";
import SnContact from "./sections/SnContact.vue";
import {
  GOOGLE_FONT_QUERIES,
  SECTION_INFO,
  SITE_TEMPLATES,
  TEMPLATE_INFO,
  applyTextEdit,
  fontStack,
  itemIsFilled,
  navLabel,
  plainTextToHtml,
  readableOn,
  resolveThemeFor,
  sanitizeLayout,
  sanitizeSections,
  sectionAnchor,
  videoEmbedUrl,
} from "../../lib/siteTemplates";
import { refreshSiteInteractions } from "../../lib/siteInteractions.js";
import "../../styles/site-niches.css";

const props = defineProps({
  site: { type: Object, required: true }, // PublicSiteProps (src/lib/sites.ts)
  sections: { type: Array, required: true }, // SiteSection[] saneadas
  events: { type: Array, required: false }, // SiteEventCard[]
  banners: { type: Array, required: false },
  aboutHtml: { type: String, default: "" },
  /** Texto plano de "Sobre nosotros" (vista previa en vivo, para editarlo ahí mismo). */
  aboutText: { type: String, default: "" },
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
  aboutText: props.aboutText,
  sections: props.sections,
  layout: sanitizeLayout(props.site.layout),
});

const info = computed(() => TEMPLATE_INFO[state.template] || TEMPLATE_INFO.clasico);
const navStyle = computed(() => state.layout.nav || "top");
const events = computed(() => props.events || []);
const banners = computed(() => props.banners || []);

const HAS_ITEMS = new Set(["highlights", "tabs", "people", "gallery", "faq", "testimonials"]);
/** La sección tiene lo necesario para mostrarse en el sitio público. */
function isComplete(s) {
  const d = s.data || {};
  if (s.type === "about") return !!(props.live ? state.aboutText.trim() : state.aboutHtml);
  if (s.type === "contact") return props.site.contact_form_enabled;
  if (s.type === "feature") return !!(d.text || d.image_url || d.video);
  if (s.type === "video") return !!(d.video || videoEmbedUrl(d.url));
  // Un botón que abre una ventana necesita su texto
  if (s.type === "cta") return !!d.title && (d.button_action !== "modal" || !!d.modal_text);
  if (HAS_ITEMS.has(s.type)) return (d.items || []).some((item) => itemIsFilled(s.type, item));
  return true;
}
// En la vista previa en vivo se muestran también las secciones a medio llenar (con textos de ayuda)
const visible = computed(() => state.sections.filter((s) => !s.hidden && (props.live || isComplete(s))));

const navItems = computed(() => {
  const explicit = visible.value.filter((s) => s.nav && s.type !== "hero");
  if (explicit.length) return explicit.map((s) => ({ label: navLabel(s), href: `#${sectionAnchor(s)}` }));
  const items = [{ label: "Eventos", href: "#eventos" }];
  const faq = visible.value.find((s) => s.type === "faq");
  if (faq) items.push({ label: "Preguntas", href: `#${faq.id}` });
  if (props.site.contact_form_enabled) items.push({ label: "Contacto", href: `${props.base}/contacto` });
  return items;
});

const heroFirst = computed(() => {
  const first = visible.value[0];
  if (!first || first.type !== "hero" || navStyle.value === "sidebar" || state.layout.sticky) return false;
  const layout = first.data.layout || info.value.hero;
  const hasMedia = !!(first.data.video || first.data.image_url || state.theme.hero_image_url || banners.value.find((b) => b.placement === "hero") || events.value[0]?.image_url);
  return layout !== "split" && hasMedia;
});

const cssVars = computed(() => ({
  "--site-primary": state.theme.primary,
  "--site-accent": state.theme.accent,
  "--site-bg": state.theme.background,
  "--site-text": state.theme.text,
  "--site-on-primary": readableOn(state.theme.primary),
  "--site-on-accent": readableOn(state.theme.accent),
  "--site-font": fontStack(state.theme.font),
}));

const COMPONENTS = {
  hero: SnHero,
  events: SnEvents,
  about: SnAbout,
  feature: SnFeature,
  highlights: SnHighlights,
  tabs: SnTabs,
  people: SnPeople,
  gallery: SnGallery,
  video: SnVideo,
  faq: SnFaq,
  testimonials: SnTestimonials,
  cta: SnCta,
  contact: SnContact,
};

/** Atributos de un texto editable en la vista previa en vivo (nada en el sitio público). */
function ed(target, placeholder = "", { multiline = false, optional = false } = {}) {
  if (!props.live) return {};
  return {
    "data-edit": target,
    "data-ph": placeholder,
    ...(multiline ? { "data-ml": "1" } : {}),
    ...(optional ? { "data-optional": "1" } : {}),
  };
}
/** Enlaces internos del sitio: "#eventos", "contacto" o una URL externa. */
function hrefFor(url) {
  if (!url) return "#eventos";
  if (url === "contacto") return `${props.base}/contacto`;
  return url;
}

provide("sn", {
  get live() {
    return props.live;
  },
  get base() {
    return props.base;
  },
  state,
  info,
  events,
  banners,
  ed,
  hrefFor,
  site: props.site,
});

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

let selectedId = null;
function applySelection(scroll = false) {
  if (typeof document === "undefined") return;
  for (const el of document.querySelectorAll("[data-section-id][data-selected]")) el.removeAttribute("data-selected");
  if (!selectedId) return;
  const el = document.querySelector(`[data-section-id="${CSS.escape(selectedId)}"]`);
  if (!el) return;
  el.setAttribute("data-selected", "");
  if (scroll) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

const post = (message) => window.parent?.postMessage(message, window.location.origin);
let stopEditing = null;

function onMessage(event) {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  const data = event.data || {};
  if (data.type === "aitickets:site-select") {
    selectedId = data.sectionId || null;
    applySelection(!!data.scroll);
    return;
  }
  if (data.type === "aitickets:site-open-dialog") {
    const dialog = document.getElementById(String(data.id || ""));
    if (dialog?.showModal && !dialog.open) dialog.showModal();
    return;
  }
  if (data.type !== "aitickets:site-draft") return;
  lastDraft = data.draft || {};
  applyDraft(lastDraft);
}

// Último borrador recibido: una edición hecha aquí se aplica primero a él (y Vue redibuja con el mismo texto que quedó en
// pantalla), así el DOM y Vue nunca se desincronizan aunque el editor deshaga antes de reenviar el borrador.
let lastDraft = null;
function applyDraft(draft) {
  if (SITE_TEMPLATES.includes(draft.template)) state.template = draft.template;
  state.theme = resolveThemeFor(state.template, draft.theme || {});
  state.name = String(draft.title || "").trim() || props.fallbackName || props.site.name;
  state.tagline = String(draft.tagline || "");
  state.aboutText = String(draft.about || "");
  state.aboutHtml = plainTextToHtml(draft.about || "");
  state.sections = sanitizeSections(draft.sections, { keepEmpty: true });
  state.layout = sanitizeLayout(draft.layout);
  ensureFont(state.theme.font);
}

onMounted(async () => {
  if (!props.live) return;
  window.addEventListener("message", onMessage);
  const { startLiveEditing } = await import("../../lib/siteLiveEditing.js");
  stopEditing = startLiveEditing({
    onEdit: (target, value) => {
      if (lastDraft && applyTextEdit(lastDraft, target, value)) applyDraft(lastDraft);
      post({ type: "aitickets:site-edit", target, value });
    },
    onSelect: (sectionId) => {
      selectedId = sectionId;
      applySelection();
      post({ type: "aitickets:site-select", sectionId });
    },
    onShortcut: (action) => post({ type: "aitickets:site-shortcut", action }),
  });
  post({ type: "aitickets:site-preview-ready" });
});
onUpdated(() => {
  if (!props.live) return;
  nextTick(() => {
    refreshSiteInteractions();
    applySelection();
  });
});
onBeforeUnmount(() => {
  if (typeof window !== "undefined") window.removeEventListener("message", onMessage);
  stopEditing?.();
});

const footerSite = computed(() => ({ ...props.site, name: state.name, content: { ...props.site.content, tagline: state.tagline } }));
const emptyNote = (s) =>
  s.type === "contact" ? "El formulario de contacto está desactivado: esta sección no se muestra." : `${SECTION_INFO[s.type].name}: complétala para que se vea en tu sitio.`;
</script>

<template>
  <div class="sn-page" :data-niche="state.template" :data-nav="navStyle" :data-live="live ? '' : undefined" :style="cssVars">
    <BannerStrip :banners="banners" placement="top_bar" />
    <div class="sn-shell">
      <SnHeader :nav-items="navItems" :nav-style="navStyle" :over="heroFirst" :sticky="!!state.layout.sticky" />
      <div class="sn-main-col">
        <main>
          <template v-for="section in visible" :key="section.id">
            <p v-if="live && !isComplete(section)" class="sn-live-note" :data-note-for="section.id">{{ emptyNote(section) }}</p>
            <component :is="COMPONENTS[section.type]" :section="section" />
            <BannerStrip v-if="section.type === 'events'" :banners="banners" placement="inline" />
          </template>
        </main>
        <SiteFooter :site="footerSite" :base="base" />
      </div>
    </div>
  </div>
</template>

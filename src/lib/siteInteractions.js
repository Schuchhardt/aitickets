// Interacciones de los sitios de productor (src/components/sites/SitePage.vue y sus secciones). El sitio público se
// renderiza en el servidor y NO se hidrata: pestañas, carruseles, ventanas (modales), menú del celular y videos se
// activan con delegación de eventos sobre el documento, así funcionan igual en el HTML del servidor y en la vista previa
// en vivo del editor (que sí redibuja con Vue). Se inicia una sola vez por página (SiteLayout.astro).
//
// Marcado que entiende:
//   [data-sn-tabs]            contenedor; adentro [role=tab][aria-controls] y [role=tabpanel]
//   [data-sn-carousel]        contenedor; adentro .sn-carousel-track (scroll-snap) y [data-sn-prev] / [data-sn-next]
//   [data-sn-open="<id>"]     abre el <dialog id="<id>"> (con data-sn-slide="<n>" va a esa foto del carrusel de adentro)
//   dialog.sn-dialog          se cierra con [data-sn-close], Escape o clic en el fondo; los enlaces internos lo cierran
//   video[data-sn-autoplay]   se reproduce solo y sin sonido mientras está en pantalla (no con "reducir movimiento")

const STATE_KEY = "__aiticketsSiteInteractions";

function selectTab(tab, { focus = false } = {}) {
  const root = tab.closest("[data-sn-tabs]");
  if (!root) return;
  const tabs = [...root.querySelectorAll('[role="tab"]')].filter((t) => t.closest("[data-sn-tabs]") === root);
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute("aria-selected", selected ? "true" : "false");
    t.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(t.getAttribute("aria-controls") || "");
    if (panel) panel.hidden = !selected;
  }
  if (focus) tab.focus();
}

function scrollCarousel(root, direction) {
  const track = root.querySelector(".sn-carousel-track");
  if (!track) return;
  const slide = track.firstElementChild;
  const step = slide ? slide.getBoundingClientRect().width + parseFloat(getComputedStyle(track).columnGap || "0") : track.clientWidth;
  const perView = Math.max(1, Math.floor(track.clientWidth / Math.max(1, step)));
  track.scrollBy({ left: direction * step * perView, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function goToSlide(root, index) {
  const track = root?.querySelector(".sn-carousel-track");
  const slide = track?.children[index];
  if (track && slide) track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: "auto" });
}

function updateCarouselButtons(track) {
  const root = track.closest("[data-sn-carousel]");
  if (!root) return;
  const max = track.scrollWidth - track.clientWidth - 2;
  const prev = root.querySelector("[data-sn-prev]");
  const next = root.querySelector("[data-sn-next]");
  if (prev) prev.disabled = track.scrollLeft <= 2;
  if (next) next.disabled = track.scrollLeft >= max;
}

const prefersReducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function openDialog(id, slide) {
  const dialog = document.getElementById(id);
  if (!dialog || typeof dialog.showModal !== "function") return;
  if (!dialog.open) dialog.showModal();
  if (slide !== undefined) requestAnimationFrame(() => goToSlide(dialog.querySelector("[data-sn-carousel]"), Number(slide)));
}

function onClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  // En la vista previa del editor, un clic para editar un texto lo detiene antes src/lib/siteLiveEditing.js
  if (!target) return;

  const tab = target.closest('[data-sn-tabs] [role="tab"]');
  if (tab) {
    selectTab(tab);
    return;
  }
  const prev = target.closest("[data-sn-prev]");
  const next = target.closest("[data-sn-next]");
  if (prev || next) {
    scrollCarousel((prev || next).closest("[data-sn-carousel]"), prev ? -1 : 1);
    return;
  }
  const opener = target.closest("[data-sn-open]");
  if (opener) {
    event.preventDefault();
    openDialog(opener.getAttribute("data-sn-open"), opener.getAttribute("data-sn-slide") ?? undefined);
    return;
  }
  const dialog = target.closest("dialog.sn-dialog");
  if (dialog) {
    // Clic en el fondo (fuera de la caja), en una X o en un enlace interno del menú
    if (target === dialog || target.closest("[data-sn-close]") || (target.closest("a[href]") && dialog.classList.contains("sn-drawer"))) {
      if (target.closest("[data-sn-close]")) event.preventDefault();
      dialog.close();
    }
  }
}

function onKeydown(event) {
  const tab = event.target instanceof Element ? event.target.closest('[data-sn-tabs] [role="tab"]') : null;
  if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const root = tab.closest("[data-sn-tabs]");
  const tabs = [...root.querySelectorAll('[role="tab"]')].filter((t) => t.closest("[data-sn-tabs]") === root);
  const i = tabs.indexOf(tab);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  selectTab(tabs[nextIndex], { focus: true });
}

function onScroll(event) {
  const track = event.target;
  if (track instanceof Element && track.classList.contains("sn-carousel-track")) updateCarouselButtons(track);
}

// --- Videos que se reproducen solos ---
let observer = null;
function onIntersect(entries) {
  for (const entry of entries) {
    const video = entry.target;
    if (entry.isIntersecting && !prefersReducedMotion()) {
      video.muted = video.muted || !video.dataset.snUnmuted;
      const p = video.play();
      if (p?.catch) p.catch(() => {});
    } else if (!entry.isIntersecting) {
      video.pause();
    }
  }
}

/** Busca carruseles y videos nuevos (después de que la vista previa en vivo redibuja). */
export function refreshSiteInteractions(root = document) {
  if (typeof window === "undefined") return;
  for (const track of root.querySelectorAll(".sn-carousel-track")) updateCarouselButtons(track);
  if (!("IntersectionObserver" in window)) return;
  observer = observer || new IntersectionObserver(onIntersect, { threshold: 0.35 });
  for (const video of root.querySelectorAll("video[data-sn-autoplay]")) {
    if (video.dataset.snObserved) continue;
    video.dataset.snObserved = "1";
    video.muted = true;
    observer.observe(video);
  }
}

export function initSiteInteractions() {
  if (typeof window === "undefined" || window[STATE_KEY]) return;
  window[STATE_KEY] = true;
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("volumechange", (e) => {
    // Si la persona activa el sonido con los controles, que no se vuelva a silenciar al reaparecer
    if (e.target instanceof HTMLVideoElement && !e.target.muted) e.target.dataset.snUnmuted = "1";
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) for (const v of document.querySelectorAll("video[data-sn-autoplay]")) v.pause();
  });
  const start = () => refreshSiteInteractions();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  window.addEventListener("resize", () => {
    for (const track of document.querySelectorAll(".sn-carousel-track")) updateCarouselButtons(track);
  }, { passive: true });
}

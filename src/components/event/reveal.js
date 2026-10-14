// v-reveal: el elemento entra con un fade-up al aparecer en pantalla (A31, clases en src/styles/global.css).
// La clase se agrega recién al montar: sin JS (o antes de hidratar) el contenido se ve normal.
// Con prefers-reduced-motion no se anima. Valor opcional: retraso en ms (v-reveal="120").
export const vReveal = {
  mounted(el, binding) {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Ya visible al montar (arriba de la página): no se esconde para no producir un parpadeo
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) return;
    if (binding.value) el.style.setProperty("--reveal-delay", `${Number(binding.value) || 0}ms`);
    el.classList.add("ev-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    io.observe(el);
    el._revealIo = io;
  },
  unmounted(el) {
    el._revealIo?.disconnect();
  },
};

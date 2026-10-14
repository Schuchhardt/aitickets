// Confetti al confirmar asistencia o una compra (A32). Canvas propio, sin dependencias: un canvas fijo encima
// de todo que se borra solo al terminar. Con prefers-reduced-motion no hace nada.
// Lo usan RsvpForm.vue, CheckoutSheet.vue (demo) y src/pages/payment-confirmation.astro.

const COLORS = ["#a3e635", "#bef264", "#84cc16", "#0a0a0b", "#d4d4d8", "#ffffff", "#65a30d"];
const GRAVITY = 0.32;
const DRAG = 0.985;

/**
 * Lanza confetti desde un punto (por defecto, el centro-abajo de un elemento o de la pantalla).
 * @param {{ origin?: Element | { x: number, y: number }, count?: number, spread?: number }} [opts]
 */
export function fireConfetti({ origin, count = 140, spread = 70 } = {}) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let ox = window.innerWidth / 2;
  let oy = window.innerHeight * 0.6;
  if (origin && typeof origin.getBoundingClientRect === "function") {
    const r = origin.getBoundingClientRect();
    ox = r.left + r.width / 2;
    oy = r.top + r.height / 2;
  } else if (origin && Number.isFinite(origin.x)) {
    ({ x: ox, y: oy } = origin);
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "100" });
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const rad = (deg) => (deg * Math.PI) / 180;
  const pieces = Array.from({ length: count }, (_, i) => {
    // Dos chorros hacia arriba, levemente a izquierda y derecha
    const side = i % 2 ? 1 : -1;
    const angle = rad(-90 + side * (10 + Math.random() * spread * 0.5));
    const speed = 9 + Math.random() * 9;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      tilt: Math.random() * Math.PI,
      vt: 0.05 + Math.random() * 0.12,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      round: Math.random() < 0.3,
      life: 0,
      ttl: 110 + Math.random() * 70,
    };
  });

  let raf = 0;
  const tick = () => {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let alive = 0;
    for (const p of pieces) {
      if (p.life > p.ttl) continue;
      alive++;
      p.life++;
      p.vx *= DRAG;
      p.vy = p.vy * DRAG + GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.tilt += p.vt;
      const fade = p.life > p.ttl - 30 ? (p.ttl - p.life) / 30 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.tilt)); // giro en 3D
      ctx.fillStyle = p.color;
      if (p.color === "#ffffff") {
        ctx.strokeStyle = "rgba(0,0,0,0.12)";
        ctx.lineWidth = 1;
      }
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
        if (p.color === "#ffffff") ctx.stroke();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        if (p.color === "#ffffff") ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(tick);
    else canvas.remove();
  };
  raf = requestAnimationFrame(tick);
  // Seguridad: nunca dejar el canvas pegado
  setTimeout(() => {
    cancelAnimationFrame(raf);
    canvas.remove();
  }, 6000);
}

// Ayudas de navegador de la landing de fiestas (SPEC_landing_fiestas §1 y §6): la ráfaga de confeti y el observador que
// pausa el confeti flotante fuera de pantalla. Solo navegador (las importan las islas y el script de la página).

const COLORS = ['var(--fi-amarillo)', 'var(--fi-naranja)', 'var(--fi-cobalto)', 'var(--fi-crema)']
const BURST_PIECES = 24
const BURST_MS = 900
let bursting = false

/** ¿El navegador pide reducir movimiento? (sin ráfagas ni loops) */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Ráfaga de confeti (F8, F18): 24 piezas que salen del centro de `origin` con transform y opacity (900 ms) y se borran
 * del DOM al terminar. Solo como respuesta a una acción y nunca más de una a la vez; con "reducir movimiento", nada.
 * Las piezas se cuelgan de `host` (un contenedor position: relative), así no se escapan del ancho de la página.
 */
export function burstConfetti(origin, host = origin?.offsetParent) {
  if (!origin || !host || bursting || prefersReducedMotion() || typeof origin.animate !== 'function') return
  bursting = true
  const o = origin.getBoundingClientRect()
  const h = host.getBoundingClientRect()
  const x = o.left + o.width / 2 - h.left
  const y = o.top + o.height / 2 - h.top
  const pieces = []
  for (let i = 0; i < BURST_PIECES; i++) {
    const el = document.createElement('span')
    el.className = `fi-burst-piece${i % 3 === 2 ? ' is-dot' : ''}`
    el.setAttribute('aria-hidden', 'true')
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.background = COLORS[i % COLORS.length]
    host.appendChild(el)
    // Abanico hacia arriba, con distancias y giros distintos por pieza (deterministas: sin Math.random)
    const angle = (-160 + (140 / (BURST_PIECES - 1)) * i) * (Math.PI / 180) + ((i % 2) - 0.5) * 0.18
    const dist = 70 + ((i * 37) % 90)
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist
    const spin = ((i * 53) % 360) - 180
    el.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx * 1.15}px, ${dy + 70}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: BURST_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    )
    pieces.push(el)
  }
  setTimeout(() => {
    pieces.forEach((el) => el.remove())
    bursting = false
  }, BURST_MS + 40)
}

/** Pausa las animaciones en loop fuera de pantalla: [data-fi-play] lleva .is-playing solo mientras se ve (F16) */
export function observePlay(root = document) {
  if (!('IntersectionObserver' in window)) return
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.classList.toggle('is-playing', entry.isIntersecting)
  })
  root.querySelectorAll('[data-fi-play]').forEach((el) => io.observe(el))
}

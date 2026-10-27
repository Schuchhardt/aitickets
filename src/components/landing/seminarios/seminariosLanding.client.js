// Ayudas de navegador de la landing de seminarios (SPEC_landing_seminarios §1 y §6): el balanceo de la credencial (C4),
// la entrada de los rótulos de sala (C5) y la sala que se oscurece en el cierre (C17). Solo navegador (las importan las
// islas y el script de la página). Todo respeta "reducir movimiento" y la clase html.lp-motion de LandingMotion: sin
// ella, todo queda en su estado final.

/** ¿Hay movimiento? (LandingMotion pone html.lp-motion solo con JS y sin "reducir movimiento") */
export const motionOn = () =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('lp-motion') &&
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** C4: péndulo amortiguado desde el clip (4° → −3° → 2° → −1° → 0°, 1,6 s). Reinicia la animación si ya estaba */
export function swing(el) {
  if (!el || !motionOn()) return
  el.classList.remove('is-swinging')
  void el.offsetWidth // reinicia la animación CSS
  el.classList.add('is-swinging')
}

const PUSH_EVERY_MS = 800
const PUSH_MIN_SPEED = 1.2 // px por ms: scroll rápido

/**
 * Credenciales con [data-se-swing]: se balancean al entrar en pantalla y, en un scroll rápido, reciben un empujón de ±2°
 * (como máximo una vez cada 800 ms). Un IntersectionObserver y un listener de scroll pasivo con requestAnimationFrame.
 */
export function observeSwing(root = document) {
  if (!('IntersectionObserver' in window)) return
  const visible = new Set()
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!visible.has(entry.target)) swing(entry.target)
          visible.add(entry.target)
        } else visible.delete(entry.target)
      }
    },
    { threshold: 0.4 },
  )
  root.querySelectorAll('[data-se-swing]').forEach((el) => io.observe(el))

  let lastY = window.scrollY
  let lastT = performance.now()
  let lastPush = 0
  let frame = 0
  const onScroll = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const now = performance.now()
      const speed = (window.scrollY - lastY) / Math.max(1, now - lastT)
      lastY = window.scrollY
      lastT = now
      if (Math.abs(speed) < PUSH_MIN_SPEED || now - lastPush < PUSH_EVERY_MS || !motionOn()) return
      lastPush = now
      const deg = speed > 0 ? 2 : -2
      visible.forEach((el) => {
        if (el.classList.contains('is-swinging') || typeof el.animate !== 'function') return
        el.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${deg}deg)` }, { transform: `rotate(${-deg / 2}deg)` }, { transform: 'rotate(0deg)' }], {
          duration: 900,
          easing: 'ease-out',
        })
      })
    })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
}

/**
 * C5: cada rótulo de sala entra al 30% de visibilidad (una vez). Se observa su contenedor y no el rótulo: mientras no
 * entra, el rótulo está recortado entero (clip-path) y el observador no lo vería nunca.
 */
export function observeSigns(root = document) {
  const signs = [...root.querySelectorAll('[data-se-sign]')]
  if (!('IntersectionObserver' in window)) {
    signs.forEach((el) => el.classList.add('is-in'))
    return
  }
  const byBox = new Map(signs.map((el) => [el.parentElement, el]))
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        byBox.get(entry.target)?.classList.add('is-in')
        io.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -30% 0px', threshold: 0 },
  )
  byBox.forEach((_, box) => box && io.observe(box))
}

/** C17: [data-se-dim] lleva .is-on al entrar (la sala se oscurece y la lámina se enciende) */
export function observeDim(root = document) {
  if (!('IntersectionObserver' in window)) return
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-on')
        io.unobserve(entry.target)
      }
    },
    { threshold: 0.3 },
  )
  root.querySelectorAll('[data-se-dim]').forEach((el) => io.observe(el))
}

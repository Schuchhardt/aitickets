// Datos de la landing de academias (/academias, docs/specs/rediseno/SPEC_landing_academias_aitickets.md).
// Sin dependencias de Node: lo usan las secciones Astro, las islas Vue y los tests. Los montos y plazos NO van aquí:
// salen de fees.mjs / legal.mjs (vía producerLanding.js y la página), como en /organizadores y /ticketera-stand-up.

/**
 * Fotos de la página. Son las de referencia generadas con IA (public/landing, ver docs/specs/rediseno/README.md): antes
 * de publicar van fotos reales de muestras con autorización escrita de la academia y de las familias; si aparecen
 * menores, con el consentimiento de sus apoderados (§0.3 y Fase 3). Mismo bloqueo de publicación que las de stand-up.
 * Cada una con AVIF/WebP a varios anchos (generados con sharp desde el JPG: regenerar si cambia la foto).
 */
const photo = (name, width, height, widths) => ({
  src: `/landing/${name}.jpg`,
  width,
  height,
  sources: ['avif', 'webp'].map((ext) => ({
    type: `image/${ext}`,
    srcset: widths.map((w) => `/landing/${name}-${w}.${ext} ${w}w`).join(', '),
  })),
})

export const ACADEMY_PHOTOS = Object.freeze({
  recital: photo('aitk-acad-recital', 1344, 768, [640, 1024, 1344]),
  puerta: photo('aitk-acad-puerta', 896, 1152, [480, 896]),
  directora: photo('aitk-acad-directora', 896, 1152, [480, 896]),
  teatro: photo('aitk-acad-teatro', 896, 1152, [480, 896]),
})

/**
 * Muestra de ejemplo de los mockups (hero, panel del comparador y puerta). Cifras ficticias: siempre con el rótulo
 * "ejemplo". Las entradas por curso suman las vendidas y lo recaudado es vendidas × precio (el de la calculadora).
 */
export const ACADEMY_DEMO = Object.freeze({
  name: 'Muestra de fin de año',
  when: 'Sáb 13 dic · 11:00 y 17:00',
  venue: 'Teatro del colegio',
  sold: 212,
  capacity: 240,
  price: 5000,
  family: 'Familia Rojas',
  familyTickets: 4,
})

/** Entradas por curso del panel de ejemplo (§3.3): cada curso con su link con seguimiento */
export const ACADEMY_COURSES = Object.freeze([
  { name: 'Teatro infantil', tickets: 64 },
  { name: 'Piano', tickets: 48 },
  { name: 'Canto', tickets: 40 },
  { name: 'Violín', tickets: 36 },
  { name: 'Guitarra', tickets: 24 },
])

/**
 * Chat genérico del "Antes" (§3.3 y §0.5): sin logo ni colores de WhatsApp. mine = mensaje propio (a la derecha).
 * desktopOnly: en mobile el chat muestra 5 mensajes (§3.10).
 */
export const ACADEMY_CHAT = Object.freeze({
  title: 'Apoderados Piano 2026',
  members: 47,
  unread: 38,
  messages: [
    { name: 'Carla (mamá de Sofi)', text: '¿Quedan entradas para el sábado? Somos 5' },
    { name: 'Jorge', text: 'Transferí $15.000, ¿me confirman?' },
    { name: 'Profe Marcela', text: 'Las entradas se retiran el jueves en secretaría', mine: true },
    { name: 'Ana', text: '¿La abuela paga entrada?', desktopOnly: true },
    { name: 'Paula', text: 'No alcancé a retirarlas, ¿las pueden dejar en la puerta?' },
    { name: 'Jorge', text: '¿Les llegó mi transferencia???' },
  ],
})

/** Cuando el comparador pasa solo de "Antes" a "Con AI Tickets" (AC7) */
export const COMPARE_AUTO_SWITCH_MS = 2600

/** Tipos de academia de "Hecho para" (§3.7) */
export const ACADEMY_FOR_WHO = Object.freeze([
  'Academias de música',
  'Escuelas de danza',
  'Talleres de teatro',
  'Coros',
  'Colegios artísticos',
  'Conservatorios',
])

/** Rango del slider de la calculadora (§3.6) */
export const ACADEMY_CALC_PRICE = Object.freeze({ min: 1000, max: 20000, step: 500, default: ACADEMY_DEMO.price })

/** Recaudado del panel de ejemplo */
export const academyDemoRevenue = () => ACADEMY_DEMO.sold * ACADEMY_DEMO.price

/** Escala (0-1) de la barra de cada curso respecto del que más vendió */
export function courseScales(courses = ACADEMY_COURSES) {
  const max = Math.max(...courses.map((c) => c.tickets), 1)
  return courses.map((c) => c.tickets / max)
}

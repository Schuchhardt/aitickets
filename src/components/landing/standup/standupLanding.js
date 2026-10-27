// Datos y cálculos de la landing de stand-up (/ticketera-stand-up, docs/specs/rediseno/SPEC_landing_standup_aitickets.md).
// Sin dependencias de Node: lo usan las secciones Astro y las islas Vue. Los montos y plazos NO van aquí: salen de
// fees.mjs / legal.mjs (vía producerLanding.js) como en /organizadores.
import { LANDING_MEDIA } from '../producerLanding.js'

/**
 * Fotos de la página. Son las de referencia generadas con IA (public/landing, ver docs/specs/rediseno/README.md): antes
 * de publicar van fotos reales de shows de productores que usen AI Tickets, con autorización escrita (§0.2 y Fase 4).
 * BLOQUEO DE PUBLICACIÓN: la spec las permite solo en staging y el sitio no tiene un entorno de staging propio (el
 * merge del PR publica), así que no se esconden por entorno: el PR lo deja anotado y /organizadores, que ya usa
 * aitk-hero-standup, sigue la misma decisión.
 * Cada una con AVIF/WebP a varios anchos (generados con sharp desde el JPG: regenerar si cambia la foto). Las de
 * referencia no pasan de 1344 px (apaisadas) ni de 896 px (verticales): el hero no llega a los 2400 px de §6 y el
 * cierre (una vertical a pantalla completa) se ve blando en desktop. Las reales deben venir a 2400 px.
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

export const STANDUP_PHOTOS = Object.freeze({
  // Portada: la misma foto (y el mismo clip) que la portada de ejemplo de /organizadores
  hero: {
    src: LANDING_MEDIA.coverPoster,
    width: LANDING_MEDIA.coverPosterWidth,
    height: LANDING_MEDIA.coverPosterHeight,
    sources: LANDING_MEDIA.coverPosterSources,
  },
  productor: photo('aitk-productor', 896, 1152, [480, 896]),
  backstage: photo('aitk-backstage', 896, 1152, [480, 896]),
  puerta: photo('aitk-puerta-qr', 896, 1152, [480, 896]),
  publico: photo('aitk-publico', 1344, 768, [640, 1024, 1344]),
  comediante: photo('aitk-comediante', 896, 1152, [480, 896]),
  openmic: photo('aitk-openmic', 896, 1152, [480, 896]),
})

/** Franja de formatos (§4.2) */
export const STANDUP_FORMATS = Object.freeze([
  'Open mic',
  'Noche de comedia',
  'Show solista',
  'Line-up',
  'Impro',
  'Roast',
  'Temporada en sala',
  'Gira',
])

/** Mini mapa de la card "Vendiendo ahora" (§4.1): 100 asientos, 71 vendidos, repartidos sin patrón visible */
export const HERO_SEATS = Object.freeze({ total: 100, sold: 71 })
export const heroSeatSold = (i) => (i * 37) % HERO_SEATS.total < HERO_SEATS.sold

/** Ventas por link del capítulo del miércoles (§4.3). Cifras ficticias: la card dice "ejemplo". */
export const LINK_SALES = Object.freeze([
  { name: 'Link de campaña · Instagram', tickets: 37 },
  { name: 'Link de Pedro · comediante', tickets: 23 },
  { name: 'Link de Ana · promotora', tickets: 11 },
])
export const LINK_SALES_MAX = 40

/** Monto de ejemplo de la función del viernes (§4.3, domingo) */
export const DEMO_PAYOUT = 1296000

/**
 * Orden estable en que se llenan los asientos del mapa (§4.5): un barajado determinista (el mismo en el servidor y en
 * cada visita) de los asientos de `rows` × `cols`. El pasillo (`aisleIndex`) es una columna vacía extra que no cuenta.
 * Devuelve, por cada celda de la grilla (fila por fila, con pasillo), su turno de venta o -1 si es pasillo.
 */
export function seatRanks(rows, cols, aisleIndex) {
  const width = cols + 1
  const seats = []
  for (let i = 0; i < rows * width; i++) if (i % width !== aisleIndex) seats.push(i)
  for (let k = seats.length - 1; k > 0; k--) {
    const j = Math.floor((((k * 9301 + 49297) % 233280) / 233280) * (k + 1))
    ;[seats[k], seats[j]] = [seats[j], seats[k]]
  }
  const ranks = new Array(rows * width).fill(-1)
  seats.forEach((cell, rank) => {
    ranks[cell] = rank
  })
  return ranks
}

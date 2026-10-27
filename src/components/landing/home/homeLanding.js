// Datos de la portada (/): una pizca de cada landing de nicho (foto, frase y colores de su página) y el recorrido de una
// función contado con fotos de distintos nichos. Sin dependencias de Node: lo usan las secciones Astro y los tests.
// Las fotos son las generadas con IA de public/landing (docs/specs/rediseno/fotos-nicho.md), con AVIF/WebP a varios
// anchos. Las frases de cada nicho son el H1 de su landing: si cambia allá, cambia acá (tests/e2e/marketing.spec.ts).

const photo = (name, width, height, widths) => ({
  src: `/landing/${name}.jpg`,
  width,
  height,
  sources: ['avif', 'webp'].map((ext) => ({
    type: `image/${ext}`,
    srcset: widths.map((w) => `/landing/${name}-${w}.${ext} ${w}w`).join(', '),
  })),
})

const portrait = (name, height = 1152) => photo(name, 896, height, [480, 896])
const wide = (name) => photo(name, 1024, 688, [640, 1024])

/**
 * Nichos en el orden de la portada. bg/fg/accent son los colores de cada landing (landing-<nicho>.css): la card de la
 * portada se viste como la página a la que lleva. fg sobre bg y accent sobre bg cumplen AA para texto grande.
 */
export const HOME_NICHES = Object.freeze([
  {
    key: 'standup',
    href: '/ticketera-stand-up',
    name: 'Stand-up',
    tagline: 'Tú haz el show.',
    text: 'Funciones todas las semanas y un link para cada comediante.',
    photo: portrait('aitk-comediante'),
    alt: 'Comediante con el micrófono en un escenario de stand-up',
    bg: '#0e0b09',
    fg: '#f4ede4',
    accent: '#e9dccb',
  },
  {
    key: 'teatro',
    href: '/ticketera-teatro',
    name: 'Teatro',
    tagline: 'Que suba el telón.',
    text: 'Temporadas con muchas funciones y entradas por función.',
    photo: wide('aitk-teatro-funcion'),
    alt: 'Función de teatro con el público mirando el escenario iluminado',
    bg: '#0c1220',
    fg: '#f0e8d8',
    accent: '#d4af6a',
  },
  {
    key: 'musica',
    href: '/ticketera-musica-en-vivo',
    name: 'Música en vivo',
    tagline: 'Tú pon la música.',
    text: 'Preventas por tanda, links por banda y QR en la puerta.',
    photo: wide('aitk-musica-sala'),
    alt: 'Banda tocando en una sala llena',
    bg: '#0a0a0d',
    fg: '#f2f0eb',
    accent: '#ff3b30',
  },
  {
    key: 'clubs',
    href: '/ticketera-discotecas',
    name: 'Clubs y discotecas',
    tagline: 'Abre la puerta.',
    text: 'Un link para cada RRPP y la fila avanzando con QR.',
    photo: wide('aitk-club-pista'),
    alt: 'Pista de un club con luces de colores',
    bg: '#07060b',
    fg: '#eeeaf8',
    accent: '#ff4fb8',
  },
  {
    key: 'fiestas',
    href: '/ticketera-fiestas',
    name: 'Fiestas',
    tagline: 'Preventa 1: agotada.',
    text: 'Tandas de preventa, promotores con link propio y tu fiesta en Instagram.',
    photo: wide('aitk-fiesta-pista'),
    alt: 'Fiesta con gente bailando bajo luces naranjas',
    bg: '#ff5b14',
    fg: '#16110d',
    accent: '#16110d',
  },
  {
    key: 'talleres',
    href: '/ticketera-talleres',
    name: 'Talleres',
    tagline: 'Abre inscripciones con un link.',
    text: 'Cupos, inscripciones gratis o pagadas y recordatorio antes de la clase.',
    photo: wide('aitk-taller-clase'),
    alt: 'Taller con personas trabajando alrededor de una mesa',
    bg: '#f4f6f1',
    fg: '#1f2329',
    accent: '#2547c5',
  },
  {
    key: 'seminarios',
    href: '/ticketera-seminarios',
    name: 'Seminarios',
    tagline: 'Tú armas el programa.',
    text: 'Entradas por tipo y acreditación con QR en la entrada.',
    photo: wide('aitk-seminario-sala'),
    alt: 'Sala de un seminario con el público frente al expositor',
    bg: '#f5f5f0',
    fg: '#15191c',
    accent: '#006b65',
  },
  {
    key: 'academias',
    href: '/academias',
    name: 'Academias',
    tagline: 'El día de la muestra.',
    text: 'Muestras y recitales con entradas para las familias, gratis o pagadas.',
    photo: photo('aitk-acad-recital', 1344, 768, [640, 1024, 1344]),
    alt: 'Recital de una academia de danza visto desde el público',
    bg: '#fbf7f0',
    fg: '#1b1712',
    accent: '#7a5c3e',
  },
])

/** Palabra que rota en el hero ("Para tu …"), una por nicho, en el mismo orden. */
export const HOME_ROTATING_WORDS = Object.freeze([
  'stand-up',
  'obra de teatro',
  'tocata',
  'noche de club',
  'fiesta',
  'taller',
  'seminario',
  'muestra',
])

/**
 * Mosaico del hero: tres columnas de fotos verticales que bajan o suben despacio. Cada foto lleva la etiqueta de su
 * nicho. Solo decorativo (aria-hidden): los nichos con enlace están en la sección "Elige tu escenario".
 */
export const HOME_MOSAIC = Object.freeze([
  [
    { photo: portrait('aitk-comediante'), label: 'Stand-up' },
    { photo: portrait('aitk-club-vip', 1120), label: 'Club' },
    { photo: portrait('aitk-taller-tallerista', 1120), label: 'Taller' },
    { photo: portrait('aitk-acad-teatro'), label: 'Academia' },
  ],
  [
    { photo: portrait('aitk-teatro'), label: 'Teatro' },
    { photo: portrait('aitk-fiesta-universitaria', 1120), label: 'Fiesta' },
    { photo: portrait('aitk-seminario-acreditacion', 1120), label: 'Seminario' },
    { photo: portrait('aitk-openmic'), label: 'Open mic' },
  ],
  [
    { photo: portrait('aitk-musica'), label: 'Música' },
    { photo: portrait('aitk-puerta-qr'), label: 'QR' },
    { photo: portrait('aitk-musica-prueba-sonido', 1120), label: 'Sonido' },
    { photo: portrait('aitk-club-puerta', 1120), label: 'Puerta' },
  ],
])

/** Fotos del recorrido "Una función, de principio a fin" (HomeStory.astro). */
export const HOME_STORY_PHOTOS = Object.freeze({
  publicas: portrait('aitk-productor'),
  difusion: portrait('aitk-fiesta-promotor', 1120),
  venta: portrait('aitk-musica'),
  puerta: portrait('aitk-club-puerta', 1120),
  cobro: portrait('aitk-seminario-organizadora', 1120),
})

/** Fotos del cierre: una tira con un poco de cada nicho. */
export const HOME_CLOSING_PHOTOS = Object.freeze([
  portrait('aitk-backstage'),
  portrait('aitk-teatro-ensayo', 1120),
  portrait('aitk-fiesta-montaje', 1120),
  portrait('aitk-acad-directora'),
  portrait('aitk-club-manager', 1120),
])

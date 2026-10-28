// Escenarios de la página pública del evento para los e2e sin BD (tests/e2e/event-quantity.spec.ts,
// tests/e2e/event-action-card.spec.ts y otros). Los sirve
// tests/e2e/fixtures/event-fixture-page.astro en FIXTURE_ROUTE/<escenario> (solo en `astro dev` con
// E2E_FIXTURES=1).
// Las entradas están como filas de event_tickets en la BD (max_quantity null = el productor no configuró un
// máximo por compra); la página las pasa por toPublicTicket (src/lib/eventPage.ts), igual que la página real.

import { agendaGroups } from "../../../src/lib/eventAgenda.mjs";

export const FIXTURE_ROUTE = "/__e2e/eventos";

export const TICKETS = {
  general: { id: 9101, ticket_name: "General", price: 4000, max_quantity: null, total_quantity: null },
  vip: { id: 9102, ticket_name: "VIP", price: 9000, max_quantity: null, total_quantity: null },
  // El productor configuró un máximo de 3 por compra
  generalMax3: { id: 9103, ticket_name: "General", price: 4000, max_quantity: 3, total_quantity: null },
  // Quedan 5 de 100: "Últimas entradas"
  generalLast: { id: 9104, ticket_name: "General", price: 4000, max_quantity: null, total_quantity: 5 },
  free: { id: 9105, ticket_name: "Entrada liberada", price: 0, max_quantity: null, total_quantity: null },
  // Quedan 8 cupos: "Gratis · Quedan 8 cupos"
  freeFew: { id: 9106, ticket_name: "Entrada liberada", price: 0, max_quantity: null, total_quantity: 8 },
  // Mesa para 4 (people_per_ticket): un QR por persona, precio y cupo por mesa
  table: { id: 9107, ticket_name: "Mesa VIP", price: 120000, max_quantity: null, total_quantity: 10, people: 4 },
};

/** Datos extra del checkout (events.checkout_fields) para tests/e2e/checkout-extras.spec.ts */
const SEMINAR_FIELDS = {
  attendee_names: "required",
  company: true,
  questions: [
    { id: "nivel", label: "Nivel", type: "choice", options: ["Básico", "Avanzado"], required: true },
    { id: "auto", label: "¿Vienes en auto?", type: "yes_no", required: false },
  ],
};

/** Lugares para los eventos con varias funciones (el de una función es "Teatro de Prueba", en fixtureEvent). */
const VENUE_PROVIDENCIA = { name: "Sala Agustín Siré", address: "Morandé 750", city: "Providencia" };
const VENUE_NUNOA = { name: "Teatro Ñuñoa", address: "Av. Irarrázaval 1564", city: "Ñuñoa" };

/**
 * Gira con 5 funciones en 2 lugares, cada una con su entrada (event_date_id). La primera está agotada y a la
 * segunda le quedan 4: los chips de la card muestran 2.ª, 3.ª y 4.ª y "+ 1 función".
 */
const TOUR = {
  functions: [
    { days: 30, venue: VENUE_PROVIDENCIA },
    { days: 31, venue: VENUE_PROVIDENCIA },
    { days: 37, venue: VENUE_NUNOA },
    { days: 38, venue: VENUE_NUNOA },
    { days: 44, venue: VENUE_NUNOA },
  ],
  // fn: índice de la función a la que está amarrada la entrada
  tickets: [
    { id: 9112, ticket_name: "General", price: 6000, max_quantity: null, total_quantity: 4, fn: 1 },
    { id: 9113, ticket_name: "General", price: 6000, max_quantity: null, total_quantity: null, fn: 2 },
    { id: 9114, ticket_name: "General", price: 6000, max_quantity: null, total_quantity: null, fn: 3 },
    { id: 9115, ticket_name: "General", price: 6000, max_quantity: null, total_quantity: null, fn: 4 },
  ],
  unavailable: [{ id: 9111, ticket_name: "General", price: 6000, fn: 0, reason: "sold_out" }],
};

/**
 * Temporada de 9 funciones en un solo lugar, cada una con su entrada; la última con una VIP más cara (desde-precio
 * propio en la lista). La sección Funciones muestra las 6 próximas y "Ver las 9 funciones" (§4.9b).
 */
const SEASON = {
  functions: Array.from({ length: 9 }, (_, i) => ({ days: 30 + i * 2, venue: VENUE_PROVIDENCIA })),
  tickets: [
    ...Array.from({ length: 8 }, (_, i) => ({ id: 9120 + i, ticket_name: "General", price: 6000, max_quantity: null, total_quantity: null, fn: i })),
    { id: 9128, ticket_name: "VIP", price: 15000, max_quantity: null, total_quantity: null, fn: 8 },
    { id: 9129, ticket_name: "Platea", price: 9000, max_quantity: null, total_quantity: null, fn: 8 },
  ],
};

/**
 * La misma gira, pero la entrada de la última función sale a la venta en 5 días (reason "upcoming"): en la lista
 * dice "Disponible desde el …", no "Agotada".
 */
const TOUR_OPENING_LATER = {
  ...TOUR,
  tickets: TOUR.tickets.filter((t) => t.fn !== 4),
  unavailable: [...TOUR.unavailable, { id: 9115, ticket_name: "General", price: 6000, fn: 4, reason: "upcoming", salesStartsInDays: 5 }],
};

/** 3 funciones con una sola entrada válida para cualquiera (sin event_date_id): no se elige función al comprar. */
const RUN_ANY_FUNCTION = {
  functions: [{ days: 30, venue: VENUE_PROVIDENCIA }, { days: 31, venue: VENUE_PROVIDENCIA }, { days: 32, venue: VENUE_PROVIDENCIA }],
  tickets: [TICKETS.general],
};

/**
 * Congreso de 2 días con pase completo y agenda (tests/e2e/event-agenda.spec.ts): fn = índice de la función del
 * bloque; sin fn, vale para todos los días.
 */
const CONGRESS = {
  functions: [{ days: 30, venue: VENUE_PROVIDENCIA }, { days: 31, venue: VENUE_PROVIDENCIA }],
  tickets: [TICKETS.general],
  agenda: [
    { start: "08:30", end: "09:00", title: "Acreditación y café", room: "Hall" },
    { fn: 0, start: "09:30", end: "10:30", title: "Charla inaugural", speakers: "Ana Pérez (Empresa Ejemplo)", room: "Sala 1" },
    { fn: 0, start: "09:00", end: "09:30", title: "Bienvenida" },
    { fn: 1, start: "10:00", end: "11:30", title: "Panel: IA en la empresa", speakers: "Juan Soto, Marta Díaz", room: "Sala 2" },
  ],
};

/** layout: diseño elegido por el productor (sin imagen el diseño siempre es compacto). */
export const SCENARIOS = {
  "poster-una-entrada": { layout: "poster", tickets: [TICKETS.general] },
  "banner-una-entrada": { layout: "banner", tickets: [TICKETS.general] },
  "compacto-una-entrada": { layout: "compact", image: false, tickets: [TICKETS.general] },
  "varias-entradas": { layout: "poster", tickets: [TICKETS.general, TICKETS.vip] },
  "maximo-configurado": { layout: "poster", tickets: [TICKETS.generalMax3] },
  // Evento que ya terminó (hace 2 días), con reseñas y fotos de asistentes (tests/e2e/event-reviews.spec.ts)
  "terminado-con-resenas": { layout: "poster", tickets: [], ended: true, reviews: true },
  // Videos del evento (tests/e2e/event-video.spec.ts): de portada en cada diseño (compacto se muestra como póster)
  // y opcional en la galería
  "con-video-portada": { layout: "poster", tickets: [TICKETS.general], coverVideo: true },
  "con-video-portada-ancha": { layout: "banner", tickets: [TICKETS.general], coverVideo: true },
  "con-video-portada-compacto": { layout: "compact", tickets: [TICKETS.general], coverVideo: true },
  "con-video-galeria": { layout: "poster", tickets: [TICKETS.general], galleryVideo: true },
  // Estados de la card de acción v2 (tests/e2e/event-action-card.spec.ts). saleState: eventData.sale_state
  gratis: { layout: "poster", tickets: [TICKETS.free] },
  "gratis-pocos-cupos": { layout: "poster", tickets: [TICKETS.freeFew] },
  "gratis-lleno": { layout: "poster", tickets: [], unavailable: [{ ...TICKETS.free, reason: "sold_out" }], saleState: "sold_out" },
  "pagado-ultimas": { layout: "poster", tickets: [TICKETS.generalLast] },
  "varias-funciones": { layout: "poster", ...TOUR },
  // Funciones v2 (tests/e2e/event-functions.spec.ts)
  "muchas-funciones": { layout: "poster", ...SEASON },
  "funciones-venta-por-abrir": { layout: "poster", ...TOUR_OPENING_LATER },
  "funciones-entrada-general": { layout: "poster", ...RUN_ANY_FUNCTION },
  "venta-por-abrir": { layout: "poster", tickets: [], unavailable: [{ ...TICKETS.general, reason: "upcoming" }], saleState: "upcoming", saleStartsInDays: 3 },
  agotado: { layout: "poster", tickets: [], unavailable: [{ ...TICKETS.general, reason: "sold_out" }], saleState: "sold_out" },
  "terminado-sin-resenas": { layout: "poster", tickets: [], ended: true },
  "venta-cerrada": { layout: "poster", tickets: [], saleState: "closed" },
  // Agenda por día (tests/e2e/event-agenda.spec.ts)
  "congreso-con-agenda": { layout: "poster", ...CONGRESS },
  // Datos extra al comprar (tests/e2e/checkout-extras.spec.ts): asistentes, empresa y preguntas; y una mesa para 4
  "datos-al-comprar": { layout: "poster", tickets: [TICKETS.general], checkoutFields: SEMINAR_FIELDS },
  "mesa-para-cuatro": { layout: "poster", tickets: [TICKETS.table], checkoutFields: { attendee_names: "optional" } },
  // Vista previa privada de un borrador (status draft + is_preview, como /eventos/vista-previa/…)
  "vista-previa": { layout: "poster", tickets: [TICKETS.general], preview: true },
};

/** Video como lo arma normalizeEventVideo (src/lib/eventVideo.ts), con el MP4 de public/videos. */
export const FIXTURE_VIDEO = {
  url: "/videos/aitickets-demo.mp4",
  poster_url: "/videos/aitickets-demo-poster.jpg",
  width: 1920,
  height: 1080,
  duration: null,
  mime: "video/mp4",
};

/** Reseñas como las arma loadPublicReviews (src/lib/eventReviews.ts). */
export const FIXTURE_REVIEWS = {
  summary: { count: 4, average: 4.5, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 3 } },
  reviews: [
    { id: "r1", name: "Ana R.", rating: 5, comment: "¡Increíble la energía del público!", created_at: "2026-10-18T12:00:00Z" },
    { id: "r2", name: "Beto S.", rating: 3, comment: "Buen show, pero la fila para entrar fue larga.", created_at: "2026-10-18T13:00:00Z" },
  ],
  comments_total: 2,
  photos: [
    { id: "p1", url: "/aitickets_preview.png", thumb_url: null, width: 1200, height: 630, name: "Ana R." },
    { id: "p2", url: "/aitickets_preview.png", thumb_url: null, width: 1200, height: 630, name: null },
  ],
};

const pad = (n) => String(n).padStart(2, "0");

/**
 * Evento publicado y a la venta con la forma de getPublicEventData(...).eventData. La función es en 30 días
 * (el evento nunca "termina"), salvo los escenarios `ended` (hace 2 días). `toPublicTicket` llega desde la página
 * (src/lib/eventPage.ts).
 */
export function fixtureEvent(name, { toPublicTicket, now = new Date() }) {
  const scenario = SCENARIOS[name];
  if (!scenario) return null;
  const day = new Date(now.getTime() + (scenario.ended ? -2 : 30) * 24 * 3600 * 1000);
  const date = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
  const venue = {
    name: "Teatro de Prueba",
    address: "Avenida Siempre Viva 742",
    city: "Santiago",
    region: null,
    postal_code: null,
    country: "CL",
    latitude: null,
    longitude: null,
    timezone: "America/Santiago",
    is_virtual: false,
  };
  const start = `${date}T20:00:00-03:00`;
  const end = `${date}T23:00:00-03:00`;
  const image = scenario.image !== false;
  // Funciones: una (la de siempre) o las del escenario, con id 9200, 9201…
  const dates = scenario.functions
    ? scenario.functions.map((f, i) => {
        const d = new Date(now.getTime() + f.days * 24 * 3600 * 1000);
        const ymd = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
        return {
          id: 9200 + i,
          date: ymd,
          start_time: "21:00:00",
          end_time: "23:00:00",
          timezone: "America/Santiago",
          start_iso: `${ymd}T21:00:00-03:00`,
          end_iso: `${ymd}T23:00:00-03:00`,
          venue: { ...venue, ...f.venue },
        };
      })
    : [{ id: 9200, date, start_time: "20:00:00", end_time: "23:00:00", timezone: "America/Santiago", start_iso: start, end_iso: end, venue }];
  const functionId = (t) => (t.fn === undefined ? null : dates[t.fn].id);
  return {
    id: 9100,
    name: "Concierto de prueba",
    slug: `e2e-${name}`,
    title: "Concierto de prueba",
    status: scenario.preview ? "draft" : "published",
    capacity: null,
    start_date: new Date(start).toISOString(),
    end_date: new Date(end).toISOString(),
    location: `${venue.name}, ${venue.address}, ${venue.city}`,
    image_url: image ? "/aitickets_preview.png" : null,
    // Larga a propósito: la barra inferior de mobile aparece recién al pasar el título y el lugar
    description: Array.from({ length: 8 }, (_, i) => `<p>Párrafo ${i + 1} de la descripción del concierto de prueba, con el detalle del programa, los artistas invitados y todo lo que hay que saber antes de llegar.</p>`).join(""),
    fee_absorbed: false,
    accessibility: "public",
    cover_settings: { desktop: { height: 480, position_y: 50, fit: "cover" }, mobile: { height: 270, position_y: 50, fit: "cover" } },
    organization_id: 1,
    timezone: "America/Santiago",
    tags: ["Música"],
    faqs: [
      { id: 1, question: "¿Pueden asistir niños?", answer: "Sí, es un evento familiar." },
      { id: 2, question: "¿Hay estacionamiento?", answer: "Hay estacionamientos públicos cerca del teatro." },
    ],
    gallery: [],
    cover_video: scenario.coverVideo ? FIXTURE_VIDEO : null,
    gallery_video: scenario.galleryVideo ? FIXTURE_VIDEO : null,
    dates,
    agenda: agendaGroups(
      (scenario.agenda || []).map((b, i) => ({ id: i + 1, function_id: functionId(b), start: b.start, end: b.end ?? null, title: b.title, speakers: b.speakers ?? null, room: b.room ?? null, position: i })),
      dates,
    ),
    tickets: scenario.tickets.map((t) => ({
      ...toPublicTicket({ ...t, init_date: null, end_date: null, event_date_id: functionId(t) }, { remaining: t.total_quantity ?? null, feeAbsorbed: false }),
      people_per_ticket: t.people || 1,
    })),
    checkout_fields: scenario.checkoutFields || null,
    unavailable_tickets: (scenario.unavailable || []).map((t) => ({
      id: t.id,
      ticket_name: t.ticket_name,
      price: t.price,
      event_date_id: functionId(t),
      reason: t.reason,
      sales_start: t.salesStartsInDays ? new Date(now.getTime() + t.salesStartsInDays * 24 * 3600 * 1000).toISOString() : null,
    })),
    theme: image ? { tint: "75 60% 94%", poster_width: 1200, poster_height: 630 } : null,
    sale_state: scenario.saleState || (scenario.tickets.length ? "on_sale" : "closed"),
    reviews: scenario.reviews ? FIXTURE_REVIEWS : null,
    sale_starts_at: scenario.saleStartsInDays ? new Date(now.getTime() + scenario.saleStartsInDays * 24 * 3600 * 1000).toISOString() : null,
    has_secret_location: false,
    organization: { name: "Productora de Prueba", website: null, instagram: null },
    venue,
    page_settings: { layout: scenario.layout, show_organizer: true, background: "none" },
    is_demo: false,
    is_preview: Boolean(scenario.preview),
  };
}

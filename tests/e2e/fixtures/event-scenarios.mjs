// Escenarios de la página pública del evento para los e2e sin BD (tests/e2e/event-quantity.spec.ts). Los sirve
// tests/e2e/fixtures/event-fixture-page.astro en FIXTURE_ROUTE/<escenario> (solo en `astro dev` con
// E2E_FIXTURES=1).
// Las entradas están como filas de event_tickets en la BD (max_quantity null = el productor no configuró un
// máximo por compra); la página las pasa por toPublicTicket (src/lib/eventPage.ts), igual que la página real.

export const FIXTURE_ROUTE = "/__e2e/eventos";

export const TICKETS = {
  general: { id: 9101, ticket_name: "General", price: 4000, max_quantity: null, total_quantity: null },
  vip: { id: 9102, ticket_name: "VIP", price: 9000, max_quantity: null, total_quantity: null },
  // El productor configuró un máximo de 3 por compra
  generalMax3: { id: 9103, ticket_name: "General", price: 4000, max_quantity: 3, total_quantity: null },
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
  return {
    id: 9100,
    name: "Concierto de prueba",
    slug: `e2e-${name}`,
    title: "Concierto de prueba",
    status: "published",
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
    dates: [{ id: 9200, date, start_time: "20:00:00", end_time: "23:00:00", timezone: "America/Santiago", start_iso: start, end_iso: end, venue }],
    tickets: scenario.tickets.map((t) =>
      toPublicTicket({ ...t, init_date: null, end_date: null, event_date_id: null }, { remaining: t.total_quantity ?? null, feeAbsorbed: false }),
    ),
    unavailable_tickets: [],
    theme: image ? { tint: "75 60% 94%", poster_width: 1200, poster_height: 630 } : null,
    sale_state: scenario.tickets.length ? "on_sale" : "closed",
    reviews: scenario.reviews ? FIXTURE_REVIEWS : null,
    sale_starts_at: null,
    has_secret_location: false,
    organization: { name: "Productora de Prueba", website: null, instagram: null },
    venue,
    page_settings: { layout: scenario.layout, show_organizer: true, background: "none" },
    is_demo: false,
    is_preview: false,
  };
}

/**
 * JSON-LD (schema.org/Event) de la página pública de un evento. Función pura: la usa EventMetaTags.astro y la prueba
 * tests/unit/event-jsonld.test.mjs.
 *
 * Campos que revisa Search Console (resultados enriquecidos de eventos), además de los obligatorios (name,
 * startDate, location):
 *   - offers[].validFrom: desde cuándo se vende la entrada (init_date de la tanda o, si no tiene, cuándo se creó).
 *   - organizer.url: la web de la productora, su sitio en AI Tickets o su Instagram (src/lib/eventPage.ts).
 *   - performer: los artistas del evento (events.performers) o, si no hay, los expositores de la agenda. Nunca se
 *     inventa: sin ninguno de los dos el campo no va.
 * Una entrada por función (cada una con su fecha y su recinto). No debe recibir secret_location.
 */
import { performerJsonLd, performersFromAgenda } from "./eventPerformers.mjs";

export interface EventJsonLdContext {
  /** Origen de AI Tickets sin barra final (https://aitickets.cl). */
  siteUrl: string;
  /** URL canónica de la página del evento. */
  canonicalUrl: string;
  /** Imágenes absolutas (portada en alta y tarjeta 1200×630). */
  images: string[];
  /** Descripción a usar si el evento no tiene. */
  fallbackDescription: string;
  /** Marca y correo de soporte (organizador por defecto si el evento no tiene organización). */
  brand: string;
  supportEmail: string;
}

const stripHtml = (html?: string | null) =>
  (html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Fecha ISO válida o null. */
const isoOrNull = (value: unknown): string | null => {
  if (!value) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function buildPlace(event: any, venue: any) {
  if (!venue) {
    return {
      "@type": "Place",
      name: event.location || "Por confirmar",
      address: { "@type": "PostalAddress", streetAddress: event.location || undefined, addressCountry: "CL" },
    };
  }
  const place: any = {
    "@type": "Place",
    name: venue.name || event.location,
    address: {
      "@type": "PostalAddress",
      streetAddress: venue.address || undefined,
      addressLocality: venue.city || undefined,
      addressRegion: venue.region || undefined,
      postalCode: venue.postal_code || undefined,
      addressCountry: venue.country || "CL",
    },
  };
  if (Number.isFinite(venue.latitude) && Number.isFinite(venue.longitude)) {
    place.geo = { "@type": "GeoCoordinates", latitude: venue.latitude, longitude: venue.longitude };
  }
  return place;
}

/** Ofertas: solo si hay entradas a la venta o el evento está agotado (nunca se inventa un precio). */
export function buildOffers(event: any, canonicalUrl: string) {
  const eventCreated = isoOrNull(event?.created_at);
  const tickets = Array.isArray(event?.tickets) ? event.tickets : [];
  if (tickets.length > 0) {
    return tickets.map((t: any) => {
      const validFrom = isoOrNull(t.init_date) || isoOrNull(t.valid_from) || eventCreated;
      return {
        "@type": "Offer",
        name: t.ticket_name || "Entrada general",
        price: Number(t.price) || 0,
        priceCurrency: "CLP",
        availability: t.remaining === 0 ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
        url: canonicalUrl,
        ...(validFrom ? { validFrom } : {}),
      };
    });
  }
  if (event?.sale_state === "sold_out") {
    return [
      {
        "@type": "Offer",
        url: canonicalUrl,
        priceCurrency: "CLP",
        availability: "https://schema.org/SoldOut",
        ...(eventCreated ? { validFrom: eventCreated } : {}),
      },
    ];
  }
  return null;
}

/** Organizador: la productora (con url y sameAs si los tiene) o AI Tickets. */
export function buildOrganizer(event: any, ctx: Pick<EventJsonLdContext, "siteUrl" | "brand" | "supportEmail">) {
  const org = event?.organization;
  if (org?.name) {
    const url = org.url || org.website || null;
    const sameAs = (Array.isArray(org.same_as) ? org.same_as : []).filter((u: unknown) => typeof u === "string" && u && u !== url);
    return {
      "@type": "Organization",
      name: org.name,
      ...(url ? { url } : {}),
      ...(sameAs.length ? { sameAs } : {}),
    };
  }
  return {
    "@type": "Organization",
    name: ctx.brand,
    url: ctx.siteUrl,
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: ctx.supportEmail, availableLanguage: ["es"] },
  };
}

/** Artistas del evento o, si no hay, expositores de la agenda ([] si ninguno). */
export function buildPerformers(event: any) {
  const own = performerJsonLd(event?.performers);
  return own.length ? own : performerJsonLd(performersFromAgenda(event?.agenda));
}

/** Objeto (una función) o lista (varias funciones) para <script type="application/ld+json">, o null. */
export function buildEventJsonLd(event: any, ctx: EventJsonLdContext): object | object[] | null {
  if (!event) return null;
  const organizer = buildOrganizer(event, ctx);
  const offers = buildOffers(event, ctx.canonicalUrl);
  const performer = buildPerformers(event);
  const description = (stripHtml(event.description) || ctx.fallbackDescription).slice(0, 5000);
  const rating = event.reviews?.summary;

  const functions = (Array.isArray(event.dates) ? event.dates : []).filter((d: any) => d.start_iso);
  const entries = (functions.length ? functions : [{ start_iso: null, end_iso: null, venue: event.venue }]).map((fn: any) => {
    const item: any = {
      "@context": "https://schema.org",
      "@type": "Event",
      name: event.name,
      description,
      url: ctx.canonicalUrl,
      image: ctx.images,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: fn.venue?.is_virtual ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
      location: buildPlace(event, fn.venue || event.venue),
      organizer,
    };
    if (fn.start_iso) item.startDate = fn.start_iso;
    else if (event.start_date) item.startDate = event.start_date;
    if (fn.end_iso) item.endDate = fn.end_iso;
    else if (event.end_date) item.endDate = event.end_date;
    if (performer.length) item.performer = performer.length === 1 ? performer[0] : performer;
    if (offers) item.offers = offers;
    // Calificación de quienes asistieron (evento terminado, src/lib/eventReviews.ts)
    if (rating?.count > 0 && rating.average) {
      item.aggregateRating = { "@type": "AggregateRating", ratingValue: rating.average, bestRating: 5, worstRating: 1, ratingCount: rating.count };
    }
    return item;
  });
  return entries.length === 1 ? entries[0] : entries;
}

/** JSON listo para insertar en el HTML (con "<" escapado: nunca cierra el <script>). */
export const serializeJsonLd = (data: object | object[] | null) => (data ? JSON.stringify(data).replace(/</g, "\\u003c") : null);

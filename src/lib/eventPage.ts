// Datos de la página pública de un evento. Lo usan /eventos/[slug] y /o/[site]/eventos/[slug].
// Contratos: C2 (entradas a la venta y stock), C4 (NUNCA seleccionar secret_location), R1 (funciones),
// R3 (descripción sanitizada).
import { getSupabaseAdmin } from "./auth-helpers";
import {
  DEFAULT_EVENT_TIMEZONE,
  resolveTimeZone,
  zonedDateTimeToDate,
  toZonedISOString,
  getZonedParts,
  formatLocalDate,
} from "../utils/dateHelpers.js";
import { descriptionToHtml } from "./sanitize";
import { isDemoEventSlug, getDemoFunctionDate } from "./demoEvent.mjs";
import { normalizeCoverSettings } from "./eventCover";
import { loadEventGallery, type GalleryImage } from "./eventGallery";
import { resolveCoverMeta, eventThemeFrom } from "./eventCoverMeta";
import { normalizePageSettings, stripDemoSuffix } from "./eventPageSettings";
import { computeFeeSplit } from "../../netlify/lib/fees.mjs";
import { maxPerPurchase } from "../../netlify/lib/tickets.mjs";
import { clientIpFrom } from "./sites";

// Columnas públicas del evento. NUNCA incluir secret_location (C4).
export const EVENT_PUBLIC_COLUMNS =
  "id, slug, name, title, description, image_url, location, capacity, status, accessibility, start_date, end_date, organization_id";

const BOT_PATTERNS = /bot|crawl|spider|slurp|bingpreview|mediapartners|facebookexternalhit|bytespider|gptbot|lighthouse|headless/i;

const DATE_COLUMNS = `
  id, date, start_time, end_time, event_location_id,
  event_locations (
    id, name, display_name, is_virtual,
    address_line1_override, address_line2_override, city_override, state_province_override,
    postal_code_override, country_code_override, latitude_override, longitude_override,
    venues ( id, name, address_line1, address_line2, city, state_province, postal_code, country_code, latitude, longitude, timezone )
  )
`;

const PENDING_HOLD_MINUTES = 15;
const THREE_HOURS = 3 * 60 * 60 * 1000;

export interface PublicEventOptions {
  /** Si se indica, el evento debe pertenecer a esta organización (sitios de productor). */
  organizationId?: number;
  /** Origen del sitio del productor (p. ej. https://entradas.productora.cl); solo informativo (seo.pageUrl). */
  siteOrigin?: string;
  /** Contexto de Netlify (waitUntil) para guardar cover_meta sin bloquear. Las visitas las registra /api/events/visit. */
  locals?: any;
  /**
   * Vista previa privada (link con token o dueño con sesión): carga el evento por id aunque NO esté
   * publicado y siempre es noindex. `slug` se ignora.
   */
  previewEventId?: number;
}

export interface PublicEventSeo {
  title: string;
  description: string;
  /** Siempre /eventos/<slug> en aitickets.cl (canónico único aunque se vea en un sitio de productor). */
  canonicalPath: string;
  noindex: boolean;
  /** URL donde se está viendo (sitio del productor) o la canónica. */
  pageUrl: string;
}

export interface PublicEventResult {
  eventData: any;
  seo: PublicEventSeo;
  org: { id: number; name: string; website: string | null; instagram: string | null } | null;
}

/**
 * Registra una visita a la página pública (event_visits). La llama /api/events/visit desde el navegador:
 * la página se sirve desde el CDN (src/lib/cdnCache.ts) y el servidor no ve cada visita. Solo se guarda el
 * hash de la IP. `referrer` y `utm` son los de la página (document.referrer y su query string).
 */
export async function recordEventVisit(
  eventId: number,
  request: Request,
  page: { referrer?: string | null; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null },
  locals?: any
) {
  const supabase = getSupabaseAdmin();
  const ua = request.headers.get("user-agent") || "";
  if (BOT_PATTERNS.test(ua)) return;
  const ip = clientIpFrom(request);
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const ipHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Geo de Netlify: context.geo (adapter). Fallback: header x-nf-geo (JSON en base64) / x-country.
  let geo: any = locals?.netlify?.context?.geo || null;
  if (!geo) {
    const geoHeader = request.headers.get("x-nf-geo");
    if (geoHeader) {
      try {
        geo = JSON.parse(atob(geoHeader));
      } catch {
        try {
          geo = JSON.parse(geoHeader);
        } catch {
          geo = null;
        }
      }
    }
  }
  const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const country = clip(geo?.country?.code, 8) || clip(request.headers.get("x-country"), 8);
  const city = clip(geo?.city, 128);

  const { error: visitError } = await supabase.from("event_visits").insert({
    event_id: eventId,
    ip_hash: ipHash,
    user_agent: ua.substring(0, 512),
    referrer: clip(page.referrer, 1024),
    country,
    city,
    utm_source: clip(page.utmSource, 256),
    utm_medium: clip(page.utmMedium, 256),
    utm_campaign: clip(page.utmCampaign, 256),
  });
  if (visitError) console.error("Error tracking visit:", visitError);
}

/**
 * Vendidas y pendientes por entrada. Usa la RPC aitickets_ticket_availability (WP2, fuente única que
 * respeta hold_expires_at); si no existe aún (preview sin migrar) cae al conteo anterior: asistentes
 * no cancelados + órdenes pending/processing de los últimos 15 minutos.
 */
async function loadAvailability(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventId: number,
  tickets: any[],
  now: Date,
  // RPC ya lanzada (en paralelo con el resto de las consultas de la página): evita un viaje más a la BD
  rpcRequest: PromiseLike<{ data: any; error: any }> = supabase.rpc("aitickets_ticket_availability", { p_event_id: eventId })
): Promise<{ sold: Map<string, number>; pending: Map<string, number> }> {
  const sold = new Map<string, number>();
  const pending = new Map<string, number>();

  const { data: rpcRows, error: rpcError } = await rpcRequest;
  if (!rpcError && Array.isArray(rpcRows)) {
    for (const row of rpcRows as any[]) {
      if (row?.ticket_id === null || row?.ticket_id === undefined) continue;
      sold.set(String(row.ticket_id), Number(row.sold) || 0);
      pending.set(String(row.ticket_id), Number(row.pending) || 0);
    }
    return { sold, pending };
  }
  if (rpcError && rpcError.code !== "PGRST202" && rpcError.code !== "42883") {
    console.error("Error en aitickets_ticket_availability (se usa el conteo anterior):", rpcError);
  }

  const { data: pendingOrders } = await supabase
    .from("event_orders")
    .select("ticket_details")
    .eq("event_id", eventId)
    .in("status", ["pending", "processing"])
    .gte("created_at", new Date(now.getTime() - PENDING_HOLD_MINUTES * 60 * 1000).toISOString());
  for (const order of pendingOrders || []) {
    const details = Array.isArray(order.ticket_details) ? order.ticket_details : [];
    for (const t of details) {
      if (!t?.id) continue;
      const key = String(t.id);
      pending.set(key, (pending.get(key) || 0) + (Number(t.quantity) || 0));
    }
  }

  await Promise.all(
    tickets.map(async (t: any) => {
      if (t.total_quantity === null || t.total_quantity === undefined) return;
      const { count, error: countError } = await supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_ticket_id", t.id)
        .or("status.is.null,status.neq.cancelled");
      if (countError) console.error("Error contando entradas vendidas:", countError);
      sold.set(String(t.id), count || 0);
    })
  );
  return { sold, pending };
}

const pickOne = (v: any) => (Array.isArray(v) ? v[0] : v) || null;

const buildVenue = (loc: any) => {
  if (!loc) return null;
  const venue = pickOne(loc.venues);
  // event_locations.name = 'Main' es un nombre interno que pone el dashboard: mostrar el del recinto
  const internalName = loc.name && loc.name !== "Main" ? loc.name : null;
  const name = loc.display_name || venue?.name || internalName || null;
  const address = [loc.address_line1_override || venue?.address_line1, loc.address_line2_override || venue?.address_line2]
    .filter(Boolean)
    .join(", ");
  const lat = loc.latitude_override ?? venue?.latitude;
  const lng = loc.longitude_override ?? venue?.longitude;
  return {
    name,
    address: address || null,
    city: loc.city_override || venue?.city || null,
    region: loc.state_province_override || venue?.state_province || null,
    postal_code: loc.postal_code_override || venue?.postal_code || null,
    country: (loc.country_code_override || venue?.country_code || "CL").trim().toUpperCase(),
    latitude: lat !== null && lat !== undefined ? Number(lat) : null,
    longitude: lng !== null && lng !== undefined ? Number(lng) : null,
    timezone: resolveTimeZone(venue?.timezone),
    is_virtual: !!loc.is_virtual,
  };
};

export const stripHtml = (html: string) =>
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

export const truncate = (text: string, max: number) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
};

/** Filas crudas de la página de un evento, con las mismas formas que devuelve PostgREST. */
interface EventPageRows {
  event: any;
  categories: any[];
  tickets: any[];
  faqs: any[];
  dates: any[];
  org: any;
  hasSecretLocation: boolean;
  gallery: GalleryImage[];
  /** Respuesta de aitickets_ticket_availability (loadAvailability cae al conteo anterior si trae error). */
  availability: { data: any; error: any };
}

const isMissingFunction = (error: any) => error?.code === "PGRST202" || error?.code === "42883";

/**
 * Todo lo de la página en UNA llamada (aitickets_public_event_page, migración 202610160100): las funciones
 * de Netlify corren lejos de Supabase y cada viaje cuesta ~150–250 ms. Si la función aún no existe (deploy
 * preview sin migrar) o falla, se usan las consultas por separado (loadEventPageRowsByQueries).
 */
async function loadEventPageRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  slug: string | undefined,
  opts: PublicEventOptions
): Promise<EventPageRows | null> {
  const isPreview = opts.previewEventId !== undefined;
  const { data, error } = await supabase.rpc(
    "aitickets_public_event_page",
    isPreview ? { p_event_id: Number(opts.previewEventId) } : { p_slug: slug }
  );
  if (!error) {
    if (!data?.event) return null;
    return {
      event: data.event,
      categories: data.categories || [],
      tickets: data.tickets || [],
      faqs: data.faqs || [],
      dates: data.dates || [],
      org: data.org || null,
      hasSecretLocation: data.has_secret_location === true,
      gallery: data.gallery || [],
      availability: { data: data.availability || [], error: null },
    };
  }
  if (!isMissingFunction(error)) console.error("Error en aitickets_public_event_page (se usan las consultas por separado):", error);
  return loadEventPageRowsByQueries(supabase, slug, opts);
}

async function loadEventPageRowsByQueries(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  slug: string | undefined,
  opts: PublicEventOptions
): Promise<EventPageRows | null> {
  const isPreview = opts.previewEventId !== undefined;
  const loadEvent = (columns: string) => {
    const baseQuery = supabase.from("events").select(columns);
    return (isPreview
      ? baseQuery.eq("id", Number(opts.previewEventId))
      : baseQuery.eq("slug", slug!).eq("status", "published")
    ).maybeSingle();
  };
  let { data: event, error }: { data: any; error: any } = await loadEvent(`${EVENT_PUBLIC_COLUMNS}, cover_settings, fee_absorbed, cover_meta, page_settings`);
  // Deploy previews comparten la BD de producción: tolerar que las migraciones de page_settings/cover_meta/cover_settings/fee_absorbed no estén aplicadas
  if (error?.code === "42703") ({ data: event, error } = await loadEvent(`${EVENT_PUBLIC_COLUMNS}, cover_settings, fee_absorbed, cover_meta`));
  if (error?.code === "42703") ({ data: event, error } = await loadEvent(`${EVENT_PUBLIC_COLUMNS}, cover_settings, fee_absorbed`));
  if (error?.code === "42703") ({ data: event, error } = await loadEvent(`${EVENT_PUBLIC_COLUMNS}, cover_settings`));
  if (error?.code === "42703") ({ data: event, error } = await loadEvent(EVENT_PUBLIC_COLUMNS));

  if (error) {
    console.error("Error al obtener el evento:", error);
  }
  if (!event) return null;
  // Sitio de otra organización: no hace falta cargar el resto
  if (opts.organizationId !== undefined && Number(event.organization_id) !== Number(opts.organizationId)) return null;

  // Datos relacionados (en paralelo)
  const [categoriesRes, ticketsRes, faqsRes, datesRes, orgRes, secretRes, gallery, availability] = await Promise.all([
    supabase.from("event_tags").select("category_tags(name)").eq("event_id", event.id),
    supabase
      .from("event_tickets")
      .select("id, ticket_name, price, max_quantity, total_quantity, status, is_gift, init_date, end_date, event_date_id")
      .eq("event_id", event.id)
      .eq("is_gift", false)
      .eq("status", "available")
      .order("price", { ascending: true }),
    supabase.from("event_faqs").select("id, question, answer").eq("event_id", event.id).order("id", { ascending: true }),
    supabase
      .from("event_dates")
      .select(DATE_COLUMNS)
      .eq("event_id", event.id)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true }),
    event.organization_id
      ? supabase.from("organizations").select("public_name, website, instagram").eq("id", event.organization_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Solo saber SI existe dirección secreta, sin leer su valor (C4)
    supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("id", event.id)
      .not("secret_location", "is", null)
      .neq("secret_location", ""),
    // Galería al final de la página (tolera que la tabla aún no exista)
    loadEventGallery(Number(event.id)),
    // Vendidas/pendientes (loadAvailability): no depende de las entradas, va en el mismo viaje
    supabase.rpc("aitickets_ticket_availability", { p_event_id: event.id }),
  ]);

  if (categoriesRes.error) console.error("Error al obtener las categorías:", categoriesRes.error);
  if (faqsRes.error) console.error("Error al obtener las faqs:", faqsRes.error);
  if (ticketsRes.error) console.error("Error al obtener las entradas:", ticketsRes.error);
  if (datesRes.error) console.error("Error al obtener las fechas:", datesRes.error);

  return {
    event,
    categories: categoriesRes.data || [],
    tickets: ticketsRes.data || [],
    faqs: faqsRes.data || [],
    dates: datesRes.data || [],
    org: orgRes.data,
    hasSecretLocation: (secretRes.count ?? 0) > 0,
    gallery,
    availability,
  };
}

/**
 * Entrada (fila de event_tickets) tal como la recibe la página pública. `remaining`: stock que queda (null =
 * ilimitado). max_quantity pasa a ser el máximo de ESTA compra: el configurado o, sin configurar, 10 (misma
 * regla que /api/purchase-ticket), y nunca más que el stock. La usan también los e2e (tests/e2e/fixtures).
 */
export function toPublicTicket(t: any, { remaining, feeAbsorbed }: { remaining: number | null; feeAbsorbed: boolean }) {
  const perPurchase = maxPerPurchase(t);
  return {
    id: t.id,
    ticket_name: t.ticket_name,
    price: Number(t.price) || 0,
    // Precio final por entrada (con cargo e IVA del cargo, o el de lista si el productor lo absorbe): misma
    // regla que el resumen del checkout y /api/purchase-ticket (netlify/lib/fees.mjs)
    final_price: computeFeeSplit(Number(t.price) || 0, { absorbed: feeAbsorbed }).total,
    max_quantity: remaining === null ? perPurchase : Math.min(perPurchase, remaining),
    init_date: t.init_date,
    end_date: t.end_date,
    // R1: null = válida para cualquier función; si no, id de event.dates[]
    event_date_id: t.event_date_id ?? null,
    remaining,
    // Para "Quedan N cupos" (≤ 15 % del total o ≤ 10)
    total_quantity: t.total_quantity === null || t.total_quantity === undefined ? null : Number(t.total_quantity),
  };
}

/**
 * Carga un evento publicado con todo lo necesario para su página pública.
 * Devuelve null si no existe, no está publicado o (con organizationId) pertenece a otra organización.
 */
export async function getPublicEventData(slug: string | undefined, opts: PublicEventOptions = {}): Promise<PublicEventResult | null> {
  const isPreview = opts.previewEventId !== undefined;
  if (!slug && !isPreview) return null;
  const supabase = getSupabaseAdmin();
  const now = new Date();

  const raw = await loadEventPageRows(supabase, slug, opts);
  // Borradores, eventos inexistentes o slugs inválidos => 404
  if (!raw) return null;
  const { event } = raw;
  if (opts.organizationId !== undefined && Number(event.organization_id) !== Number(opts.organizationId)) return null;

  const isPrivate = !!event.accessibility && event.accessibility !== "public";
  // Evento demo: fecha dinámica (src/lib/demoEvent.mjs), sin indexar y sin venta real
  const isDemo = isDemoEventSlug(event.slug);
  if (isDemo) {
    event.start_date = null;
    event.end_date = null;
    // El banner de la página ya dice que es demo (y la migración 202610150100 lo quita de la BD)
    event.name = stripDemoSuffix(event.name);
    event.title = stripDemoSuffix(event.title);
  }

  // Categorías
  const tags: string[] = raw.categories
    .map((c: any) => (Array.isArray(c.category_tags) ? c.category_tags[0]?.name : c.category_tags?.name))
    .filter(Boolean);

  const faqs = raw.faqs;
  const gallery = raw.gallery;

  // Organización
  const orgRow: any = raw.org;
  const organization = orgRow ? { name: orgRow.public_name, website: orgRow.website, instagram: orgRow.instagram } : null;

  const hasSecretLocation = raw.hasSecretLocation;

  // Entradas (C2): a la venta = available, no regalo, dentro de la ventana (NULL = abierta)
  const allTickets: any[] = raw.tickets;

  const feeAbsorbed = event.fee_absorbed === true;
  const inWindow = (t: any) => (!t.init_date || new Date(t.init_date) <= now) && (!t.end_date || new Date(t.end_date) >= now);
  const windowTickets = allTickets.filter(inWindow);

  const { sold, pending } = await loadAvailability(supabase, event.id, windowTickets, now, Promise.resolve(raw.availability));

  const ticketsWithStock = windowTickets.map((t: any) => {
    const unlimited = t.total_quantity === null || t.total_quantity === undefined;
    const remaining = unlimited
      ? null
      : Math.max(0, Number(t.total_quantity) - (sold.get(String(t.id)) || 0) - (pending.get(String(t.id)) || 0));
    return toPublicTicket(t, { remaining, feeAbsorbed });
  });

  const onSaleTickets = ticketsWithStock.filter((t) => t.remaining === null || t.remaining > 0);
  const upcomingSaleDates = allTickets
    .filter((t: any) => t.init_date && new Date(t.init_date) > now && (!t.end_date || new Date(t.end_date) >= now))
    .map((t: any) => t.init_date)
    .sort();

  // Estado de venta para la UI y el JSON-LD
  let saleState: "on_sale" | "sold_out" | "upcoming" | "closed" = "closed";
  if (onSaleTickets.length > 0) saleState = "on_sale";
  else if (ticketsWithStock.length > 0) saleState = "sold_out";
  else if (upcomingSaleDates.length > 0) saleState = "upcoming";

  // Funciones (event_dates + recinto), con horas en la zona horaria del recinto
  let dates: any[] = raw.dates
    .map((d: any) => (isDemo ? { ...d, date: getDemoFunctionDate(d.date, now, event.slug) } : d))
    .map((d: any) => {
      const venue = buildVenue(pickOne(d.event_locations));
      const tz = venue?.timezone || DEFAULT_EVENT_TIMEZONE;
      const start = zonedDateTimeToDate(d.date, d.start_time, tz);
      let end = d.end_time ? zonedDateTimeToDate(d.date, d.end_time, tz) : null;
      if (start && end && end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000); // termina después de medianoche
      if (start && !end) end = new Date(start.getTime() + THREE_HOURS);
      return {
        id: d.id,
        date: String(d.date).slice(0, 10),
        start_time: d.start_time,
        end_time: d.end_time,
        timezone: tz,
        start_iso: start ? toZonedISOString(start, tz) : null,
        end_iso: end ? toZonedISOString(end, tz) : null,
        venue,
      };
    });

  if (dates.length === 0 && event.start_date) {
    // Fallback: eventos antiguos sin event_dates
    const startParts = getZonedParts(event.start_date);
    const endParts = event.end_date ? getZonedParts(event.end_date) : null;
    if (startParts) {
      const endInstant = event.end_date ? new Date(event.end_date) : new Date(new Date(event.start_date).getTime() + THREE_HOURS);
      dates = [
        {
          id: null,
          date: startParts.date,
          start_time: startParts.time,
          end_time: endParts?.time || null,
          timezone: DEFAULT_EVENT_TIMEZONE,
          start_iso: toZonedISOString(event.start_date),
          end_iso: toZonedISOString(endInstant),
          venue: null,
        },
      ];
    }
  }

  // Denormalizar start/end si faltan (eventos autoservicio antiguos)
  const firstIso = dates.find((d) => d.start_iso)?.start_iso;
  const lastIso = [...dates].reverse().find((d) => d.end_iso)?.end_iso;
  const startDate = event.start_date || (firstIso ? new Date(firstIso).toISOString() : null);
  const endDate = event.end_date || (lastIso ? new Date(lastIso).toISOString() : null);
  const primaryVenue = dates.find((d) => d.venue)?.venue || null;
  const eventTimezone = primaryVenue?.timezone || DEFAULT_EVENT_TIMEZONE;

  const location =
    event.location || (primaryVenue ? [primaryVenue.name, primaryVenue.address, primaryVenue.city].filter(Boolean).join(", ") : "");

  // Tickets asignados a una función que ya no existe (o ya pasó y fue borrada) => tratarlos como "cualquier función"
  // y ocultar las entradas de una función que ya terminó.
  const dateEndById = new Map(dates.filter((d) => d.id !== null && d.id !== undefined).map((d) => [String(d.id), d.end_iso]));
  const publicTickets = onSaleTickets
    .map((t) => (t.event_date_id !== null && !dateEndById.has(String(t.event_date_id)) ? { ...t, event_date_id: null } : t))
    .filter((t) => {
      if (t.event_date_id === null) return true;
      const endIso = dateEndById.get(String(t.event_date_id));
      return !endIso || new Date(endIso) >= now;
    });
  if (saleState === "on_sale" && publicTickets.length === 0) saleState = "closed";

  // Entradas que se muestran atenuadas en el checkout: agotadas o con venta que aún no abre (§6.3)
  const liveFunction = (dateId: any) => dateId === null || dateId === undefined || !dateEndById.has(String(dateId)) || new Date(dateEndById.get(String(dateId))!) >= now;
  const unavailableTickets = [
    ...ticketsWithStock
      .filter((t) => t.remaining !== null && t.remaining <= 0)
      .map((t) => ({ id: t.id, ticket_name: t.ticket_name, price: t.price, final_price: t.final_price, event_date_id: t.event_date_id, reason: "sold_out", sales_start: null })),
    ...allTickets
      .filter((t: any) => t.init_date && new Date(t.init_date) > now && (!t.end_date || new Date(t.end_date) >= now))
      .map((t: any) => ({
        id: t.id,
        ticket_name: t.ticket_name,
        price: Number(t.price) || 0,
        final_price: computeFeeSplit(Number(t.price) || 0, { absorbed: feeAbsorbed }).total,
        event_date_id: t.event_date_id ?? null,
        reason: "upcoming",
        sales_start: t.init_date,
      })),
  ].filter((t) => liveFunction(t.event_date_id));

  // Póster: proporción real y tinte de la página (events.cover_meta, src/lib/eventCoverMeta.ts)
  const coverMeta = await resolveCoverMeta(event, {
        waitUntil: (() => {
          const ctx = opts.locals?.netlify?.context;
          return typeof ctx?.waitUntil === "function" ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;
        })(),
  });

  const { cover_meta: _coverMeta, page_settings: rawPageSettings, ...eventRow } = event;
  const eventData = {
    ...eventRow,
    // R3: la descripción se renderiza con v-html => siempre sanitizada
    description: descriptionToHtml(event.description),
    location,
    start_date: startDate,
    end_date: endDate,
    timezone: eventTimezone,
    tags,
    faqs,
    gallery,
    dates,
    tickets: publicTickets,
    unavailable_tickets: unavailableTickets,
    theme: eventThemeFrom(coverMeta),
    sale_state: saleState,
    sale_starts_at: upcomingSaleDates[0] || null,
    has_secret_location: hasSecretLocation,
    organization,
    venue: primaryVenue,
    cover_settings: normalizeCoverSettings(event.cover_settings),
    // Diseño de la página y si se muestra el organizador (src/lib/eventPageSettings.ts)
    page_settings: normalizePageSettings(rawPageSettings),
    // El productor absorbe el cargo por servicio: el precio de la entrada es el total (src/components/Reservation/pricing.js)
    fee_absorbed: event.fee_absorbed === true,
    is_demo: isDemo,
    // Vista previa privada: la página muestra el aviso y no permite comprar si no está publicado
    is_preview: isPreview,
  };

  // SEO
  const city = primaryVenue?.city || (event.location ? String(event.location).split(",").pop()?.trim() : "") || "";
  const firstDate = dates[0];
  const dateLabel = firstDate
    ? formatLocalDate(firstDate.date, { weekday: "short", day: "numeric", month: "long" }) +
      (dates.length > 1 ? ` (+${dates.length - 1} funciones)` : "")
    : "";
  const minPrice = publicTickets.length ? Math.min(...publicTickets.map((t) => t.price)) : null;
  const priceLabel = minPrice === null ? "" : minPrice === 0 ? "Entrada liberada" : `Entradas desde $${minPrice.toLocaleString("es-CL")}`;

  let metaDescription = `${event.name}${dateLabel ? ` – ${dateLabel}` : ""}${city ? ` en ${city}` : ""}.`;
  if (priceLabel) metaDescription += ` ${priceLabel}.`;
  const plainDescription = stripHtml(event.description || "");
  if (metaDescription.length < 140 && plainDescription) {
    metaDescription += ` ${plainDescription}`;
  }
  metaDescription = truncate(metaDescription, 158);

  const canonicalPath = `/eventos/${event.slug}`;
  const pageTitle = truncate(`${event.name}${city ? ` en ${city}` : ""} – Entradas | AI Tickets`, 70);
  const mainUrl = (import.meta.env.SITE_URL || "https://aitickets.cl").replace(/\/$/, "");

  return {
    eventData,
    seo: {
      title: pageTitle,
      description: metaDescription,
      canonicalPath,
      noindex: isPrivate || isDemo || isPreview,
      pageUrl: opts.siteOrigin ? `${opts.siteOrigin.replace(/\/$/, "")}/eventos/${event.slug}` : `${mainUrl}${canonicalPath}`,
    },
    org: event.organization_id && organization ? { id: Number(event.organization_id), ...organization } : null,
  };
}

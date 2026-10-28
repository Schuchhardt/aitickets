// Datos del evento para las páginas del asistente (/order/<id> y /ticket/<id>): funciones con su lugar, dirección,
// FAQ, productora y links de calendario/mapa. La dirección secreta NO se carga aquí: cada página decide si la
// muestra (solo con una entrada vigente de una orden pagada) con secretLocationFor. Mientras el evento tenga dirección
// privada, el lugar de cada función va sin la calle (nombre y comuna).
import type { SupabaseClient } from "@supabase/supabase-js";
import { descriptionToHtml } from "./sanitize";
import { formatFunctionDate, formatLocalTimeFromString, formatLocalDate, formatLocalTime, zonedDateTimeToDate } from "../utils/dateHelpers.js";
import { firstRelevantStart, hasSecretLocation, isRevealed, loadSecretLocation, pendingRevealText, publicPlace, revealAt } from "../../netlify/lib/secret-location.mjs";

export type AttendeeFunction = { id: number | null; date: string; start_time: string | null; end_time: string | null; place: string; label: string; startIso: string | null; endIso: string | null };

const EVENT_COLUMNS = "id, name, slug, description, image_url, location, start_date, end_date, organization_id";
const DATE_COLUMNS = "id, date, start_time, end_time, event_location_id, event_locations ( name, display_name, address_line1_override, city_override, venues ( name, address_line1, city ) )";

/** "Teatro Municipal, Av. Pedro Montt 1234, Valparaíso" (sin repetir partes). */
export function formatPlace(loc: any): string {
  if (!loc) return "";
  const venue = loc.venues || {};
  return [loc.display_name || venue.name || (loc.name && loc.name !== "Main" ? loc.name : null), loc.address_line1_override || venue.address_line1, loc.city_override || venue.city]
    .filter(Boolean)
    .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i)
    .join(", ");
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function toFunction(d: any, fallbackPlace: string, secret = false): AttendeeFunction {
  const start = formatLocalTimeFromString(d.start_time);
  const startDate = d.start_time ? zonedDateTimeToDate(String(d.date).slice(0, 10), d.start_time) : null;
  let endDate = d.end_time ? zonedDateTimeToDate(String(d.date).slice(0, 10), d.end_time) : null;
  if (startDate && endDate && endDate <= startDate) endDate = new Date(endDate.getTime() + 24 * 3600 * 1000);
  return {
    id: d.id ?? null,
    date: String(d.date).slice(0, 10),
    start_time: d.start_time || null,
    end_time: d.end_time || null,
    place: (secret ? publicPlace(d.event_locations) : formatPlace(d.event_locations)) || fallbackPlace,
    label: capitalize(`${formatFunctionDate(d, { weekday: "long", day: "numeric", month: "long" })}${start ? ` · ${start} hrs` : ""}`),
    startIso: startDate ? startDate.toISOString() : null,
    endIso: endDate ? endDate.toISOString() : null,
  };
}

/** Evento + funciones + FAQ + nombre de la productora. null si no existe. */
export async function loadAttendeeEvent(supabase: SupabaseClient, eventId: number | string) {
  const { data: event } = await supabase.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (!event) return null;
  const [{ data: dates }, { data: faqs }, { data: org }, secret] = await Promise.all([
    supabase.from("event_dates").select(DATE_COLUMNS).eq("event_id", event.id).order("date", { ascending: true }).order("start_time", { ascending: true }),
    supabase.from("event_faqs").select("question, answer").eq("event_id", event.id),
    event.organization_id
      ? supabase.from("organizations").select("public_name").eq("id", event.organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
    hasSecretLocation(supabase, event.id),
  ]);
  const fallbackPlace = event.location || "";
  let functions: AttendeeFunction[] = (dates || []).map((d: any) => toFunction(d, fallbackPlace, secret));
  if (!functions.length && event.start_date) {
    // Eventos antiguos sin funciones: start_date/end_date en hora de Chile
    functions = [
      {
        id: null,
        date: "",
        start_time: null,
        end_time: null,
        place: fallbackPlace,
        label: capitalize(`${formatLocalDate(event.start_date, { weekday: "long", day: "numeric", month: "long" })} · ${formatLocalTime(event.start_date)} hrs`),
        startIso: new Date(event.start_date).toISOString(),
        endIso: event.end_date ? new Date(event.end_date).toISOString() : null,
      },
    ];
  }
  return {
    ...event,
    descriptionHtml: descriptionToHtml(event.description),
    functions,
    faqs: (faqs || []).filter((f: any) => f?.question && f?.answer),
    organizerName: String((org as any)?.public_name || "").trim(),
  };
}

export type AttendeeEvent = NonNullable<Awaited<ReturnType<typeof loadAttendeeEvent>>>;

/**
 * Dirección privada para quien tiene una entrada vigente de una orden pagada (el llamador lo verifica). `address` si
 * ya se reveló; si no, `pending` con cuándo le llega. Ambos vacíos si el evento no tiene dirección privada.
 */
export async function secretLocationFor(
    supabase: SupabaseClient,
    event: { id: number | string; functions: AttendeeFunction[] },
    functionIds: Array<number | null>,
    now = new Date(),
): Promise<{ address: string; pending: string }> {
  const secret = await loadSecretLocation(supabase, Number(event.id));
  if (!secret.address) return { address: "", pending: "" };
  const start = firstRelevantStart(event.functions.filter((f) => f.date), functionIds);
  if (isRevealed({ revealHours: secret.revealHours, start, now })) return { address: secret.address, pending: "" };
  return { address: "", pending: pendingRevealText(secret.revealHours, revealAt(start, secret.revealHours)) };
}

/** Funciones de las entradas: las de su función específica (R1) o, si alguna sirve para todas, las del evento. */
export function functionsForTickets(event: AttendeeEvent, functionIds: Array<number | string | null | undefined>): AttendeeFunction[] {
  const ids = functionIds.filter((id) => id != null).map(String);
  const specific = ids.length === functionIds.length && ids.length > 0 ? event.functions.filter((f) => f.id != null && ids.includes(String(f.id))) : [];
  return specific.length ? specific : event.functions;
}

/** Próximas primero (las pasadas al final), para mostrar la que viene. */
export function upcomingFirst(functions: AttendeeFunction[], now = Date.now()): AttendeeFunction[] {
  const ends = (f: AttendeeFunction) => new Date(f.endIso || f.startIso || 0).getTime() + (f.endIso ? 0 : 3 * 3600 * 1000);
  const next = functions.filter((f) => !f.startIso || ends(f) >= now);
  const past = functions.filter((f) => f.startIso && ends(f) < now);
  return [...next, ...past];
}

const calDate = (iso: string) => iso.replace(/[-:]/g, "").split(".")[0] + "Z";

/** Link de Google Calendar para una función. null sin fecha. */
export function calendarUrl(eventName: string, fn: AttendeeFunction | undefined, place: string, detailsUrl: string): string | null {
  if (!fn?.startIso) return null;
  const end = fn.endIso || new Date(new Date(fn.startIso).getTime() + 3 * 3600 * 1000).toISOString();
  const params = new URLSearchParams({ action: "TEMPLATE", text: eventName || "Evento", dates: `${calDate(fn.startIso)}/${calDate(end)}`, details: detailsUrl, location: place || "" });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** Link de Google Maps para una dirección. null si no hay. */
export const mapsUrl = (place: string) => (place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}` : null);

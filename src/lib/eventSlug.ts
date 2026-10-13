// Cambio del slug (URL pública /eventos/<slug>) de un evento y redirects de slugs anteriores.
//
// Si el evento está publicado o ya tiene registrados (órdenes pagadas, entradas emitidas o invitados), sus
// links ya circulan (correos, WhatsApp, redes, QR impresos): el slug anterior se guarda en
// aitickets_event_slug_redirects y las páginas públicas responden 301 al slug vigente
// (resolveEventSlugRedirect). En un borrador sin registrados el slug anterior simplemente se libera.
//
// La tabla guarda event_id (no el slug destino): una cadena a -> b -> c redirige siempre al slug actual.
// Deploy previews comparten la BD de producción: si la tabla aún no existe, el lookup devuelve null y el
// cambio que necesita redirect se rechaza (nunca se rompen links ya compartidos).
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./auth-helpers";
import { isDemoEventSlug } from "./demoEvent.mjs";

export const SLUG_REDIRECTS_TABLE = "aitickets_event_slug_redirects";
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 120;

/** Prefijos/rutas que chocarían con páginas propias bajo /eventos. */
const RESERVED_SLUGS = new Set(["vista-previa", "index"]);

export class EventSlugError extends Error {
    constructor(public code: "invalid_input" | "conflict", message: string) {
        super(message);
    }
}

/** Normaliza texto libre a slug: minúsculas, sin tildes, solo [a-z0-9-]. */
export function normalizeSlug(input: string): string {
    return String(input || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, SLUG_MAX)
        .replace(/-+$/g, "");
}

export function validateSlug(slug: string): void {
    if (slug.length < SLUG_MIN) throw new EventSlugError("invalid_input", `El slug debe tener al menos ${SLUG_MIN} caracteres (letras, números y guiones).`);
    if (slug.length > SLUG_MAX || !SLUG_PATTERN.test(slug)) {
        throw new EventSlugError("invalid_input", "El slug solo puede tener letras minúsculas sin tildes, números y guiones (p. ej. fiesta-de-verano-2026).");
    }
    if (RESERVED_SLUGS.has(slug) || isDemoEventSlug(slug)) throw new EventSlugError("invalid_input", `"${slug}" es un slug reservado. Elige otro.`);
}

const missingTable = (error: any) => error?.code === "42P01" || error?.code === "PGRST205" || /aitickets_event_slug_redirects/.test(String(error?.message || ""));

/** ¿El evento tiene registrados? Órdenes pagadas, entradas emitidas (incluye cortesías) o invitados. */
export async function eventHasRegistrations(supabase: SupabaseClient, eventId: number): Promise<{ has: boolean; orders: number; attendees: number; guests: number }> {
    const head = { count: "exact" as const, head: true };
    const [orders, attendees, guests] = await Promise.all([
        supabase.from("event_orders").select("id", head).eq("event_id", eventId).eq("status", "paid"),
        supabase.from("event_attendees").select("id", head).eq("event_id", eventId),
        supabase.from("aitickets_guests").select("id", head).eq("event_id", eventId),
    ]);
    if (orders.error) throw orders.error;
    if (attendees.error) throw attendees.error;
    // aitickets_guests puede no existir en una BD sin migrar: sin invitados
    const counts = { orders: orders.count || 0, attendees: attendees.count || 0, guests: guests.error ? 0 : guests.count || 0 };
    return { has: counts.orders + counts.attendees + counts.guests > 0, ...counts };
}

export type SlugChangeResult = {
    old_slug: string;
    new_slug: string;
    changed: boolean;
    redirect_created: boolean;
    has_registrations: boolean;
    was_published: boolean;
};

/**
 * Cambia el slug de un evento de la organización. Valida formato y unicidad (contra otros eventos y contra
 * slugs antiguos de otros eventos, que siguen redirigiendo). Publicado o con registrados crea el redirect old -> evento.
 */
export async function changeEventSlug(
    supabase: SupabaseClient,
    event: { id: number; slug: string | null; organization_id: number; status?: string | null },
    requested: string,
    opts: { userId?: number | null } = {},
): Promise<SlugChangeResult> {
    const newSlug = normalizeSlug(requested);
    validateSlug(newSlug);
    const oldSlug = event.slug || "";
    if (isDemoEventSlug(oldSlug)) throw new EventSlugError("invalid_input", "El slug de un evento demo no se puede cambiar.");
    if (newSlug === oldSlug) return { old_slug: oldSlug, new_slug: newSlug, changed: false, redirect_created: false, has_registrations: false, was_published: event.status === "published" };

    const { data: taken, error: takenError } = await supabase.from("events").select("id").eq("slug", newSlug).neq("id", event.id).limit(1);
    if (takenError) throw takenError;
    if (taken && taken.length) throw new EventSlugError("conflict", `El slug "${newSlug}" ya lo usa otro evento. Elige otro.`);

    const { data: redirect, error: redirectError } = await supabase.from(SLUG_REDIRECTS_TABLE).select("old_slug, event_id").eq("old_slug", newSlug).maybeSingle();
    const tableMissing = !!redirectError && missingTable(redirectError);
    if (redirectError && !tableMissing) throw redirectError;
    if (redirect && Number(redirect.event_id) !== Number(event.id)) {
        throw new EventSlugError("conflict", `El slug "${newSlug}" redirige a otro evento (era su link anterior). Elige otro.`);
    }

    const registrations = await eventHasRegistrations(supabase, event.id);
    const wasPublished = event.status === "published";
    const needsRedirect = (wasPublished || registrations.has) && !!oldSlug && SLUG_PATTERN.test(oldSlug);
    if (needsRedirect && tableMissing) {
        throw new EventSlugError("conflict", "No se puede cambiar el slug de un evento publicado o con registrados todavía (falta la migración de redirects). Intenta más tarde.");
    }

    // Volver a un slug anterior propio: ese redirect deja de hacer falta (el evento lo usa de nuevo)
    if (redirect) {
        const { error } = await supabase.from(SLUG_REDIRECTS_TABLE).delete().eq("old_slug", newSlug).eq("event_id", event.id);
        if (error) throw error;
    }
    if (needsRedirect) {
        const { error } = await supabase
            .from(SLUG_REDIRECTS_TABLE)
            .upsert({ old_slug: oldSlug, event_id: event.id, organization_id: event.organization_id, created_by_user_id: opts.userId ?? null }, { onConflict: "old_slug" });
        if (error) throw error;
    }

    const { error: updateError } = await supabase.from("events").update({ slug: newSlug }).eq("id", event.id).eq("organization_id", event.organization_id);
    if (updateError) {
        if (updateError.code === "23505") throw new EventSlugError("conflict", `El slug "${newSlug}" ya lo usa otro evento. Elige otro.`);
        throw updateError;
    }
    return { old_slug: oldSlug, new_slug: newSlug, changed: true, redirect_created: needsRedirect, has_registrations: registrations.has, was_published: wasPublished };
}

/**
 * Slug vigente de un evento cuyo slug anterior es `slug` (null si no hay redirect). Con organizationId solo
 * resuelve eventos de esa organización (sitios de productor, validador QR).
 */
export async function resolveEventSlugRedirect(slug: string | undefined, opts: { organizationId?: number; supabase?: SupabaseClient } = {}): Promise<string | null> {
    if (!slug || !SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX) return null;
    const supabase = opts.supabase || getSupabaseAdmin();
    const { data: redirect, error } = await supabase.from(SLUG_REDIRECTS_TABLE).select("event_id").eq("old_slug", slug).maybeSingle();
    if (error) {
        if (!missingTable(error)) console.error("resolveEventSlugRedirect:", error.message);
        return null;
    }
    if (!redirect) return null;
    let query = supabase.from("events").select("slug").eq("id", redirect.event_id);
    if (opts.organizationId !== undefined) query = query.eq("organization_id", opts.organizationId);
    const { data: event } = await query.maybeSingle();
    const current = (event as any)?.slug as string | undefined;
    return current && current !== slug ? current : null;
}

/**
 * 301 al slug vigente. Con Cache-Control acotado: un 301 sin él queda en caché del navegador para siempre y,
 * si el productor vuelve al slug anterior (a -> b -> a), ese navegador entraría en un loop.
 */
export function slugRedirectResponse(location: string): Response {
    return new Response(null, { status: 301, headers: { Location: location, "Cache-Control": "private, max-age=3600" } });
}

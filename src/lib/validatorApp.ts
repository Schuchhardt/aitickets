// App de puerta: /validador (eventos que la persona puede validar) y /validador/<slug> (escáner QR con la lista
// descargada, búsqueda por nombre y sincronización; sigue funcionando sin conexión: ValidateQR.vue guarda la
// lista y las validaciones pendientes en el dispositivo y public/validador-sw.js guarda la página).
// La usa el rol Puerta (validator), que solo ve esto, y también dueños, administradores y marketing.
import type { AstroGlobal } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionContext, hasRole, type SessionContext } from "./supabaseServer";
import { attachSessionCheckins, attachEntryDeadlines } from "../../netlify/lib/checkin.mjs";

/** Roles que pueden validar entradas (el mismo CHECKIN_ROLES de netlify/lib/session.mjs, que usan las APIs). */
export const CHECKIN_ROLES = ["admin", "producer", "editor", "validator"];

export const VALIDATOR_APP_PATH = "/validador";

/** URL del escáner de un evento. */
export const validatorEventPath = (slug: string) => `${VALIDATOR_APP_PATH}/${encodeURIComponent(slug)}`;

/** Rutas del panel que el rol Puerta sí puede abrir: su perfil (cambiar la contraseña temporal). */
const VALIDATOR_PANEL_PATHS = ["/dashboard/profile"];

/**
 * true si el rol Puerta puede quedarse en esta ruta del panel; si no, se lo manda a /validador.
 * El check-in del panel (/dashboard/events/<id>/checkin) lo redirige la propia página a /validador/<slug>.
 */
export function validatorMayOpen(pathname: string): boolean {
    const path = pathname.replace(/\/+$/, "") || "/";
    if (VALIDATOR_PANEL_PATHS.includes(path)) return true;
    return /^\/dashboard\/events\/[^/]+\/checkin$/.test(path);
}

type GuardResult = { ok: true; session: SessionContext } | { ok: false; response: Response };

/** Exige sesión de un usuario con rol de check-in. Sin sesión => login (vuelve aquí después). */
export async function requireCheckinSession(Astro: AstroGlobal): Promise<GuardResult> {
    const session = await getSessionContext(Astro);
    if (!session) {
        const here = Astro.url.pathname;
        return { ok: false, response: Astro.redirect(`/organizadores/login?next=${encodeURIComponent(here)}`) };
    }
    if (!hasRole(session.dbUser, CHECKIN_ROLES)) {
        return { ok: false, response: Astro.redirect("/dashboard") };
    }
    return { ok: true, session };
}

/** Columnas de cada entrada que necesita el escáner (buscar, validar, avisos de función y reenviar). */
export const CHECKIN_TICKET_SELECT = `
    id,
    event_id,
    event_ticket_id,
    event_order_id,
    qr_code,
    status,
    is_complimentary,
    validated_at,
    attendees ( first_name, last_name, email ),
    event_tickets ( ticket_name, event_date_id )
`;

const PAGE_SIZE = 1000;

/**
 * Evento con todo lo que necesita ValidateQR.vue: funciones (dates), entradas (paginadas: PostgREST corta en 1000
 * filas) con su estado por función y hora límite, y rendered_at (para no pisar con un HTML viejo de la caché del
 * dispositivo una lista local más nueva).
 */
export async function loadCheckinEvent<E extends { id: number | string }>(supabase: SupabaseClient, event: E) {
    const attendees: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
            .from("event_attendees")
            .select(CHECKIN_TICKET_SELECT)
            .eq("event_id", event.id)
            .order("id", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);
        if (error) {
            console.error("validador: error cargando entradas", error.message);
            break;
        }
        attendees.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
    }
    const { data: dates } = await supabase
        .from("event_dates")
        .select("id, date, start_time, end_time")
        .eq("event_id", event.id)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
    const withSessions = await attachEntryDeadlines(
        supabase,
        event.id,
        await attachSessionCheckins(supabase, event.id, attendees, dates || []),
    );
    return { ...event, dates: dates || [], attendees: withSessions, rendered_at: new Date().toISOString() };
}

export type ValidatorEventRow = {
    id: number;
    name: string;
    slug: string;
    start_date: string | null;
    end_date: string | null;
    location: string | null;
};

/**
 * Separa los eventos en "hoy y próximos" (no terminaron hace más de 12 horas: una fiesta que empezó ayer a las 23:00
 * sigue en curso) y "anteriores" (los 10 más recientes).
 */
export function splitValidatorEvents(events: ValidatorEventRow[], now = Date.now()) {
    const cutoff = now - 12 * 60 * 60 * 1000;
    const endOf = (e: ValidatorEventRow) => Date.parse(e.end_date || e.start_date || "") || 0;
    const startOf = (e: ValidatorEventRow) => Date.parse(e.start_date || "") || 0;
    const upcoming = events.filter((e) => !e.start_date || endOf(e) >= cutoff).sort((a, b) => startOf(a) - startOf(b));
    const past = events
        .filter((e) => e.start_date && endOf(e) < cutoff)
        .sort((a, b) => startOf(b) - startOf(a))
        .slice(0, 10);
    return { upcoming, past };
}

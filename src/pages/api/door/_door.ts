// Escáner de puerta sin cuenta (/puerta/<token>): autorización por el token del link (aitickets_checkin_links).
// No usa cookies de sesión. Todo queda limitado al evento del link. Archivo "_" => no es ruta.
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { resolveCheckinToken, touchCheckinLink, type CheckinLinkRow } from "../../../lib/checkinAccess";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { clientIp } from "../../../lib/producer-api/http";

/** Por IP: cubre adivinar tokens; por link: varios dispositivos escaneando en la misma puerta. */
export const DOOR_LIMIT_PER_IP = 240;
export const DOOR_LIMIT_PER_LINK = 600;

export const doorJson = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" },
    });

export type DoorAuth =
    | { ok: true; supabase: any; link: CheckinLinkRow; event: { id: number; name: string; slug: string } }
    | { ok: false; response: Response };

export async function authorizeDoor(request: Request, token: string | undefined, { scanned = false } = {}): Promise<DoorAuth> {
    const supabase = getSupabaseAdmin();
    const ipLimit = await rateLimit("door:ip", clientIp(request), { windowSeconds: 60, max: DOOR_LIMIT_PER_IP, supabase });
    if (!ipLimit.allowed) return { ok: false, response: doorJson({ message: "Demasiadas solicitudes. Espera un momento." }, 429) };
    const resolved = await resolveCheckinToken(supabase, String(token || ""));
    if (!resolved) return { ok: false, response: doorJson({ message: "Link de escáner inválido, vencido o revocado." }, 401) };
    const linkLimit = await rateLimit("door:link", resolved.link.id, { windowSeconds: 60, max: DOOR_LIMIT_PER_LINK, supabase });
    if (!linkLimit.allowed) return { ok: false, response: doorJson({ message: "Demasiadas solicitudes. Espera un momento." }, 429) };
    await touchCheckinLink(supabase, resolved.link, scanned);
    return { ok: true, supabase, ...resolved };
}

export async function readDoorBody(request: Request): Promise<any | null> {
    try {
        const text = (await request.text()).slice(0, 4096);
        return text ? JSON.parse(text) : {};
    } catch {
        return null;
    }
}

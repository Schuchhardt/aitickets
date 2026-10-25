// Crea un anuncio en Meta (Facebook e Instagram) vía Zernio para un evento publicado: uno nuevo con imagen y texto
// (type 'standalone') o promocionando un post ya publicado desde AI Tickets (type 'boost').
// Gasta dinero de la productora (Meta le cobra a su cuenta publicitaria), por eso:
//   * solo dueños/administradores (ORG_ADMIN_ROLES);
//   * presupuesto, duración y público se validan aquí (validateAdInput) y el gasto máximo (diario × días) debe venir
//     confirmado por la productora con el mismo total;
//   * la fila se guarda ANTES de llamar a Zernio (su id va en el link: utm_campaign=ad-<id>) con el cuerpo exacto del
//     request, y la llamada lleva Idempotency-Key: si se corta, se reintenta sin duplicar (recoverCreatingAd);
//   * dos envíos iguales seguidos (doble clic) devuelven el primero.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../lib/auth-helpers";
import { getSessionContext, hasRole, ORG_ADMIN_ROLES, jsonResponse } from "../../../../lib/supabaseServer";
import { adsJsonError } from "../../../../lib/ads";
import { canAccessEventByStaff } from "../../../../../netlify/lib/event-staff.mjs";
import { adTrackingUrl, adsEnabled, buildAdRequest, formatBudget, submitAdRequest, validateAdInput } from "../../../../../netlify/lib/zernio-ads.mjs";

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

export const POST: APIRoute = async (context) => {
    const session = await getSessionContext(context);
    if (!session) return adsJsonError("No autorizado", 401);
    if (!hasRole(session.dbUser, ORG_ADMIN_ROLES)) return adsJsonError("Solo el dueño o un administrador de la productora puede crear anuncios pagados.", 403);
    if (!adsEnabled()) return adsJsonError("Los anuncios no están disponibles en este momento.", 503);

    let body: any;
    try {
        body = await context.request.json();
    } catch {
        return adsJsonError("Solicitud inválida", 400);
    }
    const orgId = Number(session.dbUser.organization_id);
    const userId = Number(session.dbUser.id);
    const eventId = Number(body?.eventId);
    const connectionId = Number(body?.connectionId);
    if (!Number.isSafeInteger(eventId) || !Number.isSafeInteger(connectionId)) return adsJsonError("Elige el evento y la cuenta publicitaria.", 400);

    const supabase = getSupabaseAdmin();
    const now = new Date();
    try {
        const { data: event } = await supabase
            .from("events")
            .select("id, name, title, slug, status, start_date, end_date, image_url, organization_id")
            .eq("id", eventId)
            .eq("organization_id", orgId)
            .maybeSingle();
        if (!event || !(await canAccessEventByStaff(supabase, userId, eventId))) return adsJsonError("Evento no encontrado", 404);
        if (event.status !== "published") return adsJsonError("Publica el evento antes de anunciarlo: su página tiene que estar visible.", 400);
        if (event.end_date && Date.parse(event.end_date) <= now.getTime()) return adsJsonError("El evento ya terminó.", 400);

        const { data: connection } = await supabase
            .from("ad_account_connections")
            .select("id, organization_id, provider, status, zernio_account_id, meta_ad_account_id, currency, minimum_daily_budget, account_name")
            .eq("id", connectionId)
            .eq("organization_id", orgId)
            .eq("provider", "zernio")
            .maybeSingle();
        if (!connection || connection.status !== "active" || !connection.zernio_account_id) return adsJsonError("Esa cuenta publicitaria no está disponible. Vuelve a conectarla.", 400);

        let post: any = null;
        let boostAccountId: string | null = null;
        if (body?.type === "boost") {
            const { data } = await supabase
                .from("social_posts")
                .select("id, event_id, status, zernio_post_id, platforms, content, image_urls")
                .eq("id", Number(body?.socialPostId))
                .eq("organization_id", orgId)
                .maybeSingle();
            if (!data || Number(data.event_id) !== eventId) return adsJsonError("Post no encontrado", 404);
            post = data;
            // El boost corre desde la cuenta donde se publicó (Facebook primero: Instagram necesita su página vinculada)
            const platform = (post.platforms || []).includes("facebook") ? "facebook" : "instagram";
            const { data: account } = await supabase
                .from("social_accounts")
                .select("zernio_account_id")
                .eq("organization_id", orgId)
                .eq("platform", platform)
                .eq("status", "active")
                .limit(1)
                .maybeSingle();
            boostAccountId = account?.zernio_account_id || null;
            if (!boostAccountId) return adsJsonError("La cuenta donde se publicó ese post ya no está conectada.", 400);
        }

        const check = validateAdInput(body, { connection, event, post, now });
        if (!check.ok) return jsonResponse({ message: check.errors[0], errors: check.errors }, 400);
        const value = check.value;

        // Doble clic: el mismo anuncio recién creado se devuelve en vez de crear otro
        const { data: recent } = await supabase
            .from("ad_campaigns")
            .select("id, status, created_at")
            .eq("organization_id", orgId)
            .eq("event_id", eventId)
            .eq("provider", "zernio")
            .eq("ad_type", value.type)
            .eq("daily_budget", value.dailyBudget)
            .eq("duration_days", value.days)
            .gte("created_at", new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString())
            .limit(1)
            .maybeSingle();
        if (recent) return jsonResponse({ id: recent.id, status: recent.status, duplicate: true, message: "Ya creaste este anuncio hace un momento." }, 409);

        const { data: row, error: insError } = await supabase
            .from("ad_campaigns")
            .insert({
                organization_id: orgId,
                event_id: eventId,
                ad_account_connection_id: connection.id,
                provider: "zernio",
                ad_type: value.type,
                social_post_id: post?.id ?? null,
                name: String(event.title || event.name || "Evento").slice(0, 200),
                objective: "OUTCOME_TRAFFIC",
                status: "creating",
                daily_budget: value.dailyBudget,
                total_budget: value.totalBudget,
                currency: value.currency,
                start_date: value.startDate.toISOString(),
                end_date: value.endDate.toISOString(),
                duration_days: value.days,
                ad_copy: value.type === "boost" ? String(post?.content || "").slice(0, 1000) : value.body,
                headline: value.type === "boost" ? null : value.headline,
                image_urls: value.type === "boost" ? post?.image_urls || [] : [value.imageUrl],
                call_to_action: value.callToAction,
                target_audience: { geo: value.geo, ageMin: value.ageMin, ageMax: value.ageMax },
                created_by: userId,
            })
            .select("id, organization_id, created_at")
            .single();
        if (insError || !row) throw insError || new Error("No se pudo guardar el anuncio");

        const request = buildAdRequest({ adCampaignId: row.id, value, connection, event, post, boostAccountId });
        await supabase
            .from("ad_campaigns")
            .update({ zernio_request: request, destination_url: adTrackingUrl(event.slug, row.id) })
            .eq("id", row.id)
            .eq("organization_id", orgId);

        const result = await submitAdRequest(supabase, { ...row, zernio_request: request }, { now });
        if (!result.ok) {
            return jsonResponse(
                result.pending
                    ? { id: row.id, status: "creating", message: "Meta está tardando en confirmar el anuncio. Revisa en unos minutos: lo terminamos de crear sin duplicarlo." }
                    : { id: row.id, status: "error", message: result.message },
                result.pending ? 202 : 502,
            );
        }
        const spend = formatBudget(value.totalBudget, value.currency);
        return jsonResponse({
            id: row.id,
            status: result.row.status,
            message: value.launch === "paused"
                ? `Anuncio creado y pausado. Cuando lo actives, gastará hasta ${spend}.`
                : `Anuncio enviado a Meta. Lo revisan en unas horas y después empieza a mostrarse (gasto máximo ${spend}).`,
        });
    } catch (err: any) {
        console.error("[ads/create]", err?.message);
        return adsJsonError("No se pudo crear el anuncio. Intenta de nuevo.", 500);
    }
};

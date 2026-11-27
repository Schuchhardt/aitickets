// MCP de administración: notificación push de prueba al panel de productores (PWA). Sirve para confirmar que un
// productor recibe los avisos (o para probar el sistema) sin esperar una venta real. Va siempre con confirmación:
// la notificación llega al computador o teléfono de personas reales.
import { ToolError } from "../../producer-api/registry";
import { isPushConfigured, sendPushToOrg, sendPushToUser } from "../../../../netlify/lib/push.mjs";
import { loadOrganization, type AdminContext } from "../context";
import type { AdminToolDef } from "../registry";

const TABLE = "aitickets_push_subscriptions";
const DEFAULT_TITLE = "AI Tickets";
const DEFAULT_BODY = "Notificación de prueba: los avisos de AI Tickets llegan a este dispositivo.";

type Target = {
    kind: "organization" | "user";
    organization_id: number;
    organization_name: string;
    user_id?: number;
    user_name?: string | null;
    auth_user_id?: string;
};

async function resolveTarget(args: any, actx: AdminContext): Promise<Target> {
    if (Boolean(args.organization_id) === Boolean(args.user_id)) {
        throw new ToolError("invalid_input", "Indica organization_id o user_id (uno de los dos).");
    }
    if (args.organization_id) {
        const org = await loadOrganization<any>(actx, Number(args.organization_id), "id, public_name");
        return { kind: "organization", organization_id: Number(org.id), organization_name: org.public_name };
    }
    const { data: user, error } = await actx.supabase
        .from("users")
        .select("id, name, organization_id, auth_user_id")
        .eq("id", args.user_id)
        .maybeSingle();
    if (error) throw error;
    if (!user) throw new ToolError("not_found", "No existe ese usuario. Usa search_users.");
    if (!user.auth_user_id) throw new ToolError("conflict", "El usuario no tiene cuenta de acceso: no puede tener notificaciones activadas.");
    const org = await loadOrganization<any>(actx, Number(user.organization_id), "id, public_name");
    return {
        kind: "user",
        organization_id: Number(org.id),
        organization_name: org.public_name,
        user_id: Number(user.id),
        user_name: user.name ?? null,
        auth_user_id: String(user.auth_user_id),
    };
}

async function countDevices(actx: AdminContext, target: Target): Promise<number> {
    let q = actx.supabase.from(TABLE).select("id", { count: "exact", head: true });
    q = target.kind === "user" ? q.eq("user_id", target.auth_user_id) : q.eq("organization_id", target.organization_id);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
}

const notificationOf = (args: any) => ({
    title: String(args.title || DEFAULT_TITLE).slice(0, 80),
    body: String(args.body || DEFAULT_BODY).slice(0, 160),
    url: args.url || "/dashboard",
    tag: "admin-test-push",
});

const targetLabel = (t: Target) =>
    t.kind === "user" ? `${t.user_name || `usuario ${t.user_id}`} (${t.organization_name})` : `la organización ${t.organization_name}`;

const sendTestPush: AdminToolDef = {
    name: "send_test_push",
    title: "Notificación push de prueba",
    description:
        "Envía una notificación push de prueba al panel de productores (app instalada o navegador con avisos activados): " +
        "a todos los dispositivos de una organización (organization_id) o de un usuario (user_id, de search_users). " +
        "Sirve para confirmar que un productor recibe los avisos de ventas y mensajes. Pide confirmación: muestra a cuántos " +
        "dispositivos llegará. Responde cuántos la recibieron, cuántos fallaron y cuántas suscripciones vencidas se limpiaron.",
    readOnly: false,
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
            organization_id: { type: "integer", minimum: 1 },
            user_id: { type: "integer", minimum: 1, description: "Id de public.users (search_users), no el de Auth." },
            title: { type: "string", minLength: 1, maxLength: 80, description: `Por defecto "${DEFAULT_TITLE}".` },
            body: { type: "string", minLength: 1, maxLength: 160, description: "Texto de la notificación. Por defecto un aviso de prueba." },
            url: { type: "string", pattern: "^/[^/]", maxLength: 200, description: "Ruta del sitio que abre al hacer clic (por defecto /dashboard)." },
        },
    },
    annotations: { openWorldHint: true },
    async confirm(args, actx) {
        if (!isPushConfigured()) throw new ToolError("conflict", "Las notificaciones push no están configuradas (faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en Netlify).");
        const target = await resolveTarget(args, actx);
        const devices = await countDevices(actx, target);
        if (!devices) {
            throw new ToolError(
                "conflict",
                `${targetLabel(target)} no tiene dispositivos con notificaciones activadas: el productor debe tocar "Activar" en su panel.`,
            );
        }
        const n = notificationOf(args);
        return {
            message: `Enviar una notificación push de prueba a ${targetLabel(target)}: ${devices} dispositivo(s).`,
            details: { title: n.title, body: n.body, url: n.url, devices },
        };
    },
    audit: (args, result: any) => ({
        organization_id: result?.organization_id ?? args.organization_id ?? null,
        target: args.user_id ? `user:${args.user_id}` : args.organization_id ? `org:${args.organization_id}` : undefined,
        summary: `Push de prueba: ${result?.sent ?? 0} enviada(s), ${result?.failed ?? 0} fallida(s)`,
    }),
    async handler(args, actx) {
        const target = await resolveTarget(args, actx);
        const n = notificationOf(args);
        const result =
            target.kind === "user" ? await sendPushToUser(target.auth_user_id, n) : await sendPushToOrg(target.organization_id, n);
        return {
            organization_id: target.organization_id,
            organization_name: target.organization_name,
            ...(target.kind === "user" ? { user_id: target.user_id } : {}),
            ...result,
            note: result.sent
                ? "Enviada. Si no aparece, revisa que el sistema operativo permita notificaciones del navegador o de la app."
                : "No se entregó a ningún dispositivo. Las suscripciones vencidas (cleaned) se borraron: el productor debe volver a activar los avisos.",
        };
    },
};

export const pushTools: AdminToolDef[] = [sendTestPush];

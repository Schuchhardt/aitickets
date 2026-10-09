// Herramientas: equipo y roles (miembros, invitaciones, acceso por evento).
// Scope "team": team.read para leer, team.manage para cambiar (dueño y administradores).
// Reglas de src/pages/api/team/*: el dueño ('producer') no se modifica, nadie cambia su propio rol ni se
// desactiva a sí mismo, y la organización nunca queda sin un dueño/administrador activo.
import { ToolError, type ToolContext, type ToolDef } from "../registry";
import { ASSIGNABLE_ROLES, PERMISSION_LABELS, ROLE_LABELS, ROLE_PERMISSIONS } from "../permissions";
import {
    INVITATION_COLUMNS, INVITATION_TTL_DAYS, addEventStaff, generateInvitationToken, invitationStatus, invitationUrl, roleDescription, roleLabel,
} from "../../team-invitations";
import { sendEmail, isValidEmail, formatRecipient } from "../../../../netlify/lib/mailer.mjs";
import { renderTeamInvitationEmail } from "../../../../netlify/lib/emails/team.mjs";

const ORG_ADMINS = ["producer", "admin"];
/** Roles que solo el dueño puede dar o quitar: administración y plata (retiros, reembolsos). */
const OWNER_ONLY_ROLES = ["admin", "finance"];
const userIdSchema = { type: "integer" as const, minimum: 1, description: "ID del miembro (ver list_members)." };
const eventIdsSchema = (description: string) => ({
    type: "array" as const,
    maxItems: 50,
    items: { type: "integer" as const, minimum: 1 },
    description,
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const isActive = (u: any) => u.active !== false;

async function loadMember(ctx: ToolContext, userId: number) {
    const { data } = await ctx.supabase
        .from("users")
        .select("id, name, email, role, active, organization_id, auth_user_id, last_access_at, created_at")
        .eq("id", userId)
        .eq("organization_id", ctx.actor.orgId)
        .maybeSingle();
    if (!data) throw new ToolError("not_found", `No existe el miembro ${userId} en tu organización. Usa list_members.`);
    return data;
}

/** Dueños/administradores activos de la organización, excluyendo opcionalmente a un usuario. */
async function countActiveAdmins(ctx: ToolContext, excludeUserId?: number) {
    const { data } = await ctx.supabase.from("users").select("id, role, active").eq("organization_id", ctx.actor.orgId).in("role", ORG_ADMINS);
    return (data || []).filter((u: any) => isActive(u) && Number(u.id) !== Number(excludeUserId)).length;
}

/** Valida que los eventos sean de la organización; devuelve los IDs únicos. */
async function ownedEventIds(ctx: ToolContext, ids: number[] | undefined): Promise<number[]> {
    const unique = [...new Set((ids || []).map(Number))];
    if (!unique.length) return [];
    const { data, error } = await ctx.supabase.from("events").select("id").eq("organization_id", ctx.actor.orgId).in("id", unique);
    if (error) throw error;
    const found = new Set((data || []).map((e: any) => Number(e.id)));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length) throw new ToolError("not_found", `Estos eventos no existen en tu organización: ${missing.join(", ")}. Usa list_events.`);
    // Un actor con acceso limitado solo puede asignar eventos a los que él mismo tiene acceso
    const outside = ctx.actor.eventIds ? unique.filter((id) => !ctx.actor.eventIds!.includes(id)) : [];
    if (outside.length) throw new ToolError("forbidden", `No tienes acceso a estos eventos: ${outside.join(", ")}.`);
    return unique;
}

async function staffByUser(ctx: ToolContext, userIds: number[]): Promise<Map<number, number[]>> {
    const out = new Map<number, number[]>();
    if (!userIds.length) return out;
    const { data, error } = await ctx.supabase.from("aitickets_event_staff").select("user_id, event_id").eq("organization_id", ctx.actor.orgId).in("user_id", userIds);
    if (error) return out; // tabla aún inexistente: sin restricciones
    for (const r of data || []) {
        const list = out.get(Number(r.user_id)) || [];
        list.push(Number(r.event_id));
        out.set(Number(r.user_id), list);
    }
    return out;
}

const presentMember = (u: any, events: number[] | undefined, actorId: number) => ({
    id: Number(u.id),
    name: u.name || null,
    email: u.email || null,
    role: u.role,
    role_label: ROLE_LABELS[u.role] || u.role,
    active: isActive(u),
    is_owner: u.role === "producer",
    is_you: Number(u.id) === actorId,
    last_access_at: u.last_access_at || null,
    member_since: u.created_at || null,
    event_access: events?.length ? { restricted: true, event_ids: events } : { restricted: false, event_ids: null },
});

const listMembers: ToolDef = {
    name: "list_members",
    title: "Listar equipo",
    description:
        "Miembros de la organización: nombre, email, rol, si está activo, último acceso y eventos asignados " +
        "(event_access.restricted = true significa que solo ve esos eventos).",
    scope: "team",
    permission: "team.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { include_inactive: { type: "boolean", default: true, description: "false = solo miembros activos." } },
    },
    async handler(args, ctx) {
        const { data, error } = await ctx.supabase
            .from("users")
            .select("id, name, email, role, active, last_access_at, created_at")
            .eq("organization_id", ctx.actor.orgId)
            .order("created_at", { ascending: true });
        if (error) throw error;
        const rows = (data || []).filter((u: any) => args.include_inactive || isActive(u));
        const staff = await staffByUser(ctx, rows.map((u: any) => Number(u.id)));
        return {
            count: rows.length,
            members: rows.map((u: any) => presentMember(u, staff.get(Number(u.id)), ctx.actor.userId)),
        };
    },
};

const listRoles: ToolDef = {
    name: "list_roles",
    title: "Roles disponibles",
    description: "Roles del equipo y qué permite cada uno (dueño, administrador, finanzas, marketing, puerta, solo lectura).",
    scope: "team",
    permission: "team.read",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler() {
        return {
            roles: Object.keys(ROLE_PERMISSIONS).map((role) => ({
                role,
                label: ROLE_LABELS[role] || role,
                assignable: (ASSIGNABLE_ROLES as readonly string[]).includes(role),
                permissions: ROLE_PERMISSIONS[role].map((p) => ({ permission: p, allows: PERMISSION_LABELS[p] })),
            })),
            notes: [
                "El dueño (producer) no se asigna ni se cambia por la API.",
                "Solo el dueño puede invitar o nombrar administradores.",
                "Retiros, reembolsos y datos bancarios: solo dueño y finanzas.",
                "Con assign_event_staff un miembro queda limitado a ciertos eventos (útil para el equipo de puerta).",
            ],
        };
    },
};

const inviteMember: ToolDef = {
    name: "invite_member",
    title: "Invitar al equipo",
    description:
        "Invita a una persona al equipo con un rol (admin, finance, editor = marketing, validator = puerta, viewer = solo lectura). " +
        "Le llega un correo con un link personal (vence en 7 días) para crear su contraseña o entrar con su cuenta. " +
        "Opcional: event_ids para limitar su acceso a esos eventos. El link nunca se muestra en el chat.",
    scope: "team",
    permission: "team.manage",
    idempotent: true,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
        type: "object",
        required: ["email", "role"],
        additionalProperties: false,
        properties: {
            email: { type: "string", minLength: 3, maxLength: 200 },
            name: { type: "string", maxLength: 150 },
            role: { type: "string", enum: ASSIGNABLE_ROLES },
            event_ids: eventIdsSchema("Opcional: solo podrá ver estos eventos (ej. el equipo de puerta de un evento)."),
        },
    },
    async handler(args, ctx) {
        const email = String(args.email).trim().toLowerCase();
        if (!isValidEmail(email)) throw new ToolError("invalid_input", "Email inválido.");
        if (OWNER_ONLY_ROLES.includes(args.role) && ctx.actor.role !== "producer") {
            throw new ToolError("forbidden", "Solo el dueño de la cuenta puede invitar administradores o personas de finanzas.");
        }
        if (ctx.actor.eventIds && !args.event_ids?.length) {
            throw new ToolError("forbidden", "Tu acceso está limitado a ciertos eventos: la invitación debe indicar event_ids dentro de ellos.");
        }
        const eventIds = await ownedEventIds(ctx, args.event_ids);

        const { data: existing } = await ctx.supabase.from("users").select("id, organization_id, active").ilike("email", escapeLike(email)).maybeSingle();
        if (existing) {
            if (Number(existing.organization_id) !== ctx.actor.orgId) {
                throw new ToolError("conflict", "Ese correo ya tiene una cuenta en otra organización de AI Tickets: pídele que use otro correo.");
            }
            if (isActive(existing)) throw new ToolError("conflict", `Esa persona ya es miembro activo (id ${existing.id}). Usa update_member_role para cambiar su rol.`);
        }

        // Una invitación pendiente por correo: la anterior se revoca y se reemplaza
        const now = new Date();
        const { data: previous } = await ctx.supabase
            .from("aitickets_team_invitations")
            .select("id, accepted_at, revoked_at, expires_at")
            .eq("organization_id", ctx.actor.orgId)
            .eq("email", email);
        const pendingIds = (previous || []).filter((r: any) => invitationStatus(r, now) === "pending").map((r: any) => r.id);
        if (pendingIds.length) {
            await ctx.supabase.from("aitickets_team_invitations").update({ revoked_at: now.toISOString() }).in("id", pendingIds);
        }

        const { token, hash } = generateInvitationToken();
        const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 86400000).toISOString();
        const { data: invitation, error } = await ctx.supabase
            .from("aitickets_team_invitations")
            .insert({
                organization_id: ctx.actor.orgId,
                email,
                name: args.name || null,
                role: args.role,
                event_ids: eventIds,
                token_hash: hash,
                invited_by: ctx.actor.userId,
                invited_via: ctx.channel,
                expires_at: expiresAt,
            })
            .select(INVITATION_COLUMNS)
            .single();
        if (error) {
            if (["42P01", "PGRST205"].includes(String(error.code))) throw new ToolError("unavailable", "Las invitaciones aún no están disponibles. Intenta en unos minutos.");
            throw error;
        }

        const { data: org } = await ctx.supabase.from("organizations").select("public_name").eq("id", ctx.actor.orgId).maybeSingle();
        let emailSent = false;
        try {
            const mail = await renderTeamInvitationEmail({
                orgName: org?.public_name,
                inviterName: ctx.actor.name ?? undefined,
                roleLabel: roleLabel(args.role),
                roleDescription: roleDescription(args.role),
                url: invitationUrl(ctx.origin, token),
                expiresIn: `${INVITATION_TTL_DAYS} días`,
                name: args.name,
            });
            await sendEmail({ to: formatRecipient(args.name || "", email), ...mail, tags: ["team-invitation"], idempotencyKey: `team-invitation-${invitation.id}` });
            emailSent = true;
            await ctx.supabase.from("aitickets_team_invitations").update({ email_sent_at: new Date().toISOString() }).eq("id", invitation.id);
        } catch (err: any) {
            console.error("invite_member: correo no enviado:", err?.message || err);
        }

        return {
            invitation_id: invitation.id,
            email,
            role: args.role,
            role_label: roleLabel(args.role),
            event_ids: eventIds.length ? eventIds : null,
            expires_at: expiresAt,
            email_sent: emailSent,
            replaced_pending_invitations: pendingIds.length,
            note: emailSent
                ? `Le enviamos un correo con el link para unirse (vence en ${INVITATION_TTL_DAYS} días). Por seguridad el link no se muestra aquí.`
                : "La invitación quedó creada pero el correo no se pudo enviar. Vuelve a intentarlo con invite_member en unos minutos (reemplaza esta invitación).",
        };
    },
    audit: (args, result) => ({ summary: `Invitación con rol ${roleLabel(args.role)}${(result as any).email_sent ? "" : " (correo no enviado)"}`, target: `invitation:${(result as any).invitation_id}` }),
};

const updateMemberRole: ToolDef = {
    name: "update_member_role",
    title: "Cambiar rol",
    description:
        "Cambia el rol de un miembro. No se puede cambiar al dueño ni tu propio rol, y la organización debe conservar al menos un dueño/administrador activo. " +
        "Solo el dueño puede nombrar administradores.",
    scope: "team",
    permission: "team.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["user_id", "role"],
        additionalProperties: false,
        properties: { user_id: userIdSchema, role: { type: "string", enum: ASSIGNABLE_ROLES } },
    },
    async handler(args, ctx) {
        const member = await loadMember(ctx, args.user_id);
        if (member.role === "producer") throw new ToolError("forbidden", "El rol del dueño de la cuenta no se puede cambiar.");
        if (Number(member.id) === ctx.actor.userId) throw new ToolError("forbidden", "No puedes cambiar tu propio rol.");
        if ((OWNER_ONLY_ROLES.includes(args.role) || OWNER_ONLY_ROLES.includes(member.role)) && ctx.actor.role !== "producer") {
            throw new ToolError("forbidden", "Solo el dueño de la cuenta puede dar o quitar los roles de administrador y finanzas.");
        }
        if (member.role === args.role) return { user_id: Number(member.id), role: member.role, role_label: roleLabel(member.role), changed: false };
        if (ORG_ADMINS.includes(member.role) && !ORG_ADMINS.includes(args.role) && (await countActiveAdmins(ctx, Number(member.id))) < 1) {
            throw new ToolError("conflict", "La organización debe tener al menos un dueño o administrador activo.");
        }
        const { error } = await ctx.supabase
            .from("users")
            .update({ role: args.role, updated_at: new Date().toISOString() })
            .eq("id", member.id)
            .eq("organization_id", ctx.actor.orgId);
        if (error) throw error;
        return {
            user_id: Number(member.id),
            previous_role: member.role,
            role: args.role,
            role_label: roleLabel(args.role),
            changed: true,
            note: "El cambio rige de inmediato, también para sus conexiones de IA y llaves de API (los permisos se revisan en cada acción).",
        };
    },
    audit: (args, result) => ({ summary: `Rol ${roleLabel((result as any).previous_role || "")} → ${roleLabel(args.role)}`, target: `user:${args.user_id}` }),
};

const removeMember: ToolDef = {
    name: "remove_member",
    title: "Quitar acceso",
    description:
        "Quita el acceso de un miembro: queda desactivado (no puede entrar al panel) y se revocan sus llaves de API y apps de IA conectadas. " +
        "No aplica al dueño ni a ti mismo. Se puede reactivar desde el panel (Equipo).",
    scope: "team",
    permission: "team.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: { type: "object", required: ["user_id"], additionalProperties: false, properties: { user_id: userIdSchema } },
    async handler(args, ctx) {
        const member = await loadMember(ctx, args.user_id);
        if (member.role === "producer") throw new ToolError("forbidden", "No se puede quitar el acceso al dueño de la cuenta.");
        if (Number(member.id) === ctx.actor.userId) throw new ToolError("forbidden", "No puedes quitarte el acceso a ti mismo.");
        if (OWNER_ONLY_ROLES.includes(member.role) && ctx.actor.role !== "producer") {
            throw new ToolError("forbidden", "Solo el dueño de la cuenta puede quitar el acceso a un administrador o a finanzas.");
        }
        if (ORG_ADMINS.includes(member.role) && (await countActiveAdmins(ctx, Number(member.id))) < 1) {
            throw new ToolError("conflict", "No puedes quitar al último administrador activo.");
        }
        const nowIso = new Date().toISOString();
        if (isActive(member)) {
            const { error } = await ctx.supabase.from("users").update({ active: false, updated_at: nowIso }).eq("id", member.id).eq("organization_id", ctx.actor.orgId);
            if (error) throw error;
        }
        const { count: keysRevoked } = await ctx.supabase
            .from("aitickets_api_keys")
            .update({ revoked_at: nowIso }, { count: "exact" })
            .eq("user_id", member.id)
            .eq("organization_id", ctx.actor.orgId)
            .is("revoked_at", null);
        const { error: grantsError, count: grantsRevoked } = await ctx.supabase
            .from("aitickets_oauth_grants")
            .update({ revoked_at: nowIso }, { count: "exact" })
            .eq("user_id", member.id)
            .eq("organization_id", ctx.actor.orgId)
            .is("revoked_at", null);
        if (grantsError) console.warn("remove_member grants:", grantsError.message);
        // Los links de escáner de puerta que creó dejan de funcionar
        const { error: linksError, count: doorLinksRevoked } = await ctx.supabase
            .from("aitickets_checkin_links")
            .update({ revoked_at: nowIso }, { count: "exact" })
            .eq("created_by", member.id)
            .eq("organization_id", ctx.actor.orgId)
            .is("revoked_at", null);
        if (linksError) console.warn("remove_member checkin links:", linksError.message);

        // Bloquear el login en Auth solo si la cuenta la creó AI Tickets (Auth se comparte con otras apps)
        if (member.auth_user_id) {
            try {
                const { data } = await ctx.supabase.auth.admin.getUserById(member.auth_user_id);
                if ((data?.user?.app_metadata as any)?.app === "aitickets") {
                    await ctx.supabase.auth.admin.updateUserById(member.auth_user_id, { ban_duration: "876000h" });
                }
            } catch (err: any) {
                console.warn("remove_member auth:", err?.message || err);
            }
        }
        return {
            user_id: Number(member.id),
            active: false,
            api_keys_revoked: keysRevoked || 0,
            ai_apps_revoked: grantsRevoked || 0,
            door_links_revoked: doorLinksRevoked || 0,
            note: "Ya no puede entrar al panel ni usar la API. Para devolverle el acceso, reactívalo en el panel (Equipo).",
        };
    },
    audit: (args) => ({ summary: "Acceso quitado a un miembro", target: `user:${args.user_id}` }),
};

const listInvitations: ToolDef = {
    name: "list_invitations",
    title: "Listar invitaciones",
    description: "Invitaciones al equipo con su estado (pending, accepted, expired, revoked), rol y vencimiento. No incluye el link.",
    scope: "team",
    permission: "team.read",
    annotations: { readOnlyHint: true },
    inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { status: { type: "string", enum: ["pending", "accepted", "expired", "revoked", "all"], default: "pending" } },
    },
    async handler(args, ctx) {
        const { data, error } = await ctx.supabase
            .from("aitickets_team_invitations")
            .select(INVITATION_COLUMNS)
            .eq("organization_id", ctx.actor.orgId)
            .order("created_at", { ascending: false })
            .limit(200);
        if (error) {
            if (["42P01", "PGRST205"].includes(String(error.code))) return { count: 0, invitations: [] };
            throw error;
        }
        const now = new Date();
        const rows = (data || [])
            .map((r: any) => ({ row: r, status: invitationStatus(r, now) }))
            .filter((r: any) => args.status === "all" || r.status === args.status);
        return {
            count: rows.length,
            invitations: rows.map(({ row, status }: any) => ({
                id: row.id,
                email: row.email,
                name: row.name || null,
                role: row.role,
                role_label: roleLabel(row.role),
                event_ids: row.event_ids?.length ? row.event_ids.map(Number) : null,
                status,
                email_sent: Boolean(row.email_sent_at),
                created_at: row.created_at,
                expires_at: row.expires_at,
                accepted_at: row.accepted_at || null,
                accepted_user_id: row.accepted_user_id ? Number(row.accepted_user_id) : null,
                revoked_at: row.revoked_at || null,
            })),
        };
    },
};

const revokeInvitation: ToolDef = {
    name: "revoke_invitation",
    title: "Revocar invitación",
    description: "Anula una invitación pendiente (invitation_id de list_invitations): su link deja de funcionar.",
    scope: "team",
    permission: "team.manage",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["invitation_id"],
        additionalProperties: false,
        properties: { invitation_id: { type: "string", pattern: "^[0-9a-fA-F-]{36}$", description: "ID de la invitación (uuid)." } },
    },
    async handler(args, ctx) {
        const { data: row } = await ctx.supabase
            .from("aitickets_team_invitations")
            .select(INVITATION_COLUMNS)
            .eq("id", args.invitation_id)
            .eq("organization_id", ctx.actor.orgId)
            .maybeSingle();
        if (!row) throw new ToolError("not_found", "Invitación no encontrada en tu organización.");
        const status = invitationStatus(row);
        if (status === "accepted") throw new ToolError("conflict", "La invitación ya fue aceptada: para quitar el acceso usa remove_member.");
        if (status === "revoked") return { invitation_id: row.id, status: "revoked", changed: false };
        const { error } = await ctx.supabase
            .from("aitickets_team_invitations")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("organization_id", ctx.actor.orgId);
        if (error) throw error;
        return { invitation_id: row.id, status: "revoked", changed: true };
    },
    audit: (args) => ({ summary: "Invitación revocada", target: `invitation:${args.invitation_id}` }),
};

const assignEventStaff: ToolDef = {
    name: "assign_event_staff",
    title: "Asignar acceso por evento",
    description:
        "Limita a un miembro a ciertos eventos (p. ej. el equipo de puerta de un solo evento). Un miembro con eventos asignados SOLO ve y opera esos eventos " +
        "(panel, check-in y API); sin eventos asignados ve todos los de la organización. Usa add_event_ids / remove_event_ids, o replace_event_ids " +
        "para dejar exactamente esa lista ([] = quitar la restricción).",
    scope: "team",
    permission: "team.manage",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
        type: "object",
        required: ["user_id"],
        additionalProperties: false,
        properties: {
            user_id: userIdSchema,
            add_event_ids: eventIdsSchema("Eventos a agregar."),
            remove_event_ids: eventIdsSchema("Eventos a quitar."),
            replace_event_ids: eventIdsSchema("Lista final exacta (reemplaza todo). [] = sin restricción (ve todos los eventos)."),
        },
    },
    async handler(args, ctx) {
        if (args.replace_event_ids === undefined && !args.add_event_ids?.length && !args.remove_event_ids?.length) {
            throw new ToolError("invalid_input", "Indica add_event_ids, remove_event_ids o replace_event_ids.");
        }
        if (args.replace_event_ids !== undefined && (args.add_event_ids?.length || args.remove_event_ids?.length)) {
            throw new ToolError("invalid_input", "Usa replace_event_ids solo, o add/remove_event_ids, pero no ambos.");
        }
        const member = await loadMember(ctx, args.user_id);
        if (member.role === "producer") throw new ToolError("forbidden", "El dueño de la cuenta siempre ve todos los eventos.");
        if (Number(member.id) === ctx.actor.userId) throw new ToolError("forbidden", "No puedes cambiar tu propio acceso por evento.");
        if (OWNER_ONLY_ROLES.includes(member.role) && ctx.actor.role !== "producer") {
            throw new ToolError("forbidden", "Solo el dueño de la cuenta puede cambiar el acceso de un administrador o de finanzas.");
        }

        const current = (await staffByUser(ctx, [Number(member.id)])).get(Number(member.id)) || [];
        let target: number[];
        if (args.replace_event_ids !== undefined) {
            target = await ownedEventIds(ctx, args.replace_event_ids);
        } else {
            const add = await ownedEventIds(ctx, args.add_event_ids);
            const remove = new Set((args.remove_event_ids || []).map(Number));
            target = [...new Set([...current, ...add])].filter((id) => !remove.has(id));
            if (!target.length && current.length && args.remove_event_ids?.length) {
                // Quitar todos los eventos dejaría al miembro SIN restricción (vería todo): se exige que sea explícito
                throw new ToolError(
                    "conflict",
                    "Quitar todos sus eventos le daría acceso a TODOS los eventos. Si eso quieres, usa replace_event_ids: []; para quitarle el acceso, usa remove_member.",
                );
            }
        }
        // Un actor limitado no puede dejar a otro sin restricción ni tocar eventos fuera de su alcance
        if (ctx.actor.eventIds) {
            if (!target.length) throw new ToolError("forbidden", "Tu acceso está limitado a ciertos eventos: no puedes dar acceso a todos los eventos.");
            const outsideCurrent = current.filter((id) => !ctx.actor.eventIds!.includes(id) && !target.includes(id));
            if (outsideCurrent.length) throw new ToolError("forbidden", `No puedes quitar eventos a los que no tienes acceso: ${outsideCurrent.join(", ")}.`);
        }
        const toRemove = current.filter((id) => !target.includes(id));
        const toAdd = target.filter((id) => !current.includes(id));
        if (toRemove.length) {
            const { error } = await ctx.supabase
                .from("aitickets_event_staff")
                .delete()
                .eq("user_id", member.id)
                .eq("organization_id", ctx.actor.orgId)
                .in("event_id", toRemove);
            if (error) throw error;
        }
        try {
            await addEventStaff(ctx.supabase, ctx.actor.orgId, Number(member.id), toAdd, ctx.actor.userId);
        } catch (err: any) {
            if (["42P01", "PGRST205"].includes(String(err?.code))) throw new ToolError("unavailable", "El acceso por evento aún no está disponible. Intenta en unos minutos.");
            throw err;
        }
        return {
            user_id: Number(member.id),
            role: member.role,
            role_label: roleLabel(member.role),
            event_access: target.length ? { restricted: true, event_ids: target } : { restricted: false, event_ids: null },
            added: toAdd,
            removed: toRemove,
            note: target.length
                ? `Solo verá y operará los eventos ${target.join(", ")} (panel, check-in y API).`
                : "Sin restricción: ve todos los eventos de la organización que su rol permite.",
        };
    },
    audit: (args, result) => ({
        summary: (result as any).event_access?.restricted ? `Acceso limitado a eventos ${(result as any).event_access.event_ids.join(", ")}` : "Acceso a todos los eventos",
        target: `user:${args.user_id}`,
    }),
};

export const teamTools: ToolDef[] = [listMembers, listRoles, inviteMember, updateMemberRole, removeMember, listInvitations, revokeInvitation, assignEventStaff];

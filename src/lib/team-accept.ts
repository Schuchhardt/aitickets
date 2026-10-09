// Aceptación de una invitación al equipo (/invitacion/<token>). Separado de la ruta para poder testearlo.
//
// Casos:
//  - El correo ya tiene fila en public.users de la MISMA organización (miembro desactivado o antiguo): se
//    verifica su contraseña, se reactiva con el rol de la invitación y se desbloquea en Auth si la cuenta la
//    creó AI Tickets.
//  - El correo pertenece a otra organización: se rechaza.
//  - Sin fila en public.users: se crea la cuenta de Auth (marcada app=aitickets). Si el correo ya existe en
//    Auth (proyecto compartido con otras apps) se pide la contraseña de esa cuenta y se vincula.
// La invitación se "reclama" primero con un UPDATE condicional (un solo uso aunque lleguen dos envíos).
import { invitationStatus } from "./team-invitations";

export const MIN_PASSWORD_LENGTH = 8;
const AITICKETS_APP_METADATA = { app: "aitickets" } as const;

export type AcceptResult =
    | { ok: true; session: { access_token: string; refresh_token: string }; role: string; userId: number; redirectTo: string }
    | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): AcceptResult => ({ ok: false, status, code, message });
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const homeForRole = (role: string) => (role === "validator" ? "/dashboard/events" : role === "finance" ? "/dashboard/finance" : "/dashboard");

async function signIn(authClient: any, email: string, password: string) {
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data?.session) return null;
    return data as { session: { access_token: string; refresh_token: string }; user: { id: string } };
}

export async function acceptTeamInvitation(
    supabase: any,
    authClient: any,
    invitation: any,
    input: { name?: string; password?: string },
    now = new Date(),
): Promise<AcceptResult> {
    if (!invitation) return fail(404, "not_found", "La invitación no existe o el link está incompleto.");
    const status = invitationStatus(invitation, now);
    if (status === "accepted") return fail(409, "accepted", "Esta invitación ya fue usada. Ingresa con tu cuenta en /organizadores/login.");
    if (status === "revoked") return fail(410, "revoked", "Esta invitación fue anulada. Pide una nueva a quien te invitó.");
    if (status === "expired") return fail(410, "expired", "Esta invitación venció. Pide una nueva a quien te invitó.");

    const password = typeof input.password === "string" ? input.password : "";
    const name = String(input.name || invitation.name || "").trim().slice(0, 150);
    if (!password) return fail(400, "invalid_input", "Escribe tu contraseña.");
    if (password.length > 72) return fail(400, "invalid_input", "La contraseña puede tener como máximo 72 caracteres.");

    const email = String(invitation.email).trim().toLowerCase();
    const orgId = Number(invitation.organization_id);
    const { data: existing } = await supabase
        .from("users")
        .select("id, organization_id, auth_user_id, role, active")
        .ilike("email", escapeLike(email))
        .maybeSingle();
    if (existing && existing.organization_id != null && Number(existing.organization_id) !== orgId) {
        return fail(409, "other_org", "Este correo ya tiene una cuenta en otra productora de AI Tickets. Pide que te inviten con otro correo.");
    }

    // Reclamar la invitación (un solo uso)
    const claimedAt = now.toISOString();
    const { count: claimed, error: claimError } = await supabase
        .from("aitickets_team_invitations")
        .update({ accepted_at: claimedAt }, { count: "exact" })
        .eq("id", invitation.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", claimedAt);
    if (claimError) throw claimError;
    if (!claimed) return fail(409, "accepted", "Esta invitación ya no está disponible. Ingresa con tu cuenta o pide una nueva.");
    const release = () => supabase.from("aitickets_team_invitations").update({ accepted_at: null }).eq("id", invitation.id);

    // Acceso por evento: se valida ANTES de crear nada. Una invitación limitada a eventos nunca puede terminar
    // en un miembro sin restricción (vería todos los eventos).
    const eventIds: number[] = (invitation.event_ids || []).map(Number).filter(Number.isFinite);
    let staffEventIds: number[] = [];
    if (eventIds.length) {
        const { data: owned, error: ownedError } = await supabase.from("events").select("id").eq("organization_id", orgId).in("id", eventIds);
        staffEventIds = (owned || []).map((e: any) => Number(e.id));
        if (ownedError || !staffEventIds.length) {
            await release();
            return fail(409, "events_gone", "Los eventos de esta invitación ya no existen. Pide una invitación nueva.");
        }
    }

    try {
        let authUserId: string | null = existing?.auth_user_id || null;
        let signed: Awaited<ReturnType<typeof signIn>> = null;

        if (authUserId) {
            // Cuenta existente: desbloquear (si la bloqueó AI Tickets al desactivarla) y verificar la contraseña
            let unbanned = false;
            try {
                const { data } = await supabase.auth.admin.getUserById(authUserId);
                const user = data?.user;
                if ((user?.app_metadata as any)?.app === "aitickets" && user?.banned_until && new Date(user.banned_until).getTime() > now.getTime()) {
                    await supabase.auth.admin.updateUserById(authUserId, { ban_duration: "none" });
                    unbanned = true;
                }
            } catch (err: any) {
                console.warn("accept-invitation getUserById:", err?.message || err);
            }
            signed = await signIn(authClient, email, password);
            if (!signed) {
                if (unbanned) await supabase.auth.admin.updateUserById(authUserId, { ban_duration: "876000h" }).catch(() => {});
                await release();
                return fail(401, "wrong_password", "Ya tienes una cuenta con este correo: escribe su contraseña (o recupérala en /organizadores/recuperar).");
            }
        } else {
            if (password.length < MIN_PASSWORD_LENGTH) {
                await release();
                return fail(400, "invalid_input", `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
            }
            if (!name) {
                await release();
                return fail(400, "invalid_input", "Escribe tu nombre.");
            }
            const { data: created, error: createError } = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { full_name: name },
                app_metadata: { ...AITICKETS_APP_METADATA },
            });
            if (createError || !created?.user) {
                // El correo ya existe en Auth (proyecto compartido): vincular esa cuenta con su contraseña
                if (/already|registered|exists/i.test(createError?.message || "")) {
                    signed = await signIn(authClient, email, password);
                    if (!signed) {
                        await release();
                        return fail(401, "existing_account", "Este correo ya tiene una cuenta: escribe la contraseña de esa cuenta para unirte (o recupérala en /organizadores/recuperar).");
                    }
                    authUserId = signed.user.id;
                } else {
                    await release();
                    const weak = /weak|short|password/i.test(createError?.message || "");
                    return fail(weak ? 400 : 500, weak ? "weak_password" : "internal", weak ? "Esa contraseña es muy débil. Prueba con una más larga." : "No pudimos crear tu cuenta. Intenta de nuevo.");
                }
            } else {
                authUserId = created.user.id;
            }
        }

        // Fila en public.users: la existente, la que creó el trigger handle_new_user, o una nueva
        const nowIso = now.toISOString();
        let userId: number;
        let role = invitation.role;
        if (existing) {
            if (existing.role === "producer") role = "producer";
            const { error } = await supabase
                .from("users")
                .update({ active: true, role, organization_id: orgId, auth_user_id: authUserId, ...(name ? { name } : {}), updated_at: nowIso })
                .eq("id", existing.id);
            if (error) throw error;
            userId = Number(existing.id);
        } else {
            const { data: byAuth } = await supabase.from("users").select("id").eq("auth_user_id", authUserId).maybeSingle();
            if (byAuth) {
                const { error } = await supabase
                    .from("users")
                    .update({ active: true, role, organization_id: orgId, email, name: name || null, updated_at: nowIso })
                    .eq("id", byAuth.id);
                if (error) throw error;
                userId = Number(byAuth.id);
            } else {
                const { data: inserted, error } = await supabase
                    .from("users")
                    .insert({ name: name || null, email, role, organization_id: orgId, auth_user_id: authUserId, active: true })
                    .select("id")
                    .single();
                if (error) throw error;
                userId = Number(inserted.id);
            }
        }

        if (staffEventIds.length) {
            const { data: have, error: haveError } = await supabase.from("aitickets_event_staff").select("event_id").eq("user_id", userId);
            const already = new Set((have || []).map((r: any) => Number(r.event_id)));
            const rows = staffEventIds.filter((id: number) => !already.has(id)).map((event_id: number) => ({ organization_id: orgId, event_id, user_id: userId, created_by: invitation.invited_by ?? null }));
            const { error: staffError } = haveError ? { error: haveError } : rows.length ? await supabase.from("aitickets_event_staff").insert(rows) : { error: null };
            if (staffError) {
                // Sin la restricción vería TODOS los eventos: se desactiva y se aborta la aceptación
                console.error("accept-invitation staff:", staffError.message);
                await supabase.from("users").update({ active: false, updated_at: new Date().toISOString() }).eq("id", userId).eq("organization_id", orgId);
                await release();
                return fail(500, "internal", "No pudimos completar tu acceso. Intenta de nuevo en unos minutos.");
            }
        }

        await supabase.from("aitickets_team_invitations").update({ accepted_user_id: userId }).eq("id", invitation.id);

        if (!signed) signed = await signIn(authClient, email, password);
        if (!signed) {
            return fail(500, "login_failed", "Tu cuenta quedó lista, pero no pudimos iniciar sesión. Ingresa en /organizadores/login.");
        }
        return { ok: true, session: signed.session, role, userId, redirectTo: homeForRole(role) };
    } catch (err) {
        await release();
        throw err;
    }
}

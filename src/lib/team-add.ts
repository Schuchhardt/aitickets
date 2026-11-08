// Alta directa de un miembro del equipo desde el panel (POST /api/team/add). Separado de la ruta para poder testearlo.
//
// El trigger on_auth_user_created (public.handle_new_user, sobre auth.users, compartido con otras apps) crea la
// fila de public.users apenas se crea la cuenta de Auth, SIN organización. Por eso, después de createUser se
// ACTUALIZA esa fila (por auth_user_id) con la organización, el rol y el nombre; solo si el trigger no la creó (se
// traga sus errores con un WARNING) se inserta. Antes se insertaba siempre: chocaba con users_email_key, respondía
// "ya registrado" (500) y dejaba al usuario huérfano (sin organización y con la cuenta de Auth viva).
//
// La organización y el rol NUNCA viajan en user_metadata para que los ponga el trigger: el mismo trigger corre en el
// registro público, donde esa metadata la escribe el usuario y cualquiera podría meterse a una organización ajena.
//
// Casos según el correo:
//  - Nuevo: cuenta de Auth con contraseña temporal + fila vinculada. Si algo falla después de createUser se revierte:
//    primero la fila de public.users y después la cuenta de Auth (users.auth_user_id referencia a auth.users sin
//    ON DELETE: con la fila presente, deleteUser falla).
//  - Huérfano (public.users sin organización): se adopta en esta organización. Solo recibe contraseña temporal si su
//    cuenta de Auth la creó AI Tickets y nunca se ha usado (nadie la conoce); si no, entra con la suya.
//  - De otra organización: 409, sin crear nada.
//  - Ya es miembro de esta organización: 409 (si está desactivado, se reactiva desde la lista).
//  - Existe en Auth pero no en AI Tickets (otra app del proyecto): 409; no se vincula sin su contraseña.
import { randomBytes } from "node:crypto";
import { isUnclaimedAuthUser } from "./team-invitations";

const AITICKETS_APP_METADATA = { app: "aitickets" } as const;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export const generateTempPassword = () => randomBytes(9).toString("base64url") + "Aa1!";

/** createUser rechazó el correo porque ya existe una cuenta de Auth con él. */
export const isAuthEmailTaken = (err: any) =>
    err?.code === "email_exists" || err?.code === "user_already_exists" || /already (been )?registered|already exists/i.test(String(err?.message || ""));

export type AddMemberInput = { name: string; email: string; role: string };
export type AddMemberResult =
    | { ok: true; userId: number; adopted: boolean; tempPassword: string | null; message: string }
    | { ok: false; status: number; code: string; message: string };

type Logger = Pick<Console, "error" | "warn">;

const fail = (status: number, code: string, message: string): AddMemberResult => ({ ok: false, status, code, message });
const internal = () => fail(500, "internal", "No pudimos agregar al miembro. Intenta de nuevo en unos minutos.");

export const OTHER_ORG_MESSAGE = "Este correo ya tiene una cuenta en otra organización de AI Tickets. Pídele que use otro correo.";

export async function addTeamMember(
    supabase: any,
    orgId: number,
    input: AddMemberInput,
    { log = console as Logger, now = new Date() }: { log?: Logger; now?: Date } = {},
): Promise<AddMemberResult> {
    const { name, email, role } = input;
    const nowIso = now.toISOString();

    const { data: rows, error: lookupError } = await supabase
        .from("users")
        .select("id, name, organization_id, auth_user_id, active")
        .ilike("email", escapeLike(email));
    if (lookupError) {
        log.error("team/add: error buscando el correo:", lookupError);
        return internal();
    }
    const matches: any[] = rows || [];
    if (matches.length > 1) {
        log.error(`team/add: ${matches.length} filas de public.users con el mismo correo (ids ${matches.map((r) => r.id).join(", ")})`);
        return fail(409, "duplicate", "Hay más de una cuenta con este correo. Escríbenos a soporte para revisarlo.");
    }
    const existing = matches[0];
    if (existing) {
        if (existing.organization_id != null) {
            if (Number(existing.organization_id) !== Number(orgId)) return fail(409, "other_org", OTHER_ORG_MESSAGE);
            return fail(
                409,
                "already_member",
                existing.active === false
                    ? "Esta persona ya es miembro del equipo, pero está desactivada: reactívala desde la lista."
                    : "Esta persona ya es miembro del equipo.",
            );
        }
        return adoptOrphan(supabase, orgId, existing, input, nowIso, log);
    }

    // Correo nuevo: cuenta de Auth (el trigger crea la fila de public.users sin organización)
    const tempPassword = generateTempPassword();
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: name },
        // Cuenta creada por AI Tickets: solo estas se pueden bloquear o cambiar de email desde el panel
        app_metadata: { ...AITICKETS_APP_METADATA },
    });
    if (createError || !created?.user?.id) {
        if (isAuthEmailTaken(createError)) {
            return fail(
                409,
                "auth_exists",
                "Este correo ya tiene una cuenta en la plataforma que no está vinculada a AI Tickets. Para sumarla, invítala por correo (así confirma con su contraseña) o usa otro correo.",
            );
        }
        log.error("team/add: createUser falló:", createError);
        return internal();
    }
    const authUserId: string = created.user.id;

    // Desde aquí, cualquier falla revierte: nunca dejar una cuenta de Auth ni una fila huérfanas
    const rollback = async (reason: unknown) => {
        log.error("team/add: se revierte el alta:", reason);
        const { error: rowError } = await supabase.from("users").delete().eq("auth_user_id", authUserId);
        if (rowError) log.error(`team/add: no se pudo borrar la fila de public.users de ${authUserId}:`, rowError);
        const { error: authError } = await supabase.auth.admin.deleteUser(authUserId);
        if (authError) log.error(`team/add: no se pudo borrar la cuenta de Auth ${authUserId}:`, authError);
    };

    try {
        const profile = { organization_id: orgId, role, name, active: true, updated_at: nowIso };
        const { data: updated, error: updateError } = await supabase
            .from("users")
            .update(profile)
            .eq("auth_user_id", authUserId)
            .is("organization_id", null)
            .select("id");
        if (updateError) throw updateError;

        let userId: number;
        if (updated?.length) {
            userId = Number(updated[0].id);
        } else {
            // El trigger no creó la fila (falló o el correo ya estaba en public.users): se inserta
            const { data: inserted, error: insertError } = await supabase
                .from("users")
                .insert({ ...profile, email, auth_user_id: authUserId })
                .select("id")
                .single();
            if (insertError) {
                if (insertError.code === "23505") {
                    // Duplicado real: alguien registró el correo entre la búsqueda y ahora
                    await rollback(insertError);
                    return fail(409, "duplicate", "Este correo electrónico ya está registrado.");
                }
                throw insertError;
            }
            userId = Number(inserted.id);
        }
        return { ok: true, userId, adopted: false, tempPassword, message: "Miembro agregado exitosamente" };
    } catch (err) {
        await rollback(err);
        return internal();
    }
}

/** Fila de public.users sin organización: se suma a esta organización con el rol pedido. */
async function adoptOrphan(supabase: any, orgId: number, existing: any, input: AddMemberInput, nowIso: string, log: Logger): Promise<AddMemberResult> {
    const { name, email, role } = input;
    const { data: adopted, error } = await supabase
        .from("users")
        .update({ organization_id: orgId, role, active: true, name: existing.name || name, updated_at: nowIso })
        .eq("id", existing.id)
        .is("organization_id", null)
        .select("id");
    if (error) {
        log.error("team/add: no se pudo adoptar al usuario sin organización:", error);
        return internal();
    }
    // Otra organización lo tomó entre la búsqueda y ahora
    if (!adopted?.length) return fail(409, "other_org", OTHER_ORG_MESSAGE);
    const userId = Number(existing.id);
    const base = { ok: true as const, userId, adopted: true };

    // Credenciales: solo si nadie conoce la contraseña de la cuenta
    if (existing.auth_user_id) {
        let authUser: any = null;
        try {
            const { data } = await supabase.auth.admin.getUserById(existing.auth_user_id);
            authUser = data?.user || null;
        } catch (err) {
            log.warn("team/add: getUserById:", err);
        }
        if (isUnclaimedAuthUser(authUser)) {
            const tempPassword = generateTempPassword();
            const { error: pwError } = await supabase.auth.admin.updateUserById(existing.auth_user_id, { password: tempPassword });
            if (!pwError) return { ...base, tempPassword, message: "Miembro agregado exitosamente" };
            log.error("team/add: no se pudo poner la contraseña temporal:", pwError);
        }
        return {
            ...base,
            tempPassword: null,
            message: "Ya tenía una cuenta en AI Tickets y quedó en tu equipo. Debe entrar con su correo y su contraseña (si no la recuerda, puede recuperarla).",
        };
    }

    // Fila antigua sin cuenta de Auth: se le crea una (el trigger no duplica la fila: el correo ya existe)
    const tempPassword = generateTempPassword();
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: existing.name || name },
        app_metadata: { ...AITICKETS_APP_METADATA },
    });
    if (!createError && created?.user?.id) {
        const { data: linked, error: linkError } = await supabase
            .from("users")
            .update({ auth_user_id: created.user.id })
            .eq("id", userId)
            .is("auth_user_id", null)
            .select("id");
        if (!linkError && linked?.length) return { ...base, tempPassword, message: "Miembro agregado exitosamente" };
        log.error("team/add: no se pudo vincular la cuenta nueva a la fila antigua:", linkError);
        const { error: delError } = await supabase.auth.admin.deleteUser(created.user.id);
        if (delError) log.error(`team/add: no se pudo borrar la cuenta de Auth ${created.user.id}:`, delError);
    } else {
        log.error("team/add: no se pudo crear la cuenta de la fila antigua:", createError);
    }
    return { ...base, tempPassword: null, message: "Quedó en tu equipo, pero no pudimos crearle acceso. Escríbenos a soporte para activarlo." };
}

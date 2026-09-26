import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { setSessionCookies } from "../../../lib/supabaseServer";
import { verifyTurnstileToken } from "../../../lib/turnstile";
import { createEphemeralAuthClient, notifySlack as sendSlack } from "../_lib/server-utils";
import type { APIRoute } from "astro";

/** Recorta y limpia un parámetro de atribución (utm/ref). */
const cleanAttr = (v: unknown, max = 200): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim().slice(0, max);
    return t || null;
};

export const prerender = false; // Ensure this endpoint is server-rendered

export const POST: APIRoute = async (context) => {
    const { request } = context;
    try {
        const data = await request.json();
        const { password, name, organizationName, phone, cfToken } = data;
        const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : data.email;
        const attribution = (data.attribution && typeof data.attribution === "object") ? data.attribution : {};
        const signupAttribution = {
            signup_utm_source: cleanAttr(attribution.utm_source),
            signup_utm_medium: cleanAttr(attribution.utm_medium),
            signup_utm_campaign: cleanAttr(attribution.utm_campaign),
            signup_ref: cleanAttr(attribution.ref),
            signup_referrer: cleanAttr(attribution.referrer, 500),
        };

        // Validate input (basic)
        if (!email || !password || !name || !organizationName) {
            return new Response(JSON.stringify({ message: "Faltan campos obligatorios" }), { status: 400 });
        }

        // Verify Turnstile Token
        const remoteip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || request.headers.get('cf-connecting-ip')
            || undefined;
        const { success: cfSuccess, message: cfMessage } = await verifyTurnstileToken({
            token: cfToken,
            remoteip,
            idempotencyKey: crypto.randomUUID(),
        });
        if (!cfSuccess) {
            return new Response(JSON.stringify({ message: cfMessage }), { status: 400 });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // 1. Crear el usuario en Auth (service role).
        // email_confirm: true permite el auto-login inmediato, pero significa que NO se verifica que el
        // registrante sea dueño del email. Como el proyecto Supabase Auth es compartido con otras apps,
        // alguien podría "ocupar" un email ajeno en Auth. Mitigación actual: la cuenta queda marcada con
        // app_metadata.app='aitickets' y el camino de recuperación (usuario de Auth ya existente) exige la
        // contraseña. Solución de fondo pendiente: verificación de email (enlace de confirmación) antes de
        // activar la cuenta.
        let userId: string;
        let createdAuthUserId: string | null = null;
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name: name,
                role: 'producer'
            },
            // Marca de cuenta creada por AI Tickets (solo estas se pueden bloquear/cambiar de email desde el dashboard)
            app_metadata: { app: 'aitickets' },
        });

        if (authError) {
            // Si el usuario ya existe en auth, intentar recuperar el registro parcial
            if (authError.message?.includes("already") || authError.message?.includes("registered")) {
                // Verificar si ya tiene perfil completo
                const { data: existingUser } = await supabaseAdmin
                    .from('users')
                    .select('id')
                    .eq('email', email)
                    .maybeSingle();

                if (existingUser) {
                    return new Response(JSON.stringify({ message: "Este correo electrónico ya está registrado. Intenta iniciar sesión." }), { status: 400 });
                }

                // Usuario en auth pero sin perfil (registro parcial previo o cuenta de otra app del mismo
                // proyecto Supabase): solo se completa el registro si la contraseña coincide.
                const { data: verifyData, error: verifyError } = await createEphemeralAuthClient().auth.signInWithPassword({ email, password });
                if (verifyError || !verifyData.user) {
                    return new Response(JSON.stringify({ message: "Este correo electrónico ya está registrado. Intenta iniciar sesión." }), { status: 400 });
                }
                userId = verifyData.user.id;
            } else {
                return new Response(JSON.stringify({ message: getFriendlyErrorMessage(authError) }), { status: 400 });
            }
        } else if (!authData.user) {
            return new Response(JSON.stringify({ message: "No se pudo crear el usuario" }), { status: 500 });
        } else {
            userId = authData.user.id;
            createdAuthUserId = authData.user.id;
        }

        // Si un paso posterior falla, no dejar una cuenta de Auth recién creada sin perfil
        const rollbackAuthUser = async () => {
            if (!createdAuthUserId) return;
            const { error } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
            if (error) console.error("No se pudo revertir el usuario de Auth:", error.message);
        };

        // 2. Crear SIEMPRE una organización nueva. No se reutilizan organizaciones por email: el email de la
        // organización no prueba propiedad y reutilizarla permitiría tomar control de datos ajenos.
        let orgId: number;
        {
            const orgBase = { public_name: organizationName, email: email, phone: phone };
            let { data: orgData, error: orgError } = await supabaseAdmin
                .from('organizations')
                .insert({ ...orgBase, ...signupAttribution })
                .select('id')
                .single();

            // Si la migración de atribución (20260926_C_dashboard) aún no está aplicada, crear sin esas columnas
            if (orgError && /signup_/.test(orgError.message || '')) {
                console.warn("Columnas signup_* no existen; se crea la organización sin atribución");
                ({ data: orgData, error: orgError } = await supabaseAdmin
                    .from('organizations')
                    .insert(orgBase)
                    .select('id')
                    .single());
            }

            if (orgError) {
                console.error("Error creating org:", orgError);
                await rollbackAuthUser();
                return new Response(JSON.stringify({ message: "Error al crear la organización: " + getFriendlyErrorMessage(orgError) }), { status: 500 });
            }
            orgId = orgData!.id;
        }

        // 3. Create Public User Linked using Admin Client (skip if already exists)
        const { data: existingProfile } = await supabaseAdmin
            .from('users')
            .select('id, organization_id')
            .eq('auth_user_id', userId)
            .maybeSingle();

        if (!existingProfile) {
            const { error: userError } = await supabaseAdmin
                .from('users')
                .insert({
                    auth_user_id: userId,
                    organization_id: orgId,
                    name: name,
                    email: email,
                    phone: phone,
                    role: 'producer',
                    active: true
                });

            if (userError) {
                console.error("Error creating public user:", userError);
                await supabaseAdmin.from('organizations').delete().eq('id', orgId);
                await rollbackAuthUser();
                return new Response(JSON.stringify({ message: "Error al crear perfil de usuario: " + getFriendlyErrorMessage(userError) }), { status: 500 });
            }
        } else if (existingProfile.organization_id) {
            // La cuenta ya tiene una organización: no crear otra
            await supabaseAdmin.from('organizations').delete().eq('id', orgId);
            return new Response(JSON.stringify({ message: "Este correo electrónico ya está registrado. Intenta iniciar sesión." }), { status: 400 });
        } else {
            // Perfil existe pero sin organización (registro parcial previo), actualizar
            const { error: updateError } = await supabaseAdmin
                .from('users')
                .update({ organization_id: orgId, name, phone })
                .eq('id', existingProfile.id);

            if (updateError) {
                console.error("Error updating user profile:", updateError);
                await supabaseAdmin.from('organizations').delete().eq('id', orgId);
                return new Response(JSON.stringify({ message: "Error al actualizar perfil de usuario: " + getFriendlyErrorMessage(updateError) }), { status: 500 });
            }
        }

        // Auto-login: obtener sesión para el nuevo usuario
        const supabaseLogin = createEphemeralAuthClient();
        const { data: loginData, error: loginError } = await supabaseLogin.auth.signInWithPassword({
            email,
            password,
        });

        if (loginError || !loginData.session) {
            // Registro exitoso pero auto-login falló, redirigir al login manual
            return new Response(JSON.stringify({ message: "Registro exitoso", redirect: "/organizadores/login" }), { status: 200 });
        }

        setSessionCookies(context, loginData.session.access_token, loginData.session.refresh_token);

        // Notificar en Slack sobre nuevo productor
        await notifySlack({ name, email, phone, organizationName, attribution: signupAttribution }).catch(err =>
            console.error("Error al notificar a Slack:", err.message)
        );

        return new Response(JSON.stringify({ message: "Registro exitoso", redirect: "/dashboard", userId }), { status: 200 });

    } catch (error) {
        console.error("Server error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};

async function notifySlack({ name, email, phone, organizationName, attribution }: {
    name: string; email: string; phone?: string; organizationName: string;
    attribution: Record<string, string | null>;
}) {
    const source = [attribution.signup_utm_source, attribution.signup_utm_medium, attribution.signup_utm_campaign]
        .filter(Boolean).join(" / ");
    const lines = [
        `🎉 *Nuevo productor registrado*`,
        `• *Nombre:* ${name}`,
        `• *Email:* ${email}`,
        `• *Teléfono:* ${phone || "No proporcionado"}`,
        `• *Organización:* ${organizationName || "No proporcionada"}`,
    ];
    if (source) lines.push(`• *UTM:* ${source}`);
    if (attribution.signup_ref) lines.push(`• *Ref:* ${attribution.signup_ref}`);
    if (attribution.signup_referrer) lines.push(`• *Referrer:* ${attribution.signup_referrer}`);
    await sendSlack(lines.join("\n"));
}

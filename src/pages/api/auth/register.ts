import { getSupabaseAdmin, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { verifyTurnstileToken } from "../../../lib/turnstile";
import { verifyLeadToken } from "../../../lib/lead-token";
import { ensureOrgSite } from "../../../lib/sites";
import { sendVerificationEmail } from "../../../lib/email-verification";
import { TERMS_VERSION } from "../../../lib/legal";
import { createEphemeralAuthClient, notifySlack as sendSlack } from "../_lib/server-utils";
import type { APIRoute } from "astro";

/** Recorta y limpia un parámetro de atribución (utm/ref). */
const cleanAttr = (v: unknown, max = 200): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim().slice(0, max);
    return t || null;
};

export const prerender = false; // Ensure this endpoint is server-rendered

// Registro de productores (WP7):
// - Exige aceptar los Términos para productores (acceptedTerms === true); se guarda la versión aceptada.
// - La cuenta de Auth se crea SIN confirmar y NO se inicia sesión: se envía un enlace firmado
//   (EMAIL_VERIFY_SECRET, 48 h) y /api/auth/login rechaza el ingreso hasta verificar.
// - Si viene un leadToken válido (enlace del outreach / formulario /web-gratis), el lead queda
//   'converted' y la atribución es signup_ref = 'lead_<id>'.
// - Crea el sitio gratis de la organización (ensureOrgSite); nunca bloquea el registro si falla.
// Respuesta: { ok: true, needsVerification: true, emailSent, message }.

export const POST: APIRoute = async (context) => {
    const { request } = context;
    try {
        const data = await request.json();
        const { password, name, organizationName, phone, cfToken } = data;
        const acceptedTerms = data.acceptedTerms === true;
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
        if (!acceptedTerms) {
            return new Response(JSON.stringify({ message: "Debes aceptar los Términos para productores y la Política de Privacidad." }), { status: 400 });
        }

        // Lead del outreach / formulario "web gratis": solo con token firmado válido
        const lead = typeof data.leadToken === "string" && data.leadToken ? verifyLeadToken(data.leadToken) : null;
        if (lead) signupAttribution.signup_ref = `lead_${lead.leadId}`.slice(0, 200);

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

        // 1. Crear el usuario en Auth (service role) SIN confirmar el correo: la cuenta se activa con el
        // enlace de verificación. El camino de recuperación (usuario de Auth ya existente, p. ej. de otra
        // app del proyecto compartido) exige la contraseña, y la organización igual queda sin verificar.
        let userId: string;
        let createdAuthUserId: string | null = null;
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: false,
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
            const termsFields = { terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString() };
            let { data: orgData, error: orgError } = await supabaseAdmin
                .from('organizations')
                .insert({ ...orgBase, ...signupAttribution, ...termsFields })
                .select('id')
                .single();

            // Preview sin la migración 202609270400: crear sin las columnas de términos
            if (orgError && /terms_/.test(orgError.message || '')) {
                console.warn("Columnas terms_* no existen; se crea la organización sin registrar la aceptación");
                ({ data: orgData, error: orgError } = await supabaseAdmin
                    .from('organizations')
                    .insert({ ...orgBase, ...signupAttribution })
                    .select('id')
                    .single());
            }

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

        // 4. Sitio gratis de la organización (/o/<slug>). Se muestra recién cuando verifique el correo.
        try {
            await ensureOrgSite(orgId, organizationName);
        } catch (err: any) {
            console.error("No se pudo crear el sitio de la organización:", err?.message || err);
        }

        // 5. Lead convertido (outreach / formulario web gratis)
        if (lead) {
            await convertLead(lead.leadId, orgId).catch((err) =>
                console.error("No se pudo marcar el lead como convertido:", err?.message || err)
            );
        }

        // 6. Correo de verificación. Si falla, la cuenta queda creada y se puede reenviar desde el login.
        let emailSent = false;
        try {
            await sendVerificationEmail({ uid: userId, email, name });
            emailSent = true;
        } catch (err: any) {
            console.error("No se pudo enviar el correo de verificación:", err?.message || err);
        }

        // Notificar en Slack sobre nuevo productor
        await notifySlack({ name, email, phone, organizationName, attribution: signupAttribution, emailSent }).catch(err =>
            console.error("Error al notificar a Slack:", err.message)
        );

        return new Response(JSON.stringify({
            ok: true,
            needsVerification: true,
            emailSent,
            message: emailSent
                ? "Cuenta creada. Te enviamos un correo para confirmar tu dirección."
                : "Cuenta creada, pero no pudimos enviar el correo de confirmación. Puedes reenviarlo desde el inicio de sesión.",
        }), { status: 200 });

    } catch (error) {
        console.error("Server error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};

/** Marca el lead como convertido (organization_id, consent_at se conserva si ya existía). */
async function convertLead(leadId: string, orgId: number) {
    const supabase = getSupabaseAdmin();
    const { data: row, error: readError } = await supabase
        .from("aitickets_leads")
        .select("id, consent_at")
        .eq("id", leadId)
        .maybeSingle();
    if (readError) throw readError;
    if (!row) return;
    const now = new Date().toISOString();
    const { error } = await supabase
        .from("aitickets_leads")
        .update({ status: "converted", organization_id: orgId, consent_at: row.consent_at || now, updated_at: now })
        .eq("id", leadId);
    if (error) throw error;
}

async function notifySlack({ name, email, phone, organizationName, attribution, emailSent }: {
    name: string; email: string; phone?: string; organizationName: string;
    attribution: Record<string, string | null>; emailSent: boolean;
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
    lines.push(emailSent ? `• Correo de verificación enviado` : `• ⚠️ No se pudo enviar el correo de verificación`);
    await sendSlack(lines.join("\n"));
}

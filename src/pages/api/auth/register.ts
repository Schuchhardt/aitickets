import { getSupabaseAdmin, getSupabaseAnon, getFriendlyErrorMessage } from "../../../lib/auth-helpers";
import { verifyTurnstileToken } from "../../../lib/turnstile";

export const prerender = false; // Ensure this endpoint is server-rendered

export const POST = async ({ request }) => {
    try {
        const data = await request.json();
        const { email, password, name, organizationName, phone, cfToken } = data;

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

        // Initialize Supabase Clients using Helpers
        const supabaseAnon = getSupabaseAnon();
        const supabaseAdmin = getSupabaseAdmin();

        // 1. SignUp in Auth using Anon Client
        let userId: string;
        const { data: authData, error: authError } = await supabaseAnon.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: name,
                    role: 'producer'
                }
            }
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

                // Usuario en auth pero sin perfil: buscar su auth_user_id para completar el registro
                const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers();
                const existingAuthUser = authUsers?.find(u => u.email === email);
                if (!existingAuthUser) {
                    return new Response(JSON.stringify({ message: "Error al recuperar usuario. Contacta soporte." }), { status: 500 });
                }
                userId = existingAuthUser.id;
            } else {
                return new Response(JSON.stringify({ message: getFriendlyErrorMessage(authError) }), { status: 400 });
            }
        } else if (!authData.user) {
            return new Response(JSON.stringify({ message: "No se pudo crear el usuario" }), { status: 500 });
        } else {
            // Supabase puede retornar un user sin identities si ya existe (email no confirmado)
            if (authData.user.identities?.length === 0) {
                const { data: existingUser } = await supabaseAdmin
                    .from('users')
                    .select('id')
                    .eq('email', email)
                    .maybeSingle();

                if (existingUser) {
                    return new Response(JSON.stringify({ message: "Este correo electrónico ya está registrado. Intenta iniciar sesión." }), { status: 400 });
                }
                userId = authData.user.id;
            } else {
                userId = authData.user.id;
            }
        }

        // 2. Create Organization using Admin Client (skip if already exists for this email)
        let orgId: number;
        const { data: existingOrg } = await supabaseAdmin
            .from('organizations')
            .select('id')
            .eq('email', email)
            .maybeSingle();

        if (existingOrg) {
            orgId = existingOrg.id;
        } else {
            const { data: orgData, error: orgError } = await supabaseAdmin
                .from('organizations')
                .insert({
                    public_name: organizationName,
                    email: email,
                    phone: phone
                })
                .select()
                .single();

            if (orgError) {
                console.error("Error creating org:", orgError);
                return new Response(JSON.stringify({ message: "Error al crear la organización: " + getFriendlyErrorMessage(orgError) }), { status: 500 });
            }
            orgId = orgData.id;
        }

        // 3. Create Public User Linked using Admin Client (skip if already exists)
        const { data: existingProfile } = await supabaseAdmin
            .from('users')
            .select('id')
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
                return new Response(JSON.stringify({ message: "Error al crear perfil de usuario: " + getFriendlyErrorMessage(userError) }), { status: 500 });
            }
        }

        // Notificar en Slack sobre nuevo productor
        notifySlack({ name, email, phone, organizationName }).catch(err =>
            console.error("Error al notificar a Slack:", err.message)
        );

        return new Response(JSON.stringify({ message: "Registro exitoso", userId: authData.user.id }), { status: 200 });

    } catch (error) {
        console.error("Server error:", error);
        return new Response(JSON.stringify({ message: "Error interno del servidor" }), { status: 500 });
    }
};

async function notifySlack({ name, email, phone, organizationName }: { name: string; email: string; phone?: string; organizationName: string }) {
    const webhookUrl = import.meta.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
        console.warn("SLACK_WEBHOOK_URL no configurado, omitiendo notificación");
        return;
    }

    const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            text: `🎉 *Nuevo productor registrado*\n• *Nombre:* ${name}\n• *Email:* ${email}\n• *Teléfono:* ${phone || "No proporcionado"}\n• *Organización:* ${organizationName || "No proporcionada"}`
        })
    });

    if (!res.ok) {
        throw new Error(`Slack respondió con status ${res.status}`);
    }
}

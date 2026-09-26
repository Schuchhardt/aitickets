import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Todo el acceso a Supabase es server-side con la service role key.
// La service role se salta RLS, así que TODA ruta debe autorizar explícitamente
// (sesión + organización) antes de leer o escribir datos de un productor.
// El proyecto de Supabase es compartido con otras apps: filtrar siempre por
// organization_id / event_id y nunca hacer consultas sin filtro sobre tablas de aitickets.
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
    if (adminClient) return adminClient;

    const supabaseUrl = import.meta.env.SUPABASE_URL;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        throw new Error("Missing Supabase credentials (URL or Service Role Key)");
    }

    adminClient = createClient(supabaseUrl, serviceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
    return adminClient;
}

/**
 * Cliente service role NUEVO (no singleton) para operaciones de auth que crean o refrescan una
 * sesión de usuario (signInWithPassword, refreshSession). supabase-js guarda esa sesión en memoria
 * y, si se hiciera sobre el singleton, las consultas siguientes saldrían con el JWT del usuario
 * (sujeto a RLS) en vez de la service role, mezclando sesiones entre requests.
 */
export function createEphemeralAuthClient(): SupabaseClient {
    const supabaseUrl = import.meta.env.SUPABASE_URL;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        throw new Error("Missing Supabase credentials (URL or Service Role Key)");
    }
    return createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
}

export function getFriendlyErrorMessage(error: any): string {
    if (!error) return "Error desconocido";

    const msg = error.message || "";
    const code = error.code || "";

    // Auth Errors
    if (msg.includes("User already registered") || msg.includes("already has been registered")) {
        return "Este correo electrónico ya está registrado.";
    }
    if (msg.includes("Signup requires a valid password")) {
        return "La contraseña no cumple con los requisitos de seguridad.";
    }
    if (msg.includes("Invalid login credentials")) {
        return "Correo electrónico o contraseña incorrectos.";
    }

    // Postgres Errors (via Supabase)
    // 23505 = unique_violation
    if (code === '23505') {
        if (msg.includes("users_email_key")) return "Este correo electrónico ya está registrado.";
        if (msg.includes("organizations_public_name_key")) return "El nombre de la organización ya existe.";
        return "Este registro ya existe (duplicado).";
    }

    // Rate Limits
    if (msg.includes("rate limit") || code === '429') {
        return "Demasiados intentos. Por favor espera unos minutos.";
    }

    return msg;
}

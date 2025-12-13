import { createClient } from "@supabase/supabase-js";

export function getSupabaseAnon() {
    const supabaseUrl = import.meta.env.SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
    const anonKey = import.meta.env.SUPABASE_ANON_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
        throw new Error("Missing Supabase credentials (URL or Anon Key)");
    }

    return createClient(supabaseUrl, anonKey);
}

export function getSupabaseAdmin() {
    const supabaseUrl = import.meta.env.SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        throw new Error("Missing Supabase credentials (URL or Service Role Key)");
    }

    return createClient(supabaseUrl, serviceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
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

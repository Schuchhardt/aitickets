
import { createClient } from "@supabase/supabase-js";
import type { AstroGlobal } from 'astro';

export const createSupabaseServerClient = (context: Pick<AstroGlobal, 'cookies'>) => {
    const accessToken = context.cookies.get("sb-access-token")?.value;
    const refreshToken = context.cookies.get("sb-refresh-token")?.value;

    const supabaseUrl = import.meta.env.SUPABASE_URL;
    const supabaseKey = import.meta.env.SUPABASE_ANON_KEY;

    const options: any = {};

    if (accessToken) {
        options.global = {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        };
    }

    const supabase = createClient(supabaseUrl, supabaseKey, options);

    return supabase;
};

export const getSessionUser = async (context: Pick<AstroGlobal, 'cookies'>) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) return null;
    return user;
}

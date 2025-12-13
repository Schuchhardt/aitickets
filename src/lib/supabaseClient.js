import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

// Debug: Verifica que las variables de entorno estén bien configuradas
console.log("🔍 SUPABASE_URL:", supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

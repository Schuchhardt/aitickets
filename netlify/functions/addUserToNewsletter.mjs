import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

// Configurar Supabase
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configurar MailerLite
const mailerLiteApiKey = process.env.MAILERLITE_API_TOKEN;
const mailerLiteGroupId = process.env.MAILERLITE_GROUP_ID; // Opcional

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), { status: 405 });
  }

  try {
    const { email, language, timezone, userAgent, referrer } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ message: 'Email requerido' }), { status: 400 });
    }

    // Obtener IP y país desde Netlify Context
    const userIp = context.ip || '0.0.0.0';
    const country = context.geo?.country?.name || 'Desconocido';

    // Verificar si el correo ya está registrado en Supabase
    const { data: existingUser, error: fetchError } = await supabase
      .from('newsletter')
      .select('email')
      .eq('email', email)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      return new Response(JSON.stringify({
        message: 'Ha ocurrido un error, intenta más tarde',
        error: fetchError.message
      }), { status: 500 });
    }

    if (existingUser) {
      return new Response(JSON.stringify({
        message: 'Ya estás registrado',
        error: 'Correo duplicado en Supabase'
      }), { status: 400 });
    }

    // Insertar en Supabase
    const { error: insertError } = await supabase
      .from('newsletter')
      .insert([{ 
        email, 
        ip: userIp, 
        country, 
        language, 
        timezone, 
        userAgent, 
        referrer // Guardamos referrer o UTM en un solo campo
      }]);

    if (insertError) {
      return new Response(JSON.stringify({
        message: 'Ha ocurrido un error, intenta más tarde',
        error: insertError.message
      }), { status: 500 });
    }

    // Enviar a MailerLite
    const mailerLiteResponse = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mailerLiteApiKey}`,
      },
      body: JSON.stringify({
        email,
        groups: mailerLiteGroupId ? [mailerLiteGroupId] : [],
        fields: { 
          country, 
          ip_address: userIp, 
          language, 
          timezone, 
          user_agent: userAgent, 
          tracking_source: trackingSource
        },
      }),
    });

    const mailerLiteData = await mailerLiteResponse.json();

    if (!mailerLiteResponse.ok) {
      return new Response(JSON.stringify({
        message: 'Ha ocurrido un error, intenta más tarde',
        error: mailerLiteData
      }), { status: 500 });
    }

    return new Response(
      JSON.stringify({
        message: 'Correo agregado y registrado en MailerLite con éxito',
        email,
        ip: userIp,
        country,
        language,
        timezone,
        userAgent,
        trackingSource
      }),
      { status: 200 }
    );
  } catch (error) {
    return new Response(JSON.stringify({
      message: 'Ha ocurrido un error, intenta más tarde',
      error: error.message
    }), { status: 500 });
  }
}

// 📌 Definir rutas personalizadas
export const config = {
  path: ['/api/newsletter', '/api/subscribe'],
};

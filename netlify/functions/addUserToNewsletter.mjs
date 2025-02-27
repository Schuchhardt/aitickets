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
    const { email } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ message: 'Email requerido' }), { status: 400 });
    }

    // Obtener IP y país desde Netlify Context
    const userIp = context.ip || '0.0.0.0';
    const country = context.geo?.country?.name || 'Desconocido';

    // Guardar en Supabase
    const { error } = await supabase
      .from('newsletter')
      .insert([{ email, ip: userIp, country }]);

    if (error) {
      return new Response(JSON.stringify({ message: 'Error guardando en Supabase', error }), { status: 500 });
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
        groups: mailerLiteGroupId ? [mailerLiteGroupId] : [], // Opcional
        fields: { country, ip_address: userIp },
      }),
    });

    const mailerLiteData = await mailerLiteResponse.json();

    if (!mailerLiteResponse.ok) {
      return new Response(JSON.stringify({ message: 'Error en MailerLite', error: mailerLiteData }), { status: 500 });
    }

    return new Response(
      JSON.stringify({
        message: 'Correo agregado y registrado en MailerLite con éxito',
        email,
        ip: userIp,
        country,
      }),
      { status: 200 }
    );
  } catch (error) {
    return new Response(JSON.stringify({ message: 'Error en el servidor', error: error.message }), { status: 500 });
  }
}

// 📌 Definir rutas personalizadas
export const config = {
  path: ['/api/newsletter', '/subscribe'],
};

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const flowApiKey = process.env.FLOW_API_KEY;
const flowApiUrl = process.env.FLOW_BASE_URL + '/payment/getStatus';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), { status: 405 });
  }
  console.log("payment-confirmation");
  try {
    const formData = await req.formData();
    const token = formData.get('token');
    console.log("token", token);
    if (!token) {
      return new Response(JSON.stringify({ message: 'Token no recibido' }), { status: 400 });
    }

    // Construir la URL con el parámetro 'token'
    const url = new URL(flowApiUrl);
    url.searchParams.append('token', token);

    // Consultar el estado del pago en Flow
    const flowResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'ApiKey': flowApiKey,
      },
    });

    const paymentStatus = await flowResponse.json();

    if (!flowResponse.ok) {
      return new Response(JSON.stringify({ message: 'Error al consultar estado de pago en Flow', error: paymentStatus }), { status: 500 });
    }

    console.log("paymentStatus", paymentStatus);
    // Extraer datos relevantes
    const {
      commerceOrder,
      status,
      amount,
      fee,
      paymentData,
    } = paymentStatus;

    // Solo procesar si el pago fue exitoso
    if (status !== 1) {
      return new Response(JSON.stringify({ message: 'Pago no confirmado aún', status }), { status: 200 });
    }

    // Actualizar la orden en Supabase
    const { error: updateError } = await supabase
      .from('event_orders')
      .update({
        status: 'paid',
        total_payment: amount,
        payment_fee: fee,
        payment_commerce_id: paymentData?.commerceId || null,
      })
      .eq('id', commerceOrder); // commerceOrder es el UUID original enviado a Flow

    if (updateError) {
      return new Response(JSON.stringify({ message: 'Error al actualizar orden en Supabase', error: updateError.message }), { status: 500 });
    }

    // Responder a Flow (aunque no lo requiere, es buena práctica)
    return new Response(JSON.stringify({ message: 'Pago confirmado y orden actualizada' }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: 'Error interno', error: error.message }), { status: 500 });
  }
}

export const config = {
  path: ['/api/payment-confirmation'],
};

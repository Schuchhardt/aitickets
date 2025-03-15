import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const flowApiKey = process.env.FLOW_API_KEY;
const flowApiSecret = process.env.FLOW_SECRET_KEY;
const flowApiUrl = process.env.FLOW_BASE_URL + '/payment/getStatus';

/**
 * Firma los parámetros usando HMAC-SHA256 con secretKey
 * @param {Object} params - Objeto con los parámetros (sin incluir la firma "s")
 * @param {string} secretKey - Clave secreta para firmar
 * @returns {string} - Firma generada (hash HMAC-SHA256 en hexadecimal)
 */
function generateSignature(params, secretKey) {
  // 1. Claves ordenadas alfabéticamente
  const keys = Object.keys(params).filter(key => key !== 's').sort();

  // 2. Concatenar en formato nombre + valor
  const stringToSign = keys.map(key => key + params[key]).join('');

  // 3. Firmar con HMAC-SHA256
  // 3. Generar HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(stringToSign);
  const signature = hmac.digest('hex');

  return signature;
}
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

    const signature = generateSignature({ apiKey, token }, flowApiSecret);

    // Construir la URL con el parámetro 'token'
    const url = flowApiUrl + `?apiKey=${apiKey}&token=${token}&s=${signature}`;

    // Consultar el estado del pago en Flow
    const flowResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const paymentStatus = await flowResponse.json();

    console.log("paymentStatus", paymentStatus);
    
    if (!flowResponse.ok) {
      return new Response(JSON.stringify({ message: 'Error al consultar estado de pago en Flow', error: paymentStatus }), { status: 500 });
    }

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
    console.error('Error en payment-confirmation:', error);
    return new Response(JSON.stringify({ message: 'Error interno', error: error.message }), { status: 500 });
  }
}

export const config = {
  path: ['/api/payment-confirmation'],
};

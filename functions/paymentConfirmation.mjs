import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fetch from 'node-fetch';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const flowApiKey = process.env.FLOW_API_KEY;
const flowApiSecret = process.env.FLOW_SECRET_KEY;
const flowApiUrl = process.env.FLOW_BASE_URL + '/payment/getStatus';

function generateSignature(params, secretKey) {
  const keys = Object.keys(params).filter(key => key !== 's').sort();
  const stringToSign = keys.map(key => key + params[key]).join('');
  return crypto.createHmac('sha256', secretKey).update(stringToSign).digest('hex');
}

export const handler = async (event) => {
  if (event.requestContext.http.method !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Método no permitido' }),
    };
  }

  try {
    let token = event.queryStringParameters?.token;

    if (!token) {
      const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    
      const bodyString = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf-8')
        : event.body;
    
      if (contentType && contentType.includes('application/x-www-form-urlencoded')) {
        const bodyParams = new URLSearchParams(bodyString);
        token = bodyParams.get('token');
      } else {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: 'Tipo de contenido no soportado' }),
        };
      }
    }
    
    if (!token) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Token no recibido' }),
      };
    }
    

    const signature = generateSignature({ apiKey: flowApiKey, token }, flowApiSecret);
    const url = `${flowApiUrl}?apiKey=${flowApiKey}&token=${token}&s=${signature}`;
    const flowResponse = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    const paymentStatus = await flowResponse.json();

    if (!flowResponse.ok) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Error al consultar Flow', error: paymentStatus }) };
    }

    const { commerceOrder, status, amount, paymentData } = paymentStatus;
    if (status !== 2) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Pago no confirmado aún', status }) };
    }

    const { data: orderData, error: orderError } = await supabase
      .from('event_orders')
      .select('event_id, attendee_id, ticket_details')
      .eq('id', commerceOrder)
      .maybeSingle();

    if (orderError || !orderData) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Error buscando orden', error: orderError?.message }) };
    }

    const { event_id, attendee_id, ticket_details } = orderData;

    const { error: updateError } = await supabase
      .from('event_orders')
      .update({
        status: 'paid',
        total_payment: amount,
        payment_fee: parseInt(paymentData.fee, 10),
        balance: paymentData.balance,
        payment_commerce_id: paymentData.media,
      })
      .eq('id', commerceOrder);

    if (updateError) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Error actualizando orden', error: updateError.message }) };
    }

    const eventAttendees = [];
    ticket_details.forEach(ticket => {
      for (let i = 0; i < ticket.quantity; i++) {
        const uniqueHash = crypto.createHash('sha256')
          .update(`${attendee_id}-${event_id}-${ticket.id}-${Date.now()}-${i}`)
          .digest('hex');

        eventAttendees.push({
          event_id,
          event_ticket_id: parseInt(ticket.id, 10),
          attendee_id,
          qr_code: uniqueHash,
          is_complimentary: false,
          status: 'active',
          event_order_id: commerceOrder,
        });
      }
    });

    const { data: eventTickets ,error: insertError } = await supabase.from('event_attendees').insert(eventAttendees);
    if (insertError) {
      return { statusCode: 500, body: JSON.stringify({ message: 'Error insertando entradas', error: insertError.message }) };
    }

    console.log('Entradas registradas:', eventTickets);

    return { statusCode: 200, body: JSON.stringify({ message: 'Pago confirmado y entradas registradas' }) };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ message: 'Error interno', error: error.message }) };
  }
};

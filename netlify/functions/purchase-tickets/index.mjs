import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fetch from 'node-fetch';

// Configurar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configurar Flow
const flowApiKey = process.env.FLOW_API_KEY;
const flowApiSecret = process.env.FLOW_SECRET_KEY;
const flowApiUrl = process.env.FLOW_BASE_URL;

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

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), { status: 405 });
  }

  try {
    const { buyer, tickets, total, eventId } = await req.json();

    if (!buyer?.email || !tickets?.length) {
      return new Response(JSON.stringify({ message: 'Datos incompletos' }), { status: 400 });
    }

    // Verificar si el asistente ya existe
    const { data: existingAttendee, error: fetchError } = await supabase
      .from('attendees')
      .select('id')
      .eq('email', buyer.email)
      .single();

    let attendeeId = existingAttendee?.id;

    if (fetchError && fetchError.code !== 'PGRST116') {
      return new Response(JSON.stringify({ message: 'Error al verificar usuario', error: fetchError.message }), { status: 500 });
    }
    console.log('👤 Asistente existente:', attendeeId);
    // Insertar asistente si no existe
    if (!attendeeId) {
      const { data: newAttendee, error: insertError } = await supabase
        .from('attendees')
        .insert([{
          first_name: buyer.firstName,
          last_name: buyer.lastName,
          email: buyer.email,
          phone: buyer.phone,
        }])
        .select()
        .single();

      if (insertError) {
        return new Response(JSON.stringify({ message: 'Error al registrar usuario', error: insertError.message }), { status: 500 });
      }

      attendeeId = newAttendee.id;
    } else{
      console.log('👤 Asistente nuevo:', attendeeId);
    }

    // Si el evento es gratuito, registrar qr como asistentes y devolver el `id` para redirigir a la página de entrada
    if (total === 0) {
      // Insertar entradas en event_attendees con QR único y UUID
      const eventAttendees = tickets.map(ticket => {
        const uniqueHash = crypto.createHash('sha256')
          .update(`${attendeeId}-${eventId}-${ticket.id}-${Date.now()}`)
          .digest('hex');

        return {
          event_id: eventId,
          event_ticket_id: parseInt(ticket.id,10),
          attendee_id: attendeeId,
          qr_code: uniqueHash,
          is_complimentary: true,
          status: 'active',
        };
      });
      console.log('Registrando entradas:', eventAttendees);
      const { data: insertedTickets, error: insertTicketsError } = await supabase
        .from('event_attendees')
        .insert(eventAttendees)
        .select();

      if (insertTicketsError) {
        return new Response(JSON.stringify({ message: 'Error al registrar entradas', error: insertTicketsError.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ ticketId: insertedTickets[0].id, message: 'Registro completado' }), { status: 200 });
    } else {
      console.log('Creando orden de pago');
      // Crear una orden en la base de datos para eventos pagados
      const { data: newOrder, error: orderError } = await supabase
        .from('event_orders')
        .insert([{
          status: 'pending',
          event_id: eventId,
          attendee_id: attendeeId,
          amount: total,
          ticket_qty: tickets.length,
          ticket_details: tickets,
        }])
        .select()
        .single();
      
      console.log('Orden creada:', newOrder);
      
      if (orderError) {
        console.log('Error al crear la orden:', orderError.message);
        return new Response(JSON.stringify({ message: 'Error al crear la orden', error: orderError.message }), { status: 500 });
      }

      // Generar una orden de pago en Flow
      const flowOrderData = {
        apiKey: flowApiKey,
        paymentMethod: 1, // 1: Webpay, 2: Multicaja, 3: Servipag, 4: Cryptocompra
        commerceOrder: newOrder.id, // ID único de la orden en tu sistema
        subject: `Pago de entradas para el evento ${eventId}`,
        currency: 'CLP',
        amount: total,
        email: buyer.email,
        urlConfirmation: `${process.env.SITE_URL}/api/payment-success`, // URL para recibir confirmaciones de Flow
        urlReturn: `${process.env.SITE_URL}/payment-confirmation`, // URL a la que se redirige al usuario después del pago
      };
      console.log('🔗 Orden de pago:', flowOrderData);
      // Firmar la solicitud según la documentación de Flow
      const signature = generateSignature(flowOrderData, flowApiSecret);
      console.log('🔑 Firma:', signature);
      const flowResponse = await fetch(`${flowApiUrl}/payment/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          ...flowOrderData,
          s: signature,
        }),
      });
      const flowData = await flowResponse.json();
      console.log('🔗 Respuesta de Flow:', flowData);

      if (!flowResponse.ok) {
        return new Response(JSON.stringify({ message: 'Error al crear la orden de pago en Flow', error: flowData }), { status: 500 });
      }

      // Actualizar la orden con el ID de la orden de Flow
      const { error: updateOrderError } = await supabase
        .from('event_orders')
        .update({ payment_external_id: flowData.flowOrder })
        .eq('id', newOrder.id);

      if (updateOrderError) {
        return new Response(JSON.stringify({ message: 'Error al actualizar la orden con el ID de Flow', error: updateOrderError.message }), { status: 500 });
      }

      // Devolver la URL de pago al cliente
      return new Response(JSON.stringify({ paymentLink: flowData.url + '?token=' + flowData.token, message: 'Redirigiendo a pago' }), { status: 200 });
    }

  } catch (error) {
    return new Response(JSON.stringify({ message: 'Error interno', error: error.message }), { status: 500 });
  }
}

// Definir rutas personalizadas
export const config = {
  path: ['/api/purchase-ticket'],
};

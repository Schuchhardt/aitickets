import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fetch from 'node-fetch';

// Configurar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configurar Flow
const flowApiKey = process.env.FLOW_API_KEY;
const flowApiSecret = process.env.FLOW_API_SECRET;
const flowApiUrl = 'https://www.flow.cl/api'; // URL base de la API de Flow
//https://sandbox.flow.cl/api

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
    }

    // Insertar entradas en event_attendees con QR único y UUID
    const eventAttendees = tickets.map(ticket => {
      const uniqueHash = crypto.createHash('sha256')
        .update(`${attendeeId}-${eventId}-${ticket.id}-${Date.now()}`)
        .digest('hex');

      return {
        event_id: eventId,
        event_ticket_id: ticket.id,
        attendee_id: attendeeId,
        qr_code: uniqueHash,
        is_complimentary: ticket.price === 0,
        status: 'active',
      };
    });

    const { data: insertedTickets, error: insertTicketsError } = await supabase
      .from('event_attendees')
      .insert(eventAttendees)
      .select();

    if (insertTicketsError) {
      return new Response(JSON.stringify({ message: 'Error al registrar entradas', error: insertTicketsError.message }), { status: 500 });
    }

    // Si el evento es gratuito, devolver el `id` para redirigir a la página de entrada
    if (total === 0) {
      return new Response(JSON.stringify({ ticketId: insertedTickets[0].id, message: 'Registro completado' }), { status: 200 });
    } else {
      // Crear una orden en la base de datos para eventos pagados
      const { data: newOrder, error: orderError } = await supabase
        .from('event_orders')
        .insert([{
          status: 'pending',
          event_id: eventId,
          attendee_id: attendeeId,
          amount: total,
          ticket_qty: tickets.length,
        }])
        .select()
        .single();

      if (orderError) {
        return new Response(JSON.stringify({ message: 'Error al crear la orden', error: orderError.message }), { status: 500 });
      }

      // Generar una orden de pago en Flow
      const flowOrderData = {
        commerceOrder: newOrder.id, // ID único de la orden en tu sistema
        subject: `Pago de entradas para el evento ${eventId}`,
        currency: 'CLP',
        amount: total,
        email: buyer.email,
        urlConfirmation: `${process.env.BASE_URL}/api/flow-confirmation`, // URL para recibir confirmaciones de Flow
        urlReturn: `${process.env.BASE_URL}/payment-success`, // URL a la que se redirige al usuario después del pago
      };

      // Firmar la solicitud según la documentación de Flow
      const paramsString = Object.entries(flowOrderData)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
      const signature = crypto.createHmac('sha256', flowApiSecret)
        .update(paramsString)
        .digest('hex');

      const flowResponse = await fetch(`${flowApiUrl}/payment/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ApiKey': flowApiKey,
        },
        body: JSON.stringify({
          ...flowOrderData,
          s: signature,
        }),
      });

      const flowData = await flowResponse.json();

      if (!flowResponse.ok) {
        return new Response(JSON.stringify({ message: 'Error al crear la orden de pago en Flow', error: flowData }), { status: 500 });
      }

      // Actualizar la orden con el ID de la orden de Flow
      const { error: updateOrderError } = await supabase
        .from('event_orders')
        .update({ payment_external_id: flowData.token })
        .eq('id', newOrder.id);

      if (updateOrderError) {
        return new Response(JSON.stringify({ message: 'Error al actualizar la orden con el ID de Flow', error: updateOrderError.message }), { status: 500 });
      }

      // Devolver la URL de pago al cliente
      return new Response(JSON.stringify({ paymentLink: flowData.url, message: 'Redirigiendo a pago' }), { status: 200 });
    }

  } catch (error) {
    return new Response(JSON.stringify({ message: 'Error interno', error: error.message }), { status: 500 });
  }
}

// 📌 Definir rutas personalizadas
export const config = {
  path: ['/api/purchase-ticket'],
};

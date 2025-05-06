import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { Resend } from 'resend';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TicketEmail from './TicketEmail.jsx';

const resend = new Resend(process.env.RESEND_API_KEY);

// Configurar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configurar Flow
const flowApiKey = process.env.FLOW_API_KEY;
const flowApiSecret = process.env.FLOW_SECRET_KEY;
const flowApiUrl = process.env.FLOW_BASE_URL;

function generateSignature(params, secretKey) {
  const keys = Object.keys(params).filter(key => key !== 's').sort();
  const stringToSign = keys.map(key => key + params[key]).join('');
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(stringToSign);
  return hmac.digest('hex');
}

async function sendTicketsEmail(customerInfo, eventInfo, orderInfo, ticketsInfo) {
  const siteUrl =
    process.env.CONTEXT === 'production'
      ? process.env.SITE_URL
      : 'https://aitickets.cl';

  const html = renderToStaticMarkup(
    React.createElement(TicketEmail, {
      customerName: customerInfo.name,
      eventName: eventInfo.name,
      eventDate: eventInfo.date,
      eventLocation: eventInfo.address,
      ticketLink: `${siteUrl}/ticket/${orderInfo.id}`,
      totalAmount: orderInfo.amount,
      ticketType: ticketsInfo.map(t => t.ticket_type).join(', '),
      quantity: ticketsInfo.reduce((sum, t) => sum + parseInt(t.quantity, 10), 0)
    })
  );

  const text = `Hola ${customerInfo.name},

¡Gracias por ser parte de la comunidad de AI Tickets! 🎉
Tu compra fue exitosa y ya tienes tu entrada para:

🎶 ${eventInfo.name}
📍 Lugar: ${eventInfo.address}
📅 Fecha: ${eventInfo.date}

Puedes ver tu entrada en el siguiente enlace:
https://aitickets.cl/ticket/${orderInfo.id}

Detalles de tu compra:
Evento: ${eventInfo.name}
Entradas: ${ticketsInfo.reduce((sum, t) => sum + parseInt(t.quantity, 10), 0)}
Tipo de entrada: ${ticketsInfo.map(t => t.ticket_type).join(', ')}
Total pagado: ${orderInfo.amount}

Recuerda llegar con tiempo y tener tu QR a mano.
Si tienes dudas, contáctanos a soporte@aitickets.com.

¡Nos vemos en el show! 🙌
El equipo de AI Tickets`;

  const { error } = await resend.emails.send({
    from: 'AITickets <welcome@email.aitickets.cl>',
    to: customerInfo.email,
    subject: `🎟️ ¡Aquí están tus entradas para ${eventInfo.name}!`,
    html,
    text
  });

  if (error) {
    console.error('❌ Error al enviar el correo:', error);
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), { status: 405 });
  }

  try {
    const { buyer, tickets, total, eventId, event } = await req.json();
    if (!buyer?.email || !tickets?.length) {
      return new Response(JSON.stringify({ message: 'Datos incompletos' }), { status: 400 });
    }

    const { data: existingAttendee, error: fetchError } = await supabase
      .from('attendees')
      .select('id')
      .eq('email', buyer.email)
      .single();

    let attendeeId = existingAttendee?.id;
    if (fetchError && fetchError.code !== 'PGRST116') {
      return new Response(JSON.stringify({ message: 'Error al verificar usuario', error: fetchError.message }), { status: 500 });
    }

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

    if (total === 0) {
      const eventAttendees = tickets.map(ticket => {
        const uniqueHash = crypto.createHash('sha256')
          .update(`${attendeeId}-${eventId}-${ticket.id}-${Date.now()}`)
          .digest('hex');

        return {
          event_id: eventId,
          event_ticket_id: parseInt(ticket.id, 10),
          attendee_id: attendeeId,
          qr_code: uniqueHash,
          is_complimentary: true,
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

      const customerInfo = {
        name: buyer.firstName,
        lastname: buyer.lastName,
        email: buyer.email,
      };
      const eventInfo = {
        name: event.name,
        date: event.start_date,
        address: event.location,
      };
      const orderInfo = {
        id: insertedTickets[0].id,
        created_at: new Date().toISOString(),
        amount: "Gratis",
      };
      const ticketsInfo = tickets.map(ticket => ({
        ticket_type: ticket.name,
        quantity: ticket.quantity,
        unit_price: ticket.price,
        total: ticket.total,
      }));

      await sendTicketsEmail(customerInfo, eventInfo, orderInfo, ticketsInfo);

      return new Response(JSON.stringify({ ticketId: insertedTickets[0].id, message: 'Registro completado' }), { status: 200 });
    }

    // FLow (para pagos, igual que antes)
    // [... el resto del código permanece igual ...]

  } catch (error) {
    return new Response(JSON.stringify({ message: 'Error interno', error: error.message }), { status: 500 });
  }
}

export const config = {
  path: ['/api/purchase-ticket'],
};


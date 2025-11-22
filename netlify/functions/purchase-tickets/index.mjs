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

<<<<<<< HEAD
=======
// Configuración del sistema
const SYSTEM_FEE_PERCENTAGE = 0.10; // 10% de comisión

/**
 * Firma los parámetros usando HMAC-SHA256 con secretKey
 * @param {Object} params - Objeto con los parámetros (sin incluir la firma "s")
 * @param {string} secretKey - Clave secreta para firmar
 * @returns {string} - Firma generada (hash HMAC-SHA256 en hexadecimal)
 */
>>>>>>> fbf950550a76103ae934203a0feb128dab741c64
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

<<<<<<< HEAD
  if (error) {
    console.error('❌ Error al enviar el correo:', error);
=======
  try {
    const data = await mg.messages.create("mg.aitickets.cl", {
      from: "AI Tickets <postmaster@mg.aitickets.cl>",
      to: [`${customerInfo.name} ${customerInfo.lastname} <${customerInfo.email}>`],
      subject: `🎟️ ¡Aquí están tus entradas para ${eventInfo.name}!`,
      template: "order complete",
      "h:X-Mailgun-Variables": JSON.stringify(
        {
          "customer_name": customerInfo.name,
          "event_name": eventInfo.name,
          "event_date": eventInfo.date,
          "venue": eventInfo.address,
          "order_id": orderInfo.id,
          "order_date": orderInfo.created_at,
          "order_qr_url": "https://aitickets.cl/order/" + orderInfo.id,
          "total_amount": orderInfo.amount,
          "tickets": ticketsInfo,
          // "tickets": [
          //   {
          //     "ticket_type": "Entrada General",
          //     "quantity": 2,
          //     "unit_price":  "$6.000",
          //     "total": "$12.000"
          //   }
          // ]
        }
      ),
    });
    console.log(data); // logs response data
  } catch (error) {
    console.log(error); // logs any error
>>>>>>> fbf950550a76103ae934203a0feb128dab741c64
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
<<<<<<< HEAD
      }

      const customerInfo = {
        name: buyer.firstName,
        lastname: buyer.lastName,
=======
      } else {
        // enviar correo con las entradas
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
        sendTicketsEmail(customerInfo, eventInfo, orderInfo, ticketsInfo);
      }
      return new Response(JSON.stringify({ ticketId: insertedTickets[0].id, message: 'Registro completado' }), { status: 200 });
    } else {
      console.log('Creando orden de pago');
      // Calcular la cantidad total de tickets sumando todas las cantidades
      const totalTicketQty = tickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
      
      // Calcular el monto base y la comisión
      // El total ya incluye la comisión, por lo que extraemos el monto base
      const baseAmount = Math.round(total / (1 + SYSTEM_FEE_PERCENTAGE));
      const ticketFee = total - baseAmount;
      
      // Crear una orden en la base de datos para eventos pagados
      const { data: newOrder, error: orderError } = await supabase
        .from('event_orders')
        .insert([{
          status: 'pending',
          event_id: eventId,
          attendee_id: attendeeId,
          amount: baseAmount,
          ticket_fee: ticketFee,
          ticket_qty: totalTicketQty,
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
        subject: `Pago de ${totalTicketQty === 1 ? '1 entrada' : `${totalTicketQty} entradas`} para el evento ${event.name} - ${buyer.email}`,
        currency: 'CLP',
        amount: total,
>>>>>>> fbf950550a76103ae934203a0feb128dab741c64
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


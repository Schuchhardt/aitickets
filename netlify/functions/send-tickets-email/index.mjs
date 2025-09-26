import { createClient } from '@supabase/supabase-js';
import FormData from "form-data"; // form-data v4.0.1
import Mailgun from "mailgun.js"; // mailgun.js v11.1.0

// Configurar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Envía email con los tickets al cliente después de un pago exitoso
 * @param {Object} customerInfo - Información del cliente
 * @param {Object} eventInfo - Información del evento
 * @param {Object} orderInfo - Información de la orden
 * @param {Array} ticketsInfo - Array con información de los tickets
 */
async function sendTicketsEmail(customerInfo, eventInfo, orderInfo, ticketsInfo) {
  const mailgun = new Mailgun(FormData);

  const mg = mailgun.client({
    username: "api",
    key: process.env.MAILGUN_API_KEY,
  });

  try {
    const data = await mg.messages.create("mg.aitickets.cl", {
      from: "AI Tickets <postmaster@mg.aitickets.cl>",
      to: [`${customerInfo.name} ${customerInfo.lastname} <${customerInfo.email}>`],
      subject: `🎟️ ¡Aquí están tus entradas para ${eventInfo.name}!`,
      template: "order complete",
      "h:X-Mailgun-Variables": JSON.stringify({
        "customer_name": customerInfo.name,
        "event_name": eventInfo.name,
        "event_date": eventInfo.date,
        "venue": eventInfo.address,
        "order_id": orderInfo.id,
        "order_date": orderInfo.created_at,
        "order_qr_url": "https://aitickets.cl/order/" + orderInfo.id,
        "total_amount": orderInfo.amount,
        "tickets": ticketsInfo,
      }),
    });
    
    console.log('✉️ Email enviado exitosamente:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Error enviando email:', error);
    return { success: false, error: error.message };
  }
}

export default async function handler(req, context) {
  // Solo permitir método POST
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ message: 'Método no permitido' }), 
      { 
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  try {
    const { orderId } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ message: 'ID de orden requerido' }), 
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Obtener datos de la orden desde Supabase
    const { data: orderData, error: orderError } = await supabase
      .from('event_orders')
      .select(`
        *,
        attendees (
          first_name,
          last_name,
          email,
          phone
        ),
        events (
          name,
          start_date,
          location
        )
      `)
      .eq('id', orderId)
      .eq('status', 'paid')
      .single();

    if (orderError || !orderData) {
      console.error('Error obteniendo orden:', orderError);
      return new Response(
        JSON.stringify({ message: 'Orden no encontrada o no pagada' }), 
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Obtener tickets de la orden
    const { data: ticketsData, error: ticketsError } = await supabase
      .from('event_attendees')
      .select(`
        *,
        event_tickets (
          ticket_name,
          price
        )
      `)
      .eq('event_order_id', orderId);

    if (ticketsError) {
      console.error('Error obteniendo tickets:', ticketsError);
      return new Response(
        JSON.stringify({ message: 'Error obteniendo tickets' }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Preparar información para el email
    const customerInfo = {
      name: orderData.attendees.first_name,
      lastname: orderData.attendees.last_name,
      email: orderData.attendees.email,
    };

    const eventInfo = {
      name: orderData.events.name,
      date: orderData.events.start_date,
      address: orderData.events.location,
    };

    const orderInfo = {
      id: orderData.id,
      created_at: orderData.created_at,
      amount: `$${orderData.amount.toLocaleString('es-CL')}`,
    };

    // Agrupar tickets por tipo para el email
    const ticketGroups = {};
    ticketsData.forEach(ticket => {
      const ticketType = ticket.event_tickets.ticket_name;
      const unitPrice = ticket.event_tickets.price;
      
      if (!ticketGroups[ticketType]) {
        ticketGroups[ticketType] = {
          ticket_type: ticketType,
          quantity: 0,
          unit_price: `$${unitPrice.toLocaleString('es-CL')}`,
          total: 0
        };
      }
      
      ticketGroups[ticketType].quantity += 1;
      ticketGroups[ticketType].total += unitPrice;
    });

    // Formatear totales
    const ticketsInfo = Object.values(ticketGroups).map(group => ({
      ...group,
      total: `$${group.total.toLocaleString('es-CL')}`
    }));

    // Enviar email
    const emailResult = await sendTicketsEmail(customerInfo, eventInfo, orderInfo, ticketsInfo);

    if (emailResult.success) {
      return new Response(
        JSON.stringify({ 
          message: 'Email enviado exitosamente',
          orderId: orderId 
        }), 
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } else {
      return new Response(
        JSON.stringify({ 
          message: 'Error enviando email',
          error: emailResult.error 
        }), 
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

  } catch (error) {
    console.error('Error interno:', error);
    return new Response(
      JSON.stringify({ 
        message: 'Error interno del servidor',
        error: error.message 
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Definir rutas personalizadas
export const config = {
  path: ['/api/send-tickets-email'],
};
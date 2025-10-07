import { createClient } from '@supabase/supabase-js';
import FormData from "form-data"; // form-data v4.0.1
import Mailgun from "mailgun.js"; // mailgun.js v11.1.0

// Configurar Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Formatea una fecha para la zona horaria de Santiago, Chile
 * @param {Date|string} date - La fecha a formatear
 * @param {boolean} includeTime - Si incluir la hora
 * @returns {string} Fecha formateada
 */
function formatChileDate(date, includeTime = false) {
  const options = {
    timeZone: 'America/Santiago',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  };
  
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.hour12 = false;
  }
  
  return new Date(date).toLocaleDateString('es-CL', options);
}

/**
 * Formatea solo la hora para la zona horaria de Santiago, Chile
 * @param {Date|string} date - La fecha con hora a formatear
 * @returns {string} Hora formateada
 */
function formatChileTime(date) {
  return new Date(date).toLocaleTimeString('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

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
    // Obtener emails para bcc
    let bccEmails = ["contacto@aitickets.cl"];
    if (eventInfo.adminEmail) {
      bccEmails.push(eventInfo.adminEmail);
    }

    // Función para escapar texto en formato ICS según RFC 5545
    const escapeICSText = (text) => {
      if (!text) return '';
      return text
        .replace(/\\/g, '\\\\')  // Escapar backslashes
        .replace(/;/g, '\\;')    // Escapar punto y coma
        .replace(/,/g, '\\,')    // Escapar comas
        .replace(/\n/g, '\\n')   // Escapar saltos de línea
        .replace(/\r/g, '')      // Remover retornos de carro
        .replace(/<br\s*\/?>/gi, '\\n')  // Convertir <br> a salto de línea
        .replace(/<[^>]+>/g, ''); // Remover todas las etiquetas HTML
    };

    // Función para dividir líneas largas según RFC 5545 (máximo 75 caracteres)
    const foldLine = (line) => {
      if (line.length <= 75) return line;
      const lines = [];
      let currentLine = line.substring(0, 75);
      let remaining = line.substring(75);
      lines.push(currentLine);
      while (remaining.length > 0) {
        currentLine = ' ' + remaining.substring(0, 74); // Espacio inicial para continuación
        remaining = remaining.substring(74);
        lines.push(currentLine);
      }
      return lines.join('\r\n');
    };

    // Crear archivo ICS
    const eventStart = eventInfo.rawStartDate || new Date();
    const eventEnd = eventInfo.rawEndDate ? new Date(eventInfo.rawEndDate) : new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);
    const formatICSDate = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    // Limpiar y formatear la descripción
    const cleanDescription = escapeICSText(eventInfo.description);
    const descriptionText = `Tus entradas están en este link: https://aitickets.cl/order/${orderInfo.id}\\n\\n${cleanDescription}`;
    
    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//aitickets.cl//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${orderInfo.id}@aitickets.cl`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `SUMMARY:${escapeICSText(eventInfo.name)}`,
      `DESCRIPTION:${descriptionText}`,
      `DTSTART:${formatICSDate(new Date(eventStart))}`,
      `DTEND:${formatICSDate(eventEnd)}`,
      `LOCATION:${escapeICSText(eventInfo.address)}`,
      `URL:https://aitickets.cl/order/${orderInfo.id}`,
      'STATUS:CONFIRMED',
      'SEQUENCE:0',
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    
    // Aplicar folding a líneas largas y unir con CRLF
    const icsContent = icsLines.map(line => foldLine(line)).join('\r\n');

    // Adjuntar el ICS
    const data = await mg.messages.create("mg.aitickets.cl", {
      from: "AI Tickets <postmaster@mg.aitickets.cl>",
      to: [`${customerInfo.name} ${customerInfo.lastname} <${customerInfo.email}>`],
      bcc: bccEmails,
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
        "total_amount": orderInfo.total_payment,
        "tickets": ticketsInfo,
      }),
      attachment: [
        {
          filename: "evento.ics",
          data: Buffer.from(icsContent, "utf-8"),
          contentType: "text/calendar"
        }
      ]
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
          end_date,
          location,
          organization_id,
          description,
          secret_location
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

    // Los datos de tickets ya están en orderData.ticket_details
    if (!orderData.ticket_details || !Array.isArray(orderData.ticket_details)) {
      console.error('Error: ticket_details no encontrado o no es un array');
      return new Response(
        JSON.stringify({ message: 'Detalles de tickets no encontrados' }), 
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

    // Obtener el email del admin de la organización asociada al evento
    let adminEmail = null;
    if (orderData.events && orderData.events.organization_id) {
      const { data: adminData, error: adminError } = await supabase
        .from('users')
        .select('email')
        .eq('organization_id', orderData.events.organization_id)
        .eq('role', 'admin')
        .limit(1)
        .single();
      if (adminData && adminData.email) {
        adminEmail = adminData.email;
      }
    }

    const eventInfo = {
      name: orderData.events.name,
      description: orderData.events.description || '',
      date: `${formatChileDate(orderData.events.start_date)} a las ${formatChileTime(orderData.events.start_date)} hrs`,
      address: orderData.events.secret_location ? orderData.events.secret_location : orderData.events.location,
      adminEmail: adminEmail,
      rawStartDate: orderData.events.start_date,
      rawEndDate: orderData.events.end_date,
    };

    const orderInfo = {
      id: orderData.id,
      created_at: `${formatChileDate(orderData.created_at, true)}`,
      total_payment: `$${orderData.total_payment.toLocaleString('es-CL')}`,
    };

    // Usar directamente los datos de ticket_details para el email
    const ticketsInfo = orderData.ticket_details.map(ticket => {
      const subtotal = ticket.price * ticket.quantity;
      const commission = subtotal * 0.10;
      const totalWithCommission = subtotal + commission;
      return {
        ticket_type: ticket.name,
        quantity: ticket.quantity,
        unit_price: `$${ticket.price.toLocaleString('es-CL')}`,
        total: `$${totalWithCommission.toLocaleString('es-CL')}`
      };
    });

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
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Configurar Supabase
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

      const uniqueUUID = uuidv4(); // Generar un UUID único

      return {
        event_id: eventId,
        event_ticket_id: ticket.id,
        attendee_id: attendeeId,
        qr_code: uniqueHash,
        internal_id: uniqueUUID,
        is_complimentary: ticket.price === 0,
        payment_status: ticket.price > 0 ? 'pending' : 'completed',
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

    // Si el evento es gratuito, devolver el `internal_id` para redirigir a la página de entrada
    if (total === 0) {
      return new Response(JSON.stringify({ ticketId: insertedTickets[0].internal_id, message: 'Registro completado' }), { status: 200 });
    }

    // Simulación de creación de link de pago (esto debería integrarse con una pasarela de pago real)
    const paymentLink = `https://payment-provider.com/pay?amount=${total}`;

    return new Response(JSON.stringify({ paymentLink, message: 'Redirigiendo a pago' }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: 'Error interno', error: error.message }), { status: 500 });
  }
}

// 📌 Definir rutas personalizadas
export const config = {
  path: ['/api/purchase-ticket'],
};

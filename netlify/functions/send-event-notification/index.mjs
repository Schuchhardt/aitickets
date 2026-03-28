import { createClient } from '@supabase/supabase-js';
import FormData from "form-data";
import Mailgun from "mailgun.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

function getChangeTypeLabel(changeType) {
  const labels = {
    date_change: 'Cambio de fecha',
    venue_change: 'Cambio de lugar',
    cancellation: 'Cancelación',
    general_update: 'Actualización',
  };
  return labels[changeType] || 'Actualización';
}

function buildNotificationHtml(eventName, changeType, changeDescription, eventUrl) {
  const label = getChangeTypeLabel(changeType);
  const isCancellation = changeType === 'cancellation';
  const accentColor = isCancellation ? '#dc2626' : '#2563eb';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:white;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="display:inline-block;padding:4px 12px;background:${accentColor}15;color:${accentColor};border-radius:20px;font-size:13px;font-weight:600;">${label}</span>
      </div>
      <h1 style="font-size:22px;color:#111;text-align:center;margin:0 0 8px;">${eventName}</h1>
      <p style="color:#6b7280;text-align:center;margin:0 0 24px;font-size:15px;">Hay novedades sobre tu evento</p>
      <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#374151;font-size:15px;">${changeDescription}</p>
      </div>
      <div style="text-align:center;">
        <a href="${eventUrl}" style="display:inline-block;padding:12px 24px;background:#111;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Ver evento actualizado</a>
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:32px;">Recibiste este email porque tienes entradas para este evento.</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendNotificationEmails(attendees, eventName, changeType, changeDescription, eventUrl) {
  const mailgun = new Mailgun(FormData);
  const mg = mailgun.client({
    username: "api",
    key: process.env.MAILGUN_API_KEY,
  });

  const subject = changeType === 'cancellation'
    ? `⚠️ Aviso importante sobre ${eventName}`
    : `📢 Actualización: ${eventName}`;

  const html = buildNotificationHtml(eventName, changeType, changeDescription, eventUrl);
  const results = [];

  // Send in batches of 50
  for (let i = 0; i < attendees.length; i += 50) {
    const batch = attendees.slice(i, i + 50);
    const recipientVars = {};
    const toList = batch.map(a => {
      const name = `${a.first_name} ${a.last_name}`.trim();
      recipientVars[a.email] = { name: a.first_name || 'Asistente' };
      return `${name} <${a.email}>`;
    });

    try {
      const data = await mg.messages.create("mg.aitickets.cl", {
        from: "AI Tickets <postmaster@mg.aitickets.cl>",
        to: toList,
        subject,
        html,
        "recipient-variables": JSON.stringify(recipientVars),
      });
      results.push({ batch: i, success: true, id: data.id });
    } catch (error) {
      console.error(`Error sending batch ${i}:`, error);
      results.push({ batch: i, success: false, error: error.message });
    }
  }

  return results;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Método no permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { eventId, changeType, changeDescription } = await req.json();

    if (!eventId || !changeType || !changeDescription) {
      return new Response(JSON.stringify({ message: 'eventId, changeType y changeDescription son requeridos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get event info
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, name, slug')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return new Response(JSON.stringify({ message: 'Evento no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get all attendees with tickets for this event
    const { data: eventAttendees, error: attendeesError } = await supabase
      .from('event_attendees')
      .select(`
        attendee_id,
        attendees (
          id,
          first_name,
          last_name,
          email
        )
      `)
      .eq('event_id', eventId);

    if (attendeesError) {
      console.error('Error fetching attendees:', attendeesError);
      return new Response(JSON.stringify({ message: 'Error obteniendo asistentes' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Deduplicate by email
    const uniqueAttendees = [];
    const seenEmails = new Set();
    for (const ea of (eventAttendees || [])) {
      if (ea.attendees?.email && !seenEmails.has(ea.attendees.email)) {
        seenEmails.add(ea.attendees.email);
        uniqueAttendees.push(ea.attendees);
      }
    }

    if (uniqueAttendees.length === 0) {
      return new Response(JSON.stringify({ message: 'No hay asistentes para notificar', count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const eventUrl = `https://aitickets.cl/eventos/${event.slug}`;
    const results = await sendNotificationEmails(uniqueAttendees, event.name, changeType, changeDescription, eventUrl);

    // Log notifications
    const logEntries = uniqueAttendees.map(a => ({
      event_id: eventId,
      attendee_id: a.id,
      type: changeType,
      channel: 'email',
      status: 'sent',
    }));

    if (logEntries.length > 0) {
      await supabase.from('notification_log').insert(logEntries).throwOnError().catch(err => {
        // notification_log table might not exist yet - don't fail the whole request
        console.warn('Could not log notifications (table may not exist yet):', err.message);
      });
    }

    return new Response(JSON.stringify({
      message: `Notificación enviada a ${uniqueAttendees.length} asistentes`,
      count: uniqueAttendees.length,
      results,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error interno:', error);
    return new Response(JSON.stringify({ message: 'Error interno', error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const config = {
  path: ['/api/send-event-notification'],
};

import { createClient } from '@supabase/supabase-js';
import FormData from "form-data";
import Mailgun from "mailgun.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function formatChileDate(date) {
  return new Date(date).toLocaleDateString('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatChileTime(time) {
  // time is a string like "19:00:00"
  const [hours, minutes] = time.split(':');
  return `${hours}:${minutes}`;
}

function buildReminderHtml(eventName, eventDate, startTime, venue, eventUrl) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:white;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
      <div style="text-align:center;margin-bottom:24px;">
        <span style="display:inline-block;padding:4px 12px;background:#f0fdf4;color:#16a34a;border-radius:20px;font-size:13px;font-weight:600;">Recordatorio</span>
      </div>
      <h1 style="font-size:22px;color:#111;text-align:center;margin:0 0 8px;">¡Tu evento es mañana!</h1>
      <h2 style="font-size:18px;color:#374151;text-align:center;margin:0 0 24px;font-weight:500;">${eventName}</h2>
      <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:14px;">Fecha</td>
            <td style="padding:8px 0;color:#111;font-size:14px;text-align:right;font-weight:500;">${eventDate}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:14px;">Hora</td>
            <td style="padding:8px 0;color:#111;font-size:14px;text-align:right;font-weight:500;">${startTime} hrs</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280;font-size:14px;">Lugar</td>
            <td style="padding:8px 0;color:#111;font-size:14px;text-align:right;font-weight:500;">${venue}</td>
          </tr>
        </table>
      </div>
      <div style="text-align:center;">
        <a href="${eventUrl}" style="display:inline-block;padding:12px 24px;background:#111;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Ver mis entradas</a>
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:32px;">Recibiste este email porque tienes entradas para este evento.</p>
    </div>
  </div>
</body>
</html>`;
}

export default async function handler(req) {
  console.log('🔔 Running event reminders check...');

  try {
    // Get tomorrow's date in Chile timezone
    const now = new Date();
    const chileNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Santiago' }));
    const tomorrow = new Date(chileNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`📅 Looking for events on ${tomorrowStr}`);

    // Find event_dates happening tomorrow
    const { data: eventDates, error: datesError } = await supabase
      .from('event_dates')
      .select(`
        id,
        date,
        start_time,
        end_time,
        event_id,
        event_location_id,
        event_locations (
          venues (
            name,
            address_line1,
            city
          )
        )
      `)
      .eq('date', tomorrowStr);

    if (datesError) {
      console.error('Error fetching event dates:', datesError);
      return new Response(JSON.stringify({ error: datesError.message }), { status: 500 });
    }

    if (!eventDates || eventDates.length === 0) {
      console.log('✅ No events tomorrow');
      return new Response(JSON.stringify({ message: 'No events tomorrow', count: 0 }), { status: 200 });
    }

    const mailgun = new Mailgun(FormData);
    const mg = mailgun.client({ username: "api", key: process.env.MAILGUN_API_KEY });

    let totalSent = 0;

    // Process each event date
    for (const ed of eventDates) {
      const eventId = ed.event_id;

      // Get event info
      const { data: event, error: eventError } = await supabase
        .from('events')
        .select('id, name, slug, status')
        .eq('id', eventId)
        .eq('status', 'published')
        .single();

      if (eventError || !event) continue; // Skip unpublished or missing events

      // Check if we already sent reminders for this event date
      const { count: alreadySent } = await supabase
        .from('notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('type', 'reminder_24h');

      if (alreadySent && alreadySent > 0) {
        console.log(`⏭️ Reminders already sent for event ${event.name}`);
        continue;
      }

      // Get attendees for this event
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

      if (attendeesError || !eventAttendees?.length) continue;

      // Deduplicate by email
      const uniqueAttendees = [];
      const seenEmails = new Set();
      for (const ea of eventAttendees) {
        if (ea.attendees?.email && !seenEmails.has(ea.attendees.email)) {
          seenEmails.add(ea.attendees.email);
          uniqueAttendees.push(ea.attendees);
        }
      }

      if (uniqueAttendees.length === 0) continue;

      // Build venue string
      const venue = ed.event_locations?.venues
        ? `${ed.event_locations.venues.name}, ${ed.event_locations.venues.city || ''}`
        : 'Ver evento para detalles';

      const eventDate = formatChileDate(ed.date);
      const startTime = formatChileTime(ed.start_time);
      const eventUrl = `https://aitickets.cl/eventos/${event.slug}`;
      const html = buildReminderHtml(event.name, eventDate, startTime, venue, eventUrl);

      // Send in batches of 50
      for (let i = 0; i < uniqueAttendees.length; i += 50) {
        const batch = uniqueAttendees.slice(i, i + 50);
        const recipientVars = {};
        const toList = batch.map(a => {
          const name = `${a.first_name} ${a.last_name}`.trim();
          recipientVars[a.email] = { name: a.first_name || 'Asistente' };
          return `${name} <${a.email}>`;
        });

        try {
          await mg.messages.create("mg.aitickets.cl", {
            from: "AI Tickets <postmaster@mg.aitickets.cl>",
            to: toList,
            subject: `🎪 Recordatorio: ${event.name} es mañana`,
            html,
            "recipient-variables": JSON.stringify(recipientVars),
          });
          totalSent += batch.length;
        } catch (error) {
          console.error(`Error sending reminder batch:`, error);
        }
      }

      // Log sent reminders
      const logEntries = uniqueAttendees.map(a => ({
        event_id: eventId,
        attendee_id: a.id,
        type: 'reminder_24h',
        channel: 'email',
        status: 'sent',
      }));

      await supabase.from('notification_log').insert(logEntries).catch(err => {
        console.warn('Could not log notifications:', err.message);
      });

      console.log(`✅ Sent ${uniqueAttendees.length} reminders for "${event.name}"`);
    }

    console.log(`🔔 Total reminders sent: ${totalSent}`);
    return new Response(JSON.stringify({ message: `Reminders sent`, count: totalSent }), { status: 200 });

  } catch (error) {
    console.error('Error in reminders function:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

export const config = {
  schedule: "0 13 * * *", // 13:00 UTC = 10:00 AM Chile
  path: ['/api/send-event-reminders'],
};

// Certificado de asistencia de un asistente, sin cuenta: /certificado/<token> (link firmado que llega por correo o que
// el productor copia desde get_attendance_certificates; netlify/lib/certificate-token.mjs). Devuelve el PDF con un
// certificado por entrada del link, calculado en el momento (src/lib/certificates.ts): si una entrada se anuló o ya
// no cumple el mínimo de funciones, no sale.
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../lib/auth-helpers";
import { verifyCertificateToken } from "../../../netlify/lib/certificate-token.mjs";
import { loadCertificates, pdfFileName, renderCertificates } from "../../lib/certificates";

export const prerender = false;

const page = (status: number, title: string, text: string) =>
    new Response(
        `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>` +
            `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#0a0a0b"><h1 style="font-size:1.4rem">${title}</h1><p style="color:#555">${text}</p><p><a href="/">AI Tickets</a></p></body></html>`,
        { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" } },
    );

export const GET: APIRoute = async ({ params }) => {
    const claim = verifyCertificateToken(String(params.token || ""));
    if (!claim) return page(404, "Link no válido", "Revisa que el link esté completo, tal como llegó en el correo.");
    const supabase = getSupabaseAdmin();
    try {
        const { data: tickets, error } = await supabase.from("event_attendees").select("id, event_id").in("id", claim.ticketIds);
        if (error) throw new Error(error.message);
        const eventId = Number(tickets?.[0]?.event_id);
        if (!eventId) return page(404, "Certificado no disponible", "La entrada de este certificado ya no existe.");
        const { data: event } = await supabase.from("events").select("id, name, organization_id, start_date").eq("id", eventId).maybeSingle();
        if (!event) return page(404, "Certificado no disponible", "El evento de este certificado ya no existe.");
        const ids = (tickets || []).filter((t: any) => Number(t.event_id) === eventId).map((t: any) => String(t.id));
        const certs = await loadCertificates(supabase, event, { minSessions: claim.minSessions, hours: claim.hours, ticketIds: ids });
        const eligible = certs.rows.filter((r) => r.eligible);
        if (!eligible.length) return page(404, "Certificado no disponible", "Esta entrada no tiene un ingreso registrado que permita emitir el certificado. Escríbele a quien organizó el evento.");
        const pdf = renderCertificates(certs, eligible);
        return new Response(new Uint8Array(pdf), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="${pdfFileName("certificado", event.name)}"`,
                "Cache-Control": "private, no-store",
                "X-Robots-Tag": "noindex, nofollow",
                "Referrer-Policy": "no-referrer",
            },
        });
    } catch (err: any) {
        console.error("certificado:", err?.message || err);
        return page(500, "No pudimos generar el certificado", "Intenta de nuevo en unos minutos.");
    }
};

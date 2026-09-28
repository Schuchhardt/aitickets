// /api/sites/contact-email-confirm?t=<token>
//
// Enlace del correo de confirmación del contact_email del sitio (ver src/lib/site-contact-email.ts).
// Público: la autorización es el token firmado (sitio + organización + correo + vencimiento).
//
// GET NO cambia nada: muestra una página con el botón "Confirmar" (los escáneres de enlaces de correo
// corporativo — Safe Links, Proofpoint, Mimecast — abren los enlaces solos, y la confirmación debe venir
// de una persona). POST (formulario con el token en un campo oculto) guarda el correo en el sitio.
import type { APIRoute } from "astro";
import { confirmContactEmail, verifyContactEmailToken } from "../../../lib/site-contact-email";
import { mainOrigin } from "../../../lib/sites";

export const prerender = false;

const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function page(title: string, inner: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)} | AI Tickets</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f9fafb;color:#111827;margin:0;padding:24px 16px}main{max-width:520px;margin:40px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.6;margin:0 0 16px}button,.btn{display:inline-block;padding:12px 22px;border-radius:8px;border:0;background:#111827;color:#fff;font-weight:600;font-size:15px;cursor:pointer;text-decoration:none}.muted{color:#6b7280;font-size:14px}</style></head><body><main>${inner}</main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "same-origin",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    }
  );
}

const ERRORS: Record<string, { title: string; text: string; status: number }> = {
  invalid: { title: "El enlace no es válido", text: "Puede que el enlace esté incompleto. Pide uno nuevo desde el panel de tu sitio.", status: 400 },
  expired: { title: "El enlace venció", text: "Los enlaces de confirmación duran 48 horas. Pide uno nuevo desde el panel de tu sitio.", status: 400 },
  not_found: { title: "No encontramos el sitio", text: "El sitio asociado a este enlace ya no existe.", status: 404 },
  server: { title: "No pudimos confirmar el correo", text: "Ocurrió un problema. Intenta de nuevo en unos minutos.", status: 500 },
};

function errorPage(code: string) {
  const e = ERRORS[code] || ERRORS.invalid;
  return page(e.title, `<h1>${escapeHtml(e.title)}</h1><p>${escapeHtml(e.text)}</p>`, e.status);
}

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get("t") || "";
  let check;
  try {
    check = verifyContactEmailToken(token);
  } catch (err: any) {
    console.error("contact-email-confirm:", err?.message);
    return errorPage("server");
  }
  if (!check.ok) return errorPage(check.error);
  return page(
    "Confirmar correo de contacto",
    `<h1>Confirma el correo de contacto</h1>
<p>Al confirmar, <strong>${escapeHtml(check.email)}</strong> recibirá los mensajes que los visitantes envíen desde el formulario de contacto de un sitio web en AI Tickets.</p>
<form method="post" action="/api/sites/contact-email-confirm"><input type="hidden" name="t" value="${escapeHtml(token)}"><button type="submit">Confirmar este correo</button></form>
<p class="muted" style="margin-top:16px">Si no lo pediste, cierra esta página: no recibirás mensajes.</p>`
  );
};

export const POST: APIRoute = async ({ request }) => {
  let token = "";
  try {
    const form = await request.formData();
    token = String(form.get("t") || "");
  } catch {
    return errorPage("invalid");
  }
  const result = await confirmContactEmail(token);
  if (!result.ok) return errorPage(result.error);
  return page(
    "Correo confirmado",
    `<h1>¡Correo confirmado!</h1>
<p>Desde ahora los mensajes del formulario de contacto del sitio llegarán a esta dirección.</p>
<p><a class="btn" href="${escapeHtml(`${mainOrigin()}/dashboard/sitio?contacto=ok`)}">Ir al panel del sitio</a></p>`
  );
};

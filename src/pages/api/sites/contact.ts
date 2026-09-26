// POST /api/sites/contact — formulario de contacto de un sitio de productor.
//
// Público (sin sesión). Antiabuso: honeypot vacío, al menos 3 s desde que se abrió el formulario,
// máximo 5 mensajes por hora por IP (hash sha256(IP + INTERNAL_API_SECRET)), máximo 20 por día por sitio
// y un tope global por hora (SITE_CONTACT_GLOBAL_HOURLY_CAP, 200 por defecto), todo contado en
// aitickets_site_contact_messages, y Turnstile cuando el host efectivo está bajo aitickets.cl.
// El mensaje se guarda primero y luego se envía por Mailgun al productor con Reply-To = visitante.
// Destinatario: contact_email del sitio (solo se guarda tras confirmar el enlace, ver
// src/lib/site-contact-email.ts) o el correo que la organización verificó (email_verified_for, nunca
// organizations.email, que se edita sin confirmar); nunca si la organización no verificó su
// correo. delivered_at / mail_error registran el resultado.
import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { verifyTurnstileToken } from "../../../lib/turnstile";
import {
  clientIpFrom,
  getSiteBySlug,
  isUnderRootDomain,
  siteContactRecipient,
  siteUrl,
  type SiteRecord,
} from "../../../lib/sites";
import { sendEmail, legalFooterHtml, isValidEmail, formatRecipient } from "../../../../netlify/lib/mailer.mjs";

export const prerender = false;

const RATE_LIMIT_PER_HOUR = 5;
const SITE_LIMIT_PER_DAY = 20;

function globalHourlyCap(): number {
  const raw = import.meta.env.SITE_CONTACT_GLOBAL_HOURLY_CAP || (globalThis as any).process?.env?.SITE_CONTACT_GLOBAL_HOURLY_CAP;
  const n = Number.parseInt(String(raw || "200"), 10);
  return Number.isFinite(n) && n > 0 ? n : 200;
}
const MIN_FILL_MS = 3000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const BodySchema = z.object({
  siteSlug: z.string().trim().toLowerCase().min(1).max(60),
  name: z.string().trim().min(2, "Escribe tu nombre.").max(120),
  email: z.string().trim().toLowerCase().max(254),
  phone: z.string().trim().max(40).optional().nullable(),
  message: z
    .string()
    .trim()
    .min(10, "El mensaje debe tener al menos 10 caracteres.")
    .max(5000, "El mensaje no puede superar los 5.000 caracteres."),
  turnstileToken: z.string().max(4096).optional().nullable(),
  hp: z.string().max(500).optional().nullable(),
  startedAt: z.coerce.number().optional().nullable(),
});

const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

function ipHashFor(ip: string): string {
  const pepper = import.meta.env.INTERNAL_API_SECRET || (globalThis as any).process?.env?.INTERNAL_API_SECRET || "aitickets";
  return createHash("sha256").update(`${ip}|${pepper}`).digest("hex");
}

function buildEmailHtml(site: SiteRecord, siteName: string, data: { name: string; email: string; phone?: string | null; message: string }) {
  const messageHtml = escapeHtml(data.message).replace(/\r?\n/g, "<br>");
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0">${value}</td></tr>`;
  return `<!doctype html><html lang="es-CL"><body style="margin:0;background:#f9fafb;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb">
<h1 style="font-size:18px;margin:0 0 4px 0">Nuevo mensaje desde tu sitio</h1>
<p style="margin:0 0 16px 0;color:#6b7280;font-size:14px">${escapeHtml(siteName)} · <a href="${escapeHtml(siteUrl(site, "/contacto"))}" style="color:#4d7c0f">${escapeHtml(siteUrl(site, "/contacto"))}</a></p>
<table style="font-size:14px;border-collapse:collapse;margin-bottom:16px">
${row("Nombre", escapeHtml(data.name))}
${row("Correo", `<a href="mailto:${escapeHtml(data.email)}" style="color:#4d7c0f">${escapeHtml(data.email)}</a>`)}
${data.phone ? row("Teléfono", escapeHtml(data.phone)) : ""}
</table>
<div style="font-size:15px;line-height:1.6;background:#f3f4f6;border-radius:8px;padding:16px">${messageHtml}</div>
<p style="font-size:13px;color:#6b7280;margin:16px 0 0 0">Responde este correo para contestarle directamente a ${escapeHtml(data.name)}.</p>
${legalFooterHtml({ reason: "Recibes este correo porque alguien usó el formulario de contacto de tu sitio en AI Tickets." })}
</div></body></html>`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "Solicitud inválida." }, 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const friendly = first?.message && !/^(Expected|Required|Invalid|String must)/.test(first.message) ? first.message : "Revisa los datos del formulario.";
    return json({ ok: false, error: friendly }, 400);
  }
  const data = parsed.data;

  // Honeypot y tiempo mínimo: responder "ok" sin guardar (no dar pistas al bot)
  if (data.hp && data.hp.trim()) return json({ ok: true });
  if (!data.startedAt || !Number.isFinite(data.startedAt) || Date.now() - data.startedAt < MIN_FILL_MS) {
    return json({ ok: false, error: "Espera unos segundos antes de enviar el formulario." }, 400);
  }
  if (!isValidEmail(data.email)) return json({ ok: false, error: "Escribe un correo válido." }, 400);

  // Sitio: el del host (middleware) si coincide; si no, por slug (solo públicos)
  const localSite = locals.site as SiteRecord | null | undefined;
  if (localSite && localSite.slug !== data.siteSlug) return json({ ok: false, error: "Sitio no encontrado." }, 404);
  const site = localSite || (await getSiteBySlug(data.siteSlug));
  if (!site || site.contact_form_enabled === false) return json({ ok: false, error: "Sitio no encontrado." }, 404);

  const ip = clientIpFrom(request);
  const effectiveHost = locals.effectiveHost || new URL(request.url).host;

  // Turnstile bajo aitickets.cl (en dominios propios no es posible: lista de hostnames del widget)
  if (isUnderRootDomain(effectiveHost)) {
    if (import.meta.env.TURNSTILE_SECRET_KEY) {
      const { success, message } = await verifyTurnstileToken({
        token: data.turnstileToken || "",
        remoteip: ip !== "unknown" ? ip : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!success) return json({ ok: false, error: message || "Verificación de seguridad fallida." }, 400);
    } else {
      console.warn("sites/contact: TURNSTILE_SECRET_KEY no configurada; se omite Turnstile");
    }
  }

  // Sitio demo: no se guarda ni se envía nada
  if (site.is_demo) return json({ ok: true, demo: true });

  const supabase = getSupabaseAdmin();
  const ipHash = ipHashFor(ip);

  // Límites: por IP (hash) en la última hora, por sitio en el último día y global en la última hora
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const countMessages = () => supabase.from("aitickets_site_contact_messages").select("id", { count: "exact", head: true });
  const [byIp, bySite, global] = await Promise.all([
    countMessages().eq("ip_hash", ipHash).gte("created_at", hourAgo),
    countMessages().eq("site_id", site.id).gte("created_at", dayAgo),
    countMessages().gte("created_at", hourAgo),
  ]);
  const countError = byIp.error || bySite.error || global.error;
  if (countError) {
    console.error("sites/contact: error al contar mensajes", countError);
    return json({ ok: false, error: "No pudimos enviar tu mensaje. Inténtalo más tarde." }, 503);
  }
  if ((byIp.count || 0) >= RATE_LIMIT_PER_HOUR) {
    return json({ ok: false, error: "Enviaste demasiados mensajes. Inténtalo en una hora." }, 429);
  }
  if ((bySite.count || 0) >= SITE_LIMIT_PER_DAY) {
    return json({ ok: false, error: "Este sitio recibió muchos mensajes hoy. Inténtalo mañana." }, 429);
  }
  if ((global.count || 0) >= globalHourlyCap()) {
    console.warn("sites/contact: tope global de mensajes por hora alcanzado");
    return json({ ok: false, error: "No pudimos enviar tu mensaje. Inténtalo más tarde." }, 429);
  }

  const phone = data.phone ? oneLine(data.phone) : null;
  const { data: saved, error: insertError } = await supabase
    .from("aitickets_site_contact_messages")
    .insert({
      site_id: site.id,
      name: oneLine(data.name),
      email: data.email,
      phone,
      message: data.message,
      ip_hash: ipHash,
      user_agent: (request.headers.get("user-agent") || "").slice(0, 512) || null,
    })
    .select("id")
    .single();
  if (insertError || !saved) {
    console.error("sites/contact: error al guardar el mensaje", insertError);
    return json({ ok: false, error: "No pudimos enviar tu mensaje. Inténtalo más tarde." }, 500);
  }

  // Envío al productor (el mensaje ya quedó guardado aunque el correo falle)
  const recipient = siteContactRecipient(site);
  const siteName = site.content?.title || site.org?.public_name || site.slug;
  let mailError: string | null = null;
  if (site.org?.email_verified !== true) {
    mailError = "organizacion_sin_verificar";
  } else if (!recipient || !isValidEmail(recipient)) {
    mailError = "sin_destinatario";
  } else {
    try {
      await sendEmail({
        to: recipient,
        subject: `Nuevo mensaje de ${oneLine(data.name).slice(0, 80)} desde tu sitio`,
        html: buildEmailHtml(site, siteName, { name: oneLine(data.name), email: data.email, phone, message: data.message }),
        replyTo: formatRecipient(oneLine(data.name), data.email),
        tags: ["site-contact"],
      });
    } catch (err: any) {
      console.error("sites/contact: error al enviar el correo", err);
      mailError = String(err?.message || err || "error").slice(0, 500);
    }
  }

  const { error: updateError } = await supabase
    .from("aitickets_site_contact_messages")
    .update(mailError ? { mail_error: mailError } : { delivered_at: new Date().toISOString() })
    .eq("id", saved.id)
    .eq("site_id", site.id);
  if (updateError) console.error("sites/contact: error al actualizar el estado del envío", updateError);

  return json({ ok: true });
};

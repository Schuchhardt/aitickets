// POST /api/sites/contact — formulario de contacto de un sitio de productor.
//
// Público (sin sesión). Antiabuso: honeypot vacío, al menos 3 s desde que se abrió el formulario,
// máximo 5 mensajes por hora por IP (hash sha256(IP + INTERNAL_API_SECRET)), máximo 20 por día por sitio
// y un tope global por hora (SITE_CONTACT_GLOBAL_HOURLY_CAP, 200 por defecto), todo contado en
// aitickets_site_contact_messages, y Turnstile cuando el host efectivo está bajo aitickets.cl.
// El mensaje se guarda primero y luego se envía por Resend al productor con Reply-To = visitante.
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
import { sendEmail, isValidEmail, formatRecipient } from "../../../../netlify/lib/mailer.mjs";
import { renderSiteContactMessageEmail } from "../../../../netlify/lib/emails/index.mjs";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";

export const prerender = false;

const RATE_LIMIT_PER_HOUR = 5;
const SITE_LIMIT_PER_DAY = 20;
// Intentos (válidos o no, antes de Turnstile y de guardar): límite durable por IP y por IP + sitio en
// aitickets_rate_limits. Complementa los topes de arriba, que solo cuentan mensajes guardados.
const ATTEMPTS_PER_IP = { bucket: "site-contact:ip", windowSeconds: 60 * 60, max: 30 };
const ATTEMPTS_PER_IP_SITE = { bucket: "site-contact:ip-site", windowSeconds: 60 * 60, max: 10 };

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

const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

function ipHashFor(ip: string): string {
  const pepper = import.meta.env.INTERNAL_API_SECRET || (globalThis as any).process?.env?.INTERNAL_API_SECRET || "aitickets";
  return createHash("sha256").update(`${ip}|${pepper}`).digest("hex");
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

  // El sitio demo no toca la BD (tampoco para contar intentos)
  if (!site.is_demo) {
    const supabaseForLimits = getSupabaseAdmin();
    const [ipAttempts, ipSiteAttempts] = await Promise.all([
      rateLimit(ATTEMPTS_PER_IP.bucket, ip, { ...ATTEMPTS_PER_IP, supabase: supabaseForLimits }),
      rateLimit(ATTEMPTS_PER_IP_SITE.bucket, ip === "unknown" ? null : `${ip}|${site.id}`, { ...ATTEMPTS_PER_IP_SITE, supabase: supabaseForLimits }),
    ]);
    if (!ipAttempts.allowed || !ipSiteAttempts.allowed) {
      return json({ ok: false, error: "Enviaste demasiados mensajes. Inténtalo en una hora." }, 429);
    }
  }

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
      const email = await renderSiteContactMessageEmail({
        siteName,
        contactUrl: siteUrl(site, "/contacto"),
        name: oneLine(data.name),
        email: data.email,
        phone,
        message: data.message,
      });
      await sendEmail({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
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

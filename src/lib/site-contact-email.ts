// Confirmación del correo que recibe el formulario de contacto del sitio (aitickets_sites.contact_email).
// Solo servidor.
//
// Un contact_email distinto del correo (verificado) de la organización NO se guarda al escribirlo en el
// dashboard: se envía un enlace firmado a esa dirección y recién al abrirlo se guarda. Así nadie puede
// usar el formulario de contacto para mandar correos, desde nuestro dominio de envío (Resend), a una dirección
// que no controla.
//
// Token: base64url(JSON {p:'site_contact_email', sid, oid, e, exp}).base64url(HMAC-SHA256), 48 h.
// Clave: EMAIL_VERIFY_SECRET, o derivada de INTERNAL_API_SECRET / service role con etiqueta propia.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "./auth-helpers";
import { mainOrigin, invalidateSiteCache } from "./sites";
import { sendEmail, legalFooterHtml, isValidEmail } from "../../netlify/lib/mailer.mjs";

const PURPOSE = "site_contact_email";
export const CONTACT_EMAIL_CONFIRM_TTL_SECONDS = 48 * 3600;
/** Mínimo entre dos correos de confirmación del mismo sitio (en memoria, por instancia). */
const RESEND_MIN_INTERVAL_MS = 60 * 1000;
const lastSentBySite = new Map<number, number>();

function readEnv(name: string): string {
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const value = fromProcess ?? (import.meta.env as Record<string, string | undefined>)[name];
  return value ? String(value).trim() : "";
}

function signingKey(): Buffer {
  const base = readEnv("EMAIL_VERIFY_SECRET") || readEnv("INTERNAL_API_SECRET") || readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!base) throw new Error("EMAIL_VERIFY_SECRET no configurado");
  return createHmac("sha256", "aitickets-site-contact-email").update(base).digest();
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function signContactEmailToken(siteId: number, orgId: number, email: string, now = Date.now()): string {
  const payload = b64url(
    JSON.stringify({
      p: PURPOSE,
      sid: siteId,
      oid: orgId,
      e: String(email).trim().toLowerCase(),
      exp: Math.floor(now / 1000) + CONTACT_EMAIL_CONFIRM_TTL_SECONDS,
    })
  );
  const sig = b64url(createHmac("sha256", signingKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

export type ContactEmailTokenResult =
  | { ok: true; siteId: number; orgId: number; email: string }
  | { ok: false; error: "invalid" | "expired" };

export function verifyContactEmailToken(token: string, now = Date.now()): ContactEmailTokenResult {
  try {
    if (typeof token !== "string" || token.length > 2048) return { ok: false, error: "invalid" };
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return { ok: false, error: "invalid" };
    const expected = createHmac("sha256", signingKey()).update(payload).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, error: "invalid" };
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.p !== PURPOSE || !Number.isInteger(data.sid) || !Number.isInteger(data.oid) || typeof data.e !== "string") {
      return { ok: false, error: "invalid" };
    }
    if (!isValidEmail(data.e)) return { ok: false, error: "invalid" };
    if (!Number.isFinite(data.exp) || data.exp * 1000 < now) return { ok: false, error: "expired" };
    return { ok: true, siteId: data.sid, orgId: data.oid, email: data.e };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Envía el enlace de confirmación a `email`. Devuelve { ok:false, reason:'throttled' } si se pidió
 * hace menos de un minuto para el mismo sitio. Lanza si Resend falla.
 */
export async function sendContactEmailConfirmation(opts: {
  siteId: number;
  orgId: number;
  email: string;
  orgName: string;
}): Promise<{ ok: true } | { ok: false; reason: "throttled" }> {
  const now = Date.now();
  const last = lastSentBySite.get(opts.siteId) || 0;
  if (now - last < RESEND_MIN_INTERVAL_MS) return { ok: false, reason: "throttled" };
  lastSentBySite.set(opts.siteId, now);

  const link = `${mainOrigin()}/api/sites/contact-email-confirm?t=${encodeURIComponent(
    signContactEmailToken(opts.siteId, opts.orgId, opts.email, now)
  )}`;
  const html = `<!doctype html><html lang="es-CL"><body style="margin:0;background:#f9fafb;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;border:1px solid #e5e7eb">
<h1 style="font-size:20px;margin:0 0 12px 0">Confirma el correo de contacto de tu sitio</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 20px 0">${escapeHtml(opts.orgName)} quiere recibir en esta dirección los mensajes del formulario de contacto de su sitio web en AI Tickets. Si fuiste tú, confírmalo:</p>
<p style="text-align:center;margin:0 0 20px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;background:#111827;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">Confirmar este correo</a></p>
<p style="font-size:13px;line-height:1.6;color:#6b7280;margin:0 0 8px 0">El enlace vence en 48 horas. Si no lo pediste, ignora este correo: no recibirás mensajes.</p>
${legalFooterHtml({ reason: "Recibes este correo porque alguien escribió esta dirección como correo de contacto de un sitio en AI Tickets." })}
</div></body></html>`;
  try {
    await sendEmail({
      to: opts.email,
      subject: "Confirma el correo de contacto de tu sitio en AI Tickets",
      html,
      tags: ["site-contact-email-confirm"],
    });
  } catch (err) {
    lastSentBySite.delete(opts.siteId);
    throw err;
  }
  return { ok: true };
}

export type ConfirmContactEmailResult = { ok: true } | { ok: false; error: "invalid" | "expired" | "not_found" | "server" };

/** Procesa el enlace: guarda contact_email en el sitio del token (filtrado por sitio y organización). */
export async function confirmContactEmail(token: string): Promise<ConfirmContactEmailResult> {
  let parsed: ContactEmailTokenResult;
  try {
    parsed = verifyContactEmailToken(token);
  } catch (err: any) {
    console.error("site-contact-email:", err?.message);
    return { ok: false, error: "server" };
  }
  if (!parsed.ok) return parsed;
  const { data, error } = await getSupabaseAdmin()
    .from("aitickets_sites")
    .update({ contact_email: parsed.email, updated_at: new Date().toISOString() })
    .eq("id", parsed.siteId)
    .eq("organization_id", parsed.orgId)
    .select("slug")
    .maybeSingle();
  if (error) {
    console.error("site-contact-email: error al guardar", error.message);
    return { ok: false, error: "server" };
  }
  if (!data) return { ok: false, error: "not_found" };
  try {
    invalidateSiteCache(data.slug);
  } catch {
    /* caché best-effort */
  }
  return { ok: true };
}

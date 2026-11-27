// POST /api/panoramas/reviews — "¿Fuiste?" de un panorama (evento externo de /panoramas). Público, sin sesión.
//
// multipart/form-data: event_id, rating (1-5), comment, email, name?, date_id?, file (comprobante), turnstile_token?,
//   hp (honeypot, vacío) y started_at (ms; al menos 3 s antes del envío).
// El comprobante (pantallazo de la entrada, PDF o correo .eml, máx. 5 MB; el tipo se detecta por los bytes) va al
// bucket PRIVADO aitickets-panorama-proofs. El comentario queda "pending": se publica solo cuando el admin lo valida
// desde el MCP de administración (list_panorama_reviews → get_panorama_review → moderate_panorama_reviews).
// Una opinión por correo y evento; si la anterior fue rechazada, se reemplaza.
// → 201 { ok, message } | 400 | 404 | 409 | 413 | 429 | 503
import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { jsonResponse } from "../../../lib/supabaseServer";
import { clientIpFrom } from "../../../lib/sites";
import { todayChile } from "../../../lib/market/calendar";
import { EVENT_DATES_TABLE, EXTERNAL_EVENTS_TABLE } from "../../../lib/market/data";
import {
  COMMENT_MAX,
  COMMENT_MIN,
  hashIp,
  isPanoramaSchemaMissing,
  NAME_MAX,
  PANORAMA_PROOFS_BUCKET,
  PANORAMA_REVIEWS_TABLE,
  PANORAMAS_UNAVAILABLE,
  PROOF_MAX_BYTES,
  proofPath,
  sha256Hex,
  sniffProof,
} from "../../../lib/panoramas";
import { rateLimit } from "../../../../netlify/lib/rate-limit.mjs";
import { verifyTurnstile } from "../../../../netlify/lib/turnstile.mjs";
import { isValidEmail, SITE_URL } from "../../../../netlify/lib/mailer.mjs";
import { notifySlack } from "../../../../netlify/lib/slack.mjs";

export const prerender = false;

const LIMIT_IP = { windowSeconds: 30 * 60, max: 8 };
const LIMIT_EMAIL = { windowSeconds: 24 * 60 * 60, max: 10 };
const MIN_FILL_MS = 3000;

const clean = (v: FormDataEntryValue | null, max: number) =>
  typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";
const KIND_LABEL = { image: "pantallazo", pdf: "PDF", email: "correo" } as const;

export const POST: APIRoute = async ({ request }) => {
  const ip = clientIpFrom(request);
  const byIp = await rateLimit("panorama-reviews:ip", ip, LIMIT_IP);
  if (!byIp.allowed) return jsonResponse({ message: "Demasiados intentos seguidos. Espera unos minutos." }, 429);

  const length = Number(request.headers.get("content-length") || 0);
  if (length > PROOF_MAX_BYTES + 256 * 1024) return jsonResponse({ message: "El archivo no debe superar los 5 MB." }, 413);

  const form = await request.formData().catch(() => null);
  if (!form) return jsonResponse({ message: "Solicitud inválida." }, 400);

  // Bots: honeypot lleno o enviado en menos de 3 s → se responde como si nada (no se guarda)
  const startedAt = Number(form.get("started_at"));
  if (clean(form.get("hp"), 200) || (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < MIN_FILL_MS)) {
    return jsonResponse({ ok: true, message: "¡Gracias! Revisaremos tu comprobante y publicaremos tu comentario." }, 201);
  }

  const eventId = Number(form.get("event_id"));
  const rating = Number(form.get("rating"));
  const comment = clean(form.get("comment"), COMMENT_MAX + 1);
  const email = clean(form.get("email"), 254).toLowerCase();
  const name = clean(form.get("name"), NAME_MAX + 1).replace(/\s+/g, " ");
  const dateIdRaw = clean(form.get("date_id"), 20);
  const dateId = dateIdRaw ? Number(dateIdRaw) : null;
  const file = form.get("file");

  if (!Number.isSafeInteger(eventId) || eventId <= 0) return jsonResponse({ message: "Evento inválido." }, 400);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return jsonResponse({ message: "Elige de 1 a 5 estrellas." }, 400);
  if (comment.length < COMMENT_MIN) return jsonResponse({ message: `Cuéntanos un poco más (mínimo ${COMMENT_MIN} caracteres).` }, 400);
  if (comment.length > COMMENT_MAX) return jsonResponse({ message: `El comentario no puede superar los ${COMMENT_MAX} caracteres.` }, 400);
  if (name.length > NAME_MAX) return jsonResponse({ message: `El nombre no puede superar los ${NAME_MAX} caracteres.` }, 400);
  if (!isValidEmail(email)) return jsonResponse({ message: "Escribe un correo válido." }, 400);
  if (dateId !== null && (!Number.isSafeInteger(dateId) || dateId <= 0)) return jsonResponse({ message: "Función inválida." }, 400);
  if (!file || typeof file === "string" || !file.size) return jsonResponse({ message: "Sube tu comprobante: pantallazo de la entrada, PDF o el correo de compra." }, 400);
  if (file.size > PROOF_MAX_BYTES) return jsonResponse({ message: "El archivo no debe superar los 5 MB." }, 413);

  const byEmail = await rateLimit("panorama-reviews:email", email, LIMIT_EMAIL);
  if (!byEmail.allowed) return jsonResponse({ message: "Ya enviaste varios comentarios hoy. Inténtalo mañana." }, 429);

  const captcha = await verifyTurnstile(clean(form.get("turnstile_token"), 4096), ip);
  if (!captcha.success) return jsonResponse({ message: captcha.message || "Completa la verificación de seguridad." }, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const proof = sniffProof(buffer);
  if (!proof) return jsonResponse({ message: "Formato no permitido: sube una imagen (JPG, PNG, WEBP o HEIC), un PDF o el correo en formato .eml." }, 400);

  try {
    const supabase = getSupabaseAdmin();
    const today = todayChile();
    const { data: event, error: eErr } = await supabase.from(EXTERNAL_EVENTS_TABLE).select("id, name, public_status").eq("id", eventId).maybeSingle();
    if (eErr) throw eErr;
    if (!event || event.public_status === "hidden") return jsonResponse({ message: "Este panorama no existe o ya no está publicado." }, 404);
    const { data: dates, error: dErr } = await supabase.from(EVENT_DATES_TABLE).select("id, event_date, status").eq("event_id", eventId);
    if (dErr) throw dErr;
    const live = (dates || []).filter((d: any) => d.status !== "cancelled");
    if (!live.some((d: any) => d.event_date <= today)) return jsonResponse({ message: "Podrás contar cómo estuvo cuando el evento haya empezado." }, 400);
    if (dateId !== null && !(dates || []).some((d: any) => Number(d.id) === dateId)) return jsonResponse({ message: "Esa función no es de este evento." }, 400);
    const eventDateId = dateId ?? (live.length === 1 ? Number(live[0].id) : null);

    const { data: existing, error: xErr } = await supabase
      .from(PANORAMA_REVIEWS_TABLE)
      .select("id, status, proof_path")
      .eq("event_id", eventId)
      .eq("email", email)
      .maybeSingle();
    if (xErr) throw xErr;
    if (existing && existing.status !== "rejected") {
      return jsonResponse(
        { message: existing.status === "pending" ? "Ya recibimos tu comentario: lo estamos revisando." : "Ya publicamos un comentario tuyo para este evento." },
        409,
      );
    }

    const path = proofPath(eventId, proof.ext);
    const { error: upErr } = await supabase.storage.from(PANORAMA_PROOFS_BUCKET).upload(path, buffer, { contentType: proof.contentType, upsert: false });
    if (upErr) throw new Error(`No se pudo guardar el comprobante: ${upErr.message}`);

    const now = new Date().toISOString();
    const row = {
      event_id: eventId,
      event_date_id: eventDateId,
      rating,
      comment,
      display_name: name || null,
      email,
      proof_path: path,
      proof_kind: proof.kind,
      proof_content_type: proof.contentType,
      proof_bytes: buffer.length,
      proof_sha256: sha256Hex(buffer),
      status: "pending",
      public_comment: null,
      moderation_note: null,
      moderated_at: null,
      proof_deleted_at: null,
      ip_hash: hashIp(ip),
      updated_at: now,
    };
    const saved = existing
      ? await supabase.from(PANORAMA_REVIEWS_TABLE).update(row).eq("id", existing.id).select("id").single()
      : await supabase.from(PANORAMA_REVIEWS_TABLE).insert({ id: randomUUID(), ...row, created_at: now }).select("id").single();
    if (saved.error) {
      await supabase.storage.from(PANORAMA_PROOFS_BUCKET).remove([path]).catch(() => null);
      if (String(saved.error.code) === "23505") return jsonResponse({ message: "Ya recibimos tu comentario: lo estamos revisando." }, 409);
      throw saved.error;
    }
    if (existing?.proof_path) await supabase.storage.from(PANORAMA_PROOFS_BUCKET).remove([existing.proof_path]).catch(() => null);

    await notifySlack(
      `🗣️ Panoramas: comentario nuevo por validar (${rating}★, ${KIND_LABEL[proof.kind]}) en "${String(event.name).slice(0, 120)}". ` +
        `Revísalo en el MCP de admin con list_panorama_reviews. ${SITE_URL}/panoramas/evento/${eventId}`,
    );
    return jsonResponse({ ok: true, message: "¡Gracias! Revisaremos tu comprobante y publicaremos tu comentario en los próximos días." }, 201);
  } catch (err: any) {
    if (isPanoramaSchemaMissing(err)) return jsonResponse({ message: PANORAMAS_UNAVAILABLE }, 503);
    console.error("panoramas/reviews:", err?.message || err);
    return jsonResponse({ message: "No pudimos recibir tu comentario. Inténtalo de nuevo." }, 500);
  }
};

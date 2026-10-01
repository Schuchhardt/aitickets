// Gestión de códigos de descuento desde el dashboard (service role => autorización explícita aquí).
//   GET   /api/discount-codes[?event_id=N]  lista los códigos de la organización (con event_id: los del evento
//                                          + los de toda la organización), con usos y métricas.
//   POST  /api/discount-codes              crea { code, kind, value, eventId?, maxUses?, perBuyerLimit?, startsAt?, endsAt? }
//   PATCH /api/discount-codes              { id, active?, maxUses?, perBuyerLimit?, startsAt?, endsAt? }
// Código, tipo, valor y evento no se editan (las órdenes ya emitidas los referencian): se desactiva y se crea otro.
// Roles: EVENT_MANAGER_ROLES. Todas las consultas filtran por organization_id de la sesión; un evento solo
// se acepta si pertenece a la organización (getOwnedEvent).
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../lib/auth-helpers";
import { getSessionContext, getOwnedEvent, hasRole, EVENT_MANAGER_ROLES, jsonResponse } from "../../../lib/supabaseServer";
import { validateDiscountInput, describeDiscount, isMissingDiscountSchema, DISCOUNT_CODE_COLUMNS } from "../../../../netlify/lib/discounts.mjs";

export const prerender = false;

const MAX_CODES_PER_ORG = 500;
const UNAVAILABLE = "Los códigos de descuento aún no están disponibles. Intenta nuevamente en unos minutos.";

type ManagerAuth = { ok: false; response: Response } | { ok: true; orgId: number; userId: number | null };

async function requireManager(context: Parameters<APIRoute>[0]): Promise<ManagerAuth> {
  const session = await getSessionContext(context);
  if (!session) return { ok: false, response: jsonResponse({ error: "Unauthorized" }, 401) };
  if (!hasRole(session.dbUser, EVENT_MANAGER_ROLES) || !session.dbUser.organization_id) {
    return { ok: false, response: jsonResponse({ message: "No tienes permisos para gestionar códigos de descuento" }, 403) };
  }
  return { ok: true, orgId: Number(session.dbUser.organization_id), userId: session.dbUser.id ?? null };
}

type Stats = { uses: number; paid_orders: number; discount_total: number; revenue: number };

async function loadStats(supabase: any, ids: string[]): Promise<Map<string, Stats>> {
  const map = new Map<string, Stats>();
  if (!ids.length) return map;
  const { data, error } = await supabase.rpc("aitickets_discount_code_stats", { p_code_ids: ids });
  if (error) {
    console.warn("aitickets_discount_code_stats no disponible:", error.message);
    return map;
  }
  for (const r of data || []) {
    map.set(String(r.code_id), {
      uses: Number(r.uses) || 0,
      paid_orders: Number(r.paid_orders) || 0,
      discount_total: Number(r.discount_total) || 0,
      revenue: Number(r.revenue) || 0,
    });
  }
  return map;
}

function present(row: any, stats: Stats | undefined, eventNames: Map<number, string>) {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    value: Number(row.value),
    label: describeDiscount({ kind: row.kind, value: row.value }),
    eventId: row.event_id ?? null,
    eventName: row.event_id != null ? eventNames.get(Number(row.event_id)) || null : null,
    maxUses: row.max_uses ?? null,
    perBuyerLimit: row.per_buyer_limit ?? null,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    active: row.active !== false,
    createdAt: row.created_at,
    uses: stats?.uses || 0,
    paidOrders: stats?.paid_orders || 0,
    discountTotal: stats?.discount_total || 0,
    revenue: stats?.revenue || 0,
  };
}

async function eventNamesFor(supabase: any, orgId: number, rows: any[]) {
  const ids = [...new Set(rows.map((r) => r.event_id).filter((v) => v != null).map(Number))];
  const names = new Map<number, string>();
  if (!ids.length) return names;
  const { data } = await supabase.from("events").select("id, name").eq("organization_id", orgId).in("id", ids);
  for (const e of data || []) names.set(Number(e.id), e.name);
  return names;
}

export const GET: APIRoute = async (context) => {
  const auth = await requireManager(context);
  if (!auth.ok) return auth.response;
  const supabase = getSupabaseAdmin();

  const eventParam = context.url.searchParams.get("event_id");
  let eventId: number | null = null;
  if (eventParam) {
    const event = await getOwnedEvent<{ id: number }>(eventParam, auth.orgId, "id");
    if (!event) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);
    eventId = Number(event.id);
  }

  const query = supabase
    .from("aitickets_discount_codes")
    .select(DISCOUNT_CODE_COLUMNS)
    .eq("organization_id", auth.orgId)
    .order("created_at", { ascending: false })
    .limit(MAX_CODES_PER_ORG);
  const { data: rows, error } = await query;
  if (error) {
    if (isMissingDiscountSchema(error)) return jsonResponse({ codes: [], unavailable: true });
    console.error("discount-codes GET:", error.message);
    return jsonResponse({ message: "No se pudieron cargar los códigos" }, 500);
  }
  // Con evento: los del evento + los de toda la organización (también aplican a este evento)
  const list = (rows || []).filter((r: any) => eventId == null || r.event_id == null || Number(r.event_id) === eventId);
  const [stats, names] = await Promise.all([loadStats(supabase, list.map((r: any) => r.id)), eventNamesFor(supabase, auth.orgId, list)]);
  return jsonResponse({ codes: list.map((r: any) => present(r, stats.get(String(r.id)), names)) });
};

export const POST: APIRoute = async (context) => {
  const auth = await requireManager(context);
  if (!auth.ok) return auth.response;
  const supabase = getSupabaseAdmin();

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ message: "Solicitud inválida" }, 400);
  }
  const parsed = validateDiscountInput({ ...body, eventId: body?.eventId ?? null, active: true });
  if ("error" in parsed) return jsonResponse({ message: parsed.error }, 400);
  const values: any = parsed.values;

  if (values.event_id != null) {
    const event = await getOwnedEvent<{ id: number }>(values.event_id, auth.orgId, "id");
    if (!event) return jsonResponse({ message: "Evento no encontrado o no autorizado" }, 404);
  }

  const { count, error: countError } = await supabase
    .from("aitickets_discount_codes")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", auth.orgId);
  if (countError && isMissingDiscountSchema(countError)) return jsonResponse({ message: UNAVAILABLE }, 503);
  if ((count || 0) >= MAX_CODES_PER_ORG) {
    return jsonResponse({ message: `Alcanzaste el máximo de ${MAX_CODES_PER_ORG} códigos. Desactiva o reutiliza alguno.` }, 409);
  }

  const { data: created, error } = await supabase
    .from("aitickets_discount_codes")
    .insert([{ ...values, organization_id: auth.orgId, created_by: auth.userId ?? null }])
    .select(DISCOUNT_CODE_COLUMNS)
    .single();
  if (error) {
    if (String(error.code) === "23505") return jsonResponse({ message: `Ya existe el código ${values.code} en tu organización.` }, 409);
    if (isMissingDiscountSchema(error)) return jsonResponse({ message: UNAVAILABLE }, 503);
    console.error("discount-codes POST:", error.message);
    return jsonResponse({ message: "No se pudo crear el código" }, 500);
  }
  const names = await eventNamesFor(supabase, auth.orgId, [created]);
  return jsonResponse({ code: present(created, undefined, names) }, 201);
};

export const PATCH: APIRoute = async (context) => {
  const auth = await requireManager(context);
  if (!auth.ok) return auth.response;
  const supabase = getSupabaseAdmin();

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ message: "Solicitud inválida" }, 400);
  }
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse({ message: "Código inválido" }, 400);
  for (const k of ["code", "kind", "value", "eventId"]) {
    if (body[k] !== undefined) {
      return jsonResponse({ message: "El código, el tipo, el valor y el evento no se pueden editar: desactívalo y crea uno nuevo." }, 400);
    }
  }
  const editable = ["active", "maxUses", "perBuyerLimit", "startsAt", "endsAt"];
  const patchBody = Object.fromEntries(editable.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  if (!Object.keys(patchBody).length) return jsonResponse({ message: "No hay cambios" }, 400);
  const parsed = validateDiscountInput(patchBody, { partial: true });
  if ("error" in parsed) return jsonResponse({ message: parsed.error }, 400);
  const values: any = parsed.values;

  const { data: existing, error: loadError } = await supabase
    .from("aitickets_discount_codes")
    .select(DISCOUNT_CODE_COLUMNS)
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .maybeSingle();
  if (loadError) {
    if (isMissingDiscountSchema(loadError)) return jsonResponse({ message: UNAVAILABLE }, 503);
    return jsonResponse({ message: "No se pudo cargar el código" }, 500);
  }
  if (!existing) return jsonResponse({ message: "Código no encontrado" }, 404);

  const startsAt = values.starts_at !== undefined ? values.starts_at : existing.starts_at;
  const endsAt = values.ends_at !== undefined ? values.ends_at : existing.ends_at;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return jsonResponse({ message: "La fecha de término debe ser posterior a la de inicio." }, 400);
  }

  const { data: updated, error } = await supabase
    .from("aitickets_discount_codes")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", auth.orgId)
    .select(DISCOUNT_CODE_COLUMNS)
    .maybeSingle();
  if (error || !updated) {
    console.error("discount-codes PATCH:", error?.message);
    return jsonResponse({ message: "No se pudo actualizar el código" }, 500);
  }
  const [stats, names] = await Promise.all([loadStats(supabase, [updated.id]), eventNamesFor(supabase, auth.orgId, [updated])]);
  return jsonResponse({ code: present(updated, stats.get(String(updated.id)), names) });
};

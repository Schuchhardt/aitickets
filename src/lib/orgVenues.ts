// Lugares (venues) visibles para una organización.
//
// venues es compartida entre organizaciones. Una organización puede ver y usar:
//   * los lugares con venues.organization_id = su organización (migración 202609290200), y
//   * los lugares que ya usan sus eventos (event_locations), incluidos los legados sin dueño.
// Si la columna organization_id todavía no existe (deploy preview antes de migrar) se usa solo el
// segundo criterio, que sigue impidiendo ver o usar lugares de otras organizaciones.

export type OrgVenue = { id: string; name: string; city: string | null };

type QueryError = { code?: string; message?: string } | null | undefined;

const VENUE_COLUMNS = "id, name, city";

/** Error de PostgREST/Postgres por columna inexistente (o cache de esquema sin la columna). */
export function isMissingColumnError(error: QueryError, column = "organization_id"): boolean {
  if (!error) return false;
  const code = String(error.code || "");
  const message = String(error.message || "");
  if (!message.includes(column)) return false;
  return code === "42703" || code === "PGRST204" || /does not exist|could not find|schema cache/i.test(message);
}

/** Une listas de lugares sin duplicados (por id) y las ordena por nombre (es-CL). */
export function mergeVenues(...lists: Array<OrgVenue[] | null | undefined>): OrgVenue[] {
  const byId = new Map<string, OrgVenue>();
  for (const list of lists) {
    for (const v of list || []) {
      if (!v?.id) continue;
      const id = String(v.id);
      if (!byId.has(id)) byId.set(id, { id, name: v.name || "", city: v.city ?? null });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "es-CL", { sensitivity: "base" }));
}

/** ids de lugares usados por los eventos de la organización. */
async function usedVenueIds(supabase: any, orgId: number | string): Promise<string[]> {
  const { data, error } = await supabase
    .from("event_locations")
    .select("venue_id, events!inner(organization_id)")
    .eq("events.organization_id", orgId)
    .limit(5000);
  if (error) throw error;
  return [...new Set<string>((data || []).map((r: any) => r?.venue_id).filter(Boolean).map(String))];
}

/**
 * Lugares que la organización puede ver/usar, ordenados por nombre.
 * `hasOrgColumn` indica si venues.organization_id existe (para crear lugares con dueño).
 */
export async function listOrgVenues(
  supabase: any,
  orgId: number | string | null | undefined,
): Promise<{ venues: OrgVenue[]; hasOrgColumn: boolean }> {
  if (orgId === null || orgId === undefined || orgId === "") return { venues: [], hasOrgColumn: true };

  let owned: OrgVenue[] = [];
  let hasOrgColumn = true;
  const ownedRes = await supabase.from("venues").select(VENUE_COLUMNS).eq("organization_id", orgId).limit(1000);
  if (ownedRes.error) {
    if (!isMissingColumnError(ownedRes.error)) throw ownedRes.error;
    hasOrgColumn = false;
  } else {
    owned = ownedRes.data || [];
  }

  const ownedIds = new Set(owned.map((v) => String(v.id)));
  const missing = (await usedVenueIds(supabase, orgId)).filter((id) => !ownedIds.has(id));
  let used: OrgVenue[] = [];
  if (missing.length) {
    const { data, error } = await supabase.from("venues").select(VENUE_COLUMNS).in("id", missing);
    if (error) throw error;
    used = data || [];
  }

  return { venues: mergeVenues(owned, used), hasOrgColumn };
}

/** true si el venueId pertenece al conjunto permitido. */
export function isVenueAllowed(venueId: unknown, allowed: Iterable<OrgVenue | string>): boolean {
  if (venueId === null || venueId === undefined || venueId === "") return false;
  const id = String(venueId);
  for (const v of allowed) if ((typeof v === "string" ? v : String(v.id)) === id) return true;
  return false;
}

/**
 * Crea un lugar de la organización. Si la columna organization_id no existe (preview), lo crea sin
 * dueño: queda visible solo para la organización porque su evento lo usa.
 */
export async function insertOrgVenue(
  supabase: any,
  orgId: number | string,
  venue: { name: string; address_line1?: string | null; city?: string | null },
  hasOrgColumn = true,
): Promise<string> {
  const base = {
    name: venue.name,
    address_line1: venue.address_line1 || null,
    city: venue.city || null,
    country_code: "CL",
    timezone: "America/Santiago",
  };
  if (hasOrgColumn) {
    const { data, error } = await supabase
      .from("venues")
      .insert({ ...base, organization_id: orgId })
      .select("id")
      .single();
    if (!error) return String(data.id);
    if (!isMissingColumnError(error)) throw error;
  }
  const { data, error } = await supabase.from("venues").insert(base).select("id").single();
  if (error) throw error;
  return String(data.id);
}

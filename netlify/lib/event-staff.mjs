// Acceso por evento (aitickets_event_staff, migración 202610090200): si un usuario tiene filas ahí, solo
// puede ver y operar esos eventos (p. ej. el equipo de puerta de un evento). Sin filas = todos los eventos
// de su organización. Si la tabla no existe todavía (preview sin migrar) no se restringe (la organización del
// evento se sigue validando aparte en cada ruta). Cualquier OTRO error de lectura falla cerrado: sin eventos.

/**
 * IDs de eventos asignados al usuario, o null si no tiene restricción.
 * @param {any} supabase cliente con service role
 * @param {number|string} userId public.users.id
 * @returns {Promise<number[]|null>}
 */
export async function getStaffEventIds(supabase, userId) {
  if (userId == null) return null
  try {
    const { data, error } = await supabase.from('aitickets_event_staff').select('event_id').eq('user_id', Number(userId))
    if (error) {
      if (isMissingStaffTable(error)) return null
      console.error('aitickets_event_staff:', error.message)
      return []
    }
    if (!data?.length) return null
    return data.map((r) => Number(r.event_id))
  } catch (err) {
    console.error('aitickets_event_staff:', err?.message || err)
    return []
  }
}

/** La tabla todavía no existe (deploy preview sobre una BD sin la migración 202610090200). */
export const isMissingStaffTable = (error) => ['42P01', 'PGRST205'].includes(String(error?.code || ''))

/** true si el usuario puede acceder al evento según sus asignaciones (no valida la organización). */
export async function canAccessEventByStaff(supabase, userId, eventId) {
  const ids = await getStaffEventIds(supabase, userId)
  return !ids || ids.includes(Number(eventId))
}

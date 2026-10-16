// Nombre del comprador: el checkout pide un solo campo "Nombre y apellido" y el servidor lo divide.
// Nombre de pila => first_name; el resto => last_name (puede quedar vacío: "" y no NULL).
// El nombre de pila es el primer token, o los dos (o más) primeros si forman un nombre compuesto conocido
// ("María José Pérez" => "María José" + "Pérez"; "Juan de Dios Soto" => "Juan de Dios" + "Soto").
// Lo usan purchase-tickets, la transferencia de entradas y los correos a asistentes. Sin dependencias de Node.

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Primer nombre => segundos nombres con los que suele formar un nombre compuesto. Solo pares comunes y sin
// ambigüedad con apellidos frecuentes (p. ej. no se incluye "Juan Cruz": Cruz también es apellido).
const COMPOUND_SECOND = {
  maria: 'jose jesus paz ignacia fernanda francisca teresa elena luisa belen victoria trinidad soledad eugenia constanza cecilia angelica isabel josefina alejandra veronica ines pia luz gracia magdalena antonieta cristina carolina javiera gabriela laura loreto rosa ester emilia catalina consuelo valentina florencia beatriz mercedes rita olga',
  ana: 'maria luisa belen paula karina sofia isabel',
  juan: 'pablo carlos jose ignacio manuel francisco andres cristobal esteban martin diego antonio luis pedro enrique eduardo felipe alberto ramon sebastian agustin david gabriel miguel ricardo jorge tomas vicente bautista rafael fernando daniel alejandro camilo marcos matias nicolas',
  jose: 'luis miguel antonio tomas ignacio manuel pablo maria francisco joaquin andres alberto carlos rafael pedro fernando ramon domingo vicente cristobal agustin',
  luis: 'felipe alberto antonio eduardo fernando alfonso enrique miguel ignacio carlos javier andres',
  pedro: 'pablo antonio jose',
  miguel: 'angel antonio ignacio',
  francisco: 'javier jose antonio ignacio',
  carlos: 'alberto eduardo andres felipe ignacio',
}
const SECOND_BY_FIRST = new Map(Object.entries(COMPOUND_SECOND).map(([k, v]) => [k, new Set(v.split(' '))]))

// Compuestos con "de/del/de la/de los" (sin el primer nombre). "María de la Fuente" no entra: Fuente no está.
const CONNECTOR_FORMS = {
  maria: ['del pilar', 'del carmen', 'del rosario', 'del mar', 'del sol', 'de los angeles', 'de la luz', 'de la paz', 'de jesus'],
  juan: ['de dios'],
}

/** Cuántos tokens iniciales forman el nombre de pila (1 si no es un compuesto conocido). */
function givenNameLength(tokens) {
  if (tokens.length < 2) return tokens.length
  const first = fold(tokens[0])
  const rest = tokens.slice(1).map(fold)
  for (const form of CONNECTOR_FORMS[first] || []) {
    const parts = form.split(' ')
    if (parts.every((p, i) => rest[i] === p)) return 1 + parts.length
  }
  return SECOND_BY_FIRST.get(first)?.has(rest[0]) ? 2 : 1
}

/**
 * @param {string} fullName
 * @returns {{firstName: string, lastName: string}}
 */
export function splitFullName(fullName) {
  const clean = String(fullName ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return { firstName: '', lastName: '' }
  const tokens = clean.split(' ')
  const n = givenNameLength(tokens)
  return { firstName: tokens.slice(0, n).join(' '), lastName: tokens.slice(n).join(' ') }
}

const LOWER_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'y'])

/** "maria jose" / "MARIA JOSE" => "Maria Jose". Si ya viene con mayúsculas y minúsculas se respeta tal cual. */
function fixCase(name) {
  if (name !== name.toLocaleLowerCase('es') && name !== name.toLocaleUpperCase('es')) return name
  return name
    .toLocaleLowerCase('es')
    .split(' ')
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toLocaleUpperCase('es') + w.slice(1)))
    .join(' ')
}

/**
 * Nombre para saludar ("¡Hola María José!") a partir de nombre y apellido guardados. Vuelve a dividir
 * nombre + apellido, así también corrige registros antiguos guardados como "María" + "José Pérez".
 * @param {string | null | undefined} firstName
 * @param {string | null | undefined} lastName
 * @param {string} [fallback]
 */
export function greetingName(firstName, lastName, fallback = 'Asistente') {
  // Sin nombre no se saluda por el apellido ("¡Hola Pérez!"): se usa el genérico
  if (!String(firstName ?? '').trim()) return fallback
  const { firstName: given } = splitFullName(`${firstName} ${lastName ?? ''}`)
  return given ? fixCase(given) : fallback
}

/**
 * Nombre del titular para un correo: el que escribió en la orden (buyer_first_name/last_name) y, si la orden
 * no lo tiene, el del attendee. El attendee se busca por email y se reutiliza entre compras sin actualizarse,
 * así que puede tener un nombre antiguo o mal escrito.
 * @param {{ first_name?: string | null, last_name?: string | null } | null | undefined} attendee
 * @param {{ buyer_first_name?: string | null, buyer_last_name?: string | null } | Array<any> | null | undefined} order
 * @returns {{ first_name: string | null, last_name: string | null }}
 */
export function holderName(attendee, order) {
  const o = Array.isArray(order) ? order[0] : order
  if (String(o?.buyer_first_name ?? '').trim()) return { first_name: o.buyer_first_name, last_name: o.buyer_last_name || null }
  return { first_name: attendee?.first_name || null, last_name: attendee?.last_name || null }
}

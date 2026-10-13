// Nombre del comprador: el checkout pide un solo campo "Nombre y apellido" y el servidor lo divide.
// Primer token => first_name; el resto => last_name (puede quedar vacío: "" y no NULL).
// Lo usan purchase-tickets y sus tests. Sin dependencias de Node.

/**
 * @param {string} fullName
 * @returns {{firstName: string, lastName: string}}
 */
export function splitFullName(fullName) {
  const clean = String(fullName ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return { firstName: '', lastName: '' }
  const space = clean.indexOf(' ')
  if (space === -1) return { firstName: clean, lastName: '' }
  return { firstName: clean.slice(0, space), lastName: clean.slice(space + 1) }
}

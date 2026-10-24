// Quién es el visitante en las páginas estáticas (portada, landings, header). Las cookies de sesión son HttpOnly,
// así que se miran las pistas sin datos ait_p (productor) / ait_b (asistente) que dejan el login y el link de
// acceso (netlify/lib/buyer-session.mjs); solo si existe alguna se pregunta a /api/auth/session (una vez por página).
const EMPTY = Object.freeze({ producer: null, buyer: null });

const hasCookie = (name) => typeof document !== "undefined" && document.cookie.split(";").some((c) => c.trim().startsWith(`${name}=`));

export const hasSessionHint = () => hasCookie("ait_p") || hasCookie("ait_b");

let pending = null;

/** @returns {Promise<{ producer: { name: string, organization: string } | null, buyer: { email: string } | null }>} */
export function fetchSession() {
  if (!hasSessionHint()) return Promise.resolve(EMPTY);
  if (!pending) {
    pending = fetch("/api/auth/session", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : EMPTY))
      .catch(() => EMPTY);
  }
  return pending;
}

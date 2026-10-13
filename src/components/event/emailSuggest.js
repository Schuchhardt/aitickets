// Sugerencia de typo en el dominio del email ("¿Quisiste decir seba@gmail.com?"). Reemplaza "Confirmar correo".
import { computed, unref } from "vue";

export const EMAIL_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.cl", "hotmail.cl", "yahoo.es", "me.com", "uc.cl", "uchile.cl"];

/** Distancia de Levenshtein (dominios cortos: O(n·m) basta). */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Email con el dominio corregido, o "" si no hay sugerencia (dominio conocido, muy distinto o incompleto). */
export function suggestEmail(email) {
  const value = String(email || "").trim();
  const at = value.lastIndexOf("@");
  if (at < 1) return "";
  const domain = value.slice(at + 1).toLowerCase();
  if (domain.length < 4 || EMAIL_DOMAINS.includes(domain)) return "";
  let best = "";
  let bestDistance = 3;
  for (const candidate of EMAIL_DOMAINS) {
    const d = levenshtein(domain, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best ? `${value.slice(0, at + 1)}${best}` : "";
}

/** Hook: sugerencia reactiva para un ref/getter con el email. */
export function useEmailSuggestion(email) {
  return computed(() => suggestEmail(typeof email === "function" ? email() : unref(email)));
}

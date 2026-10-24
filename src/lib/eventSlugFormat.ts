// Formato del slug de un evento (URL pública /eventos/<slug>). Sin dependencias de servidor: lo usan
// src/lib/eventSlug.ts (validación y cambio en la BD) y el formulario de edición del panel (vista previa).

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 120;

/** Normaliza texto libre a slug: minúsculas, sin tildes, solo [a-z0-9-]. */
export function normalizeSlug(input: string): string {
    return String(input || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, SLUG_MAX)
        .replace(/-+$/g, "");
}

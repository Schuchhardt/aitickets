// Tinte de la página del evento a partir del póster (rediseño de la página del evento, §4.3).
// Funciones puras: las usa src/lib/eventCoverMeta.ts (servidor, con los píxeles que entrega sharp) y la
// página para armar el degradado. Sin dependencias de Node ni del navegador.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Luminancia relativa WCAG de un color sRGB 0–255. */
export function relativeLuminance(r, g, b) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contraste WCAG entre dos luminancias relativas. */
export function contrastRatio(l1, l2) {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/** RGB 0–255 => HSL (h 0–360, s y l 0–1). */
export function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

/** HSL (h 0–360, s y l 0–1) => RGB 0–255. */
export function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Color dominante de una imagen ya reducida (p. ej. 32×32) en RGB intercalado (3 o 4 canales).
 * Cuantiza a 4 bits por canal, cuenta y toma el grupo más frecuente con saturación > 0.15 y luminosidad
 * entre 0.15 y 0.85 (devuelve el promedio de sus píxeles). Sin candidatos: color null.
 * @param {Uint8Array|Buffer|number[]} pixels
 * @param {number} channels 3 (RGB) o 4 (RGBA; los píxeles casi transparentes se ignoran)
 * @returns {{color: string|null, luminance: number}} luminance = luminancia relativa media de la imagen
 */
export function dominantColor(pixels, channels = 3) {
  const buckets = new Map();
  let lumSum = 0;
  let count = 0;
  for (let i = 0; i + 2 < pixels.length; i += channels) {
    if (channels === 4 && pixels[i + 3] < 32) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    lumSum += relativeLuminance(r, g, b);
    count++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.n++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }
  const luminance = count ? lumSum / count : 0;
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
  for (const bucket of ranked) {
    const r = bucket.r / bucket.n;
    const g = bucket.g / bucket.n;
    const b = bucket.b / bucket.n;
    const { s, l } = rgbToHsl(r, g, b);
    if (s > 0.15 && l >= 0.15 && l <= 0.85) return { color: rgbToHex(r, g, b), luminance: Math.round(luminance * 1000) / 1000 };
  }
  return { color: null, luminance: Math.round(luminance * 1000) / 1000 };
}

/**
 * Tinte pastel para el fondo de la página: el tono del color dominante con saturación ≤ 30 % y
 * luminosidad 95 %. Devuelve el valor para `--event-tint` ("h s% l%") o null sin color.
 * El texto de la página (#0A0A0B / #5B5B63) siempre cumple AA sobre una luminosidad de 95 %.
 */
export function pastelTint(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { h, s } = rgbToHsl(...rgb);
  const sat = Math.min(s, 0.3);
  return `${Math.round(h)} ${Math.round(sat * 100)}% 95%`;
}

/** Contraste del texto secundario (#5B5B63) sobre el tinte: para tests y verificación. */
export function tintContrast(tint, textHex = "#5B5B63") {
  const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/.exec(String(tint || ""));
  const text = hexToRgb(textHex);
  if (!m || !text) return null;
  const bg = hslToRgb(Number(m[1]), clamp01(Number(m[2]) / 100), clamp01(Number(m[3]) / 100));
  return contrastRatio(relativeLuminance(...bg), relativeLuminance(...text));
}

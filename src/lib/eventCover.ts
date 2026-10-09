// Ajuste de la portada del evento (events.cover_settings), por dispositivo.
// Lo usan la página pública (EventHeader.vue), el editor del panel (CoverAdjuster.vue) y /api/events/update.

export type CoverFit = "cover" | "contain";
export interface CoverDeviceSettings {
  /** Alto de la portada en px. */
  height: number;
  /** Encuadre vertical en % (0 = parte de arriba de la imagen, 100 = parte de abajo). Solo con fit 'cover'. */
  position_y: number;
  /** 'cover' recorta para llenar; 'contain' muestra la imagen completa sobre un fondo difuminado. */
  fit: CoverFit;
}
export interface CoverSettings {
  desktop: CoverDeviceSettings;
  mobile: CoverDeviceSettings;
}
export type CoverDevice = keyof CoverSettings;

export const COVER_LIMITS: Record<CoverDevice, { min: number; max: number }> = {
  desktop: { min: 240, max: 720 },
  mobile: { min: 180, max: 560 },
};

export const DEFAULT_COVER_SETTINGS: CoverSettings = Object.freeze({
  desktop: Object.freeze({ height: 480, position_y: 50, fit: "cover" as CoverFit }),
  mobile: Object.freeze({ height: 340, position_y: 50, fit: "cover" as CoverFit }),
}) as CoverSettings;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function normalizeDevice(raw: any, device: CoverDevice): CoverDeviceSettings {
  const def = DEFAULT_COVER_SETTINGS[device];
  const { min, max } = COVER_LIMITS[device];
  const height = Number(raw?.height);
  const positionY = Number(raw?.position_y);
  return {
    height: Number.isFinite(height) ? Math.round(clamp(height, min, max)) : def.height,
    position_y: Number.isFinite(positionY) ? Math.round(clamp(positionY, 0, 100)) : def.position_y,
    fit: raw?.fit === "contain" ? "contain" : "cover",
  };
}

/** Valores completos y dentro de rango a partir de lo guardado (NULL o parcial => por defecto). */
export function normalizeCoverSettings(raw: any): CoverSettings {
  return { desktop: normalizeDevice(raw?.desktop, "desktop"), mobile: normalizeDevice(raw?.mobile, "mobile") };
}

export const isDefaultCoverSettings = (s: CoverSettings) =>
  JSON.stringify(normalizeCoverSettings(s)) === JSON.stringify(DEFAULT_COVER_SETTINGS);

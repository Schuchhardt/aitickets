// Configuración de la página pública del evento (events.page_settings). La eligen el productor en el editor
// (EditEventForm.vue, paso 1) y la usan EventDetail.vue y /api/events/update. NULL = valores por defecto.

export type EventPageLayout = "poster" | "banner" | "compact";
export type EventPageBackground = "none" | "pearl" | "lime" | "mint" | "sky" | "lavender" | "peach";
export interface EventPageSettings {
  /**
   * poster  = póster completo a la izquierda, título y compra a la derecha (default)
   * banner  = imagen ancha arriba, el título se monta sobre su borde inferior
   * compact = imagen chica junto al título; la información va primero
   */
  layout: EventPageLayout;
  /** Muestra "Organiza <productora>" bajo el título. */
  show_organizer: boolean;
  /** Fondo animado (Iridescence, src/components/event/IridescenceBg.vue). "none" = tinte del póster. */
  background: EventPageBackground;
}

export const EVENT_PAGE_LAYOUTS: ReadonlyArray<{ value: EventPageLayout; label: string; hint: string }> = Object.freeze([
  { value: "poster", label: "Póster", hint: "Ideal para flyers verticales: la imagen completa junto al título." },
  { value: "banner", label: "Portada ancha", hint: "Para fotos horizontales: la imagen ocupa todo el ancho arriba." },
  { value: "compact", label: "Compacto", hint: "Imagen pequeña junto al título: la información va primero." },
]);

/**
 * Presets del fondo Iridescence: tinte (RGB 0..1) que luego se mezcla con blanco (`soft`) para que quede muy claro.
 * Velocidad fija y baja (IridescenceBg: speed 0.12) para que no distraiga.
 */
export const EVENT_PAGE_BACKGROUNDS: ReadonlyArray<{ value: EventPageBackground; label: string; color?: [number, number, number]; soft?: number }> = Object.freeze([
  { value: "none", label: "Sin fondo" },
  { value: "pearl", label: "Perla", color: [1, 1, 1], soft: 0.8 },
  { value: "lime", label: "Lima", color: [0.82, 1, 0.55], soft: 0.8 },
  { value: "mint", label: "Menta", color: [0.7, 1, 0.88], soft: 0.8 },
  { value: "sky", label: "Cielo", color: [0.72, 0.88, 1], soft: 0.8 },
  { value: "lavender", label: "Lavanda", color: [0.86, 0.78, 1], soft: 0.8 },
  { value: "peach", label: "Durazno", color: [1, 0.82, 0.7], soft: 0.8 },
]);

export const DEFAULT_EVENT_PAGE_SETTINGS: EventPageSettings = Object.freeze({ layout: "poster", show_organizer: true, background: "none" }) as EventPageSettings;

const LAYOUT_VALUES = new Set(EVENT_PAGE_LAYOUTS.map((l) => l.value));
const BACKGROUND_VALUES = new Set(EVENT_PAGE_BACKGROUNDS.map((b) => b.value));

/** Preset del fondo (o null si es "none" o desconocido). */
export const pageBackgroundPreset = (value: string | null | undefined) =>
  EVENT_PAGE_BACKGROUNDS.find((b) => b.value === value && b.color) || null;

/** Valores completos y válidos a partir de lo guardado (NULL o parcial => por defecto). */
export function normalizePageSettings(raw: any): EventPageSettings {
  return {
    layout: LAYOUT_VALUES.has(raw?.layout) ? raw.layout : DEFAULT_EVENT_PAGE_SETTINGS.layout,
    show_organizer: typeof raw?.show_organizer === "boolean" ? raw.show_organizer : DEFAULT_EVENT_PAGE_SETTINGS.show_organizer,
    background: BACKGROUND_VALUES.has(raw?.background) ? raw.background : DEFAULT_EVENT_PAGE_SETTINGS.background,
  };
}

export const isDefaultPageSettings = (s: EventPageSettings) =>
  JSON.stringify(normalizePageSettings(s)) === JSON.stringify(DEFAULT_EVENT_PAGE_SETTINGS);

const DEMO_SUFFIX = /\s*\(evento de demostración\)\s*$/i;
/** Nombre sin el sufijo "(evento de demostración)" (los demo ya muestran un banner). */
export const stripDemoSuffix = (name: string | null | undefined) => String(name || "").replace(DEMO_SUFFIX, "");

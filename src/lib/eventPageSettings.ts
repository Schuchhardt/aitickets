// Configuración de la página pública del evento (events.page_settings). La eligen el productor en el editor
// (EditEventForm.vue, paso 1) y la usan EventDetail.vue y /api/events/update. NULL = valores por defecto.

export type EventPageLayout = "poster" | "banner" | "compact";
export interface EventPageSettings {
  /**
   * poster  = póster completo a la izquierda, título y compra a la derecha (default)
   * banner  = imagen ancha arriba, el título se monta sobre su borde inferior
   * compact = imagen chica junto al título; la información va primero
   */
  layout: EventPageLayout;
  /** Muestra "Organiza <productora>" bajo el título. */
  show_organizer: boolean;
}

export const EVENT_PAGE_LAYOUTS: ReadonlyArray<{ value: EventPageLayout; label: string; hint: string }> = Object.freeze([
  { value: "poster", label: "Póster", hint: "Ideal para flyers verticales: la imagen completa junto al título." },
  { value: "banner", label: "Portada ancha", hint: "Para fotos horizontales: la imagen ocupa todo el ancho arriba." },
  { value: "compact", label: "Compacto", hint: "Imagen pequeña junto al título: la información va primero." },
]);

export const DEFAULT_EVENT_PAGE_SETTINGS: EventPageSettings = Object.freeze({ layout: "poster", show_organizer: true }) as EventPageSettings;

const LAYOUT_VALUES = new Set(EVENT_PAGE_LAYOUTS.map((l) => l.value));

/** Valores completos y válidos a partir de lo guardado (NULL o parcial => por defecto). */
export function normalizePageSettings(raw: any): EventPageSettings {
  return {
    layout: LAYOUT_VALUES.has(raw?.layout) ? raw.layout : DEFAULT_EVENT_PAGE_SETTINGS.layout,
    show_organizer: typeof raw?.show_organizer === "boolean" ? raw.show_organizer : DEFAULT_EVENT_PAGE_SETTINGS.show_organizer,
  };
}

export const isDefaultPageSettings = (s: EventPageSettings) =>
  JSON.stringify(normalizePageSettings(s)) === JSON.stringify(DEFAULT_EVENT_PAGE_SETTINGS);

const DEMO_SUFFIX = /\s*\(evento de demostración\)\s*$/i;
/** Nombre sin el sufijo "(evento de demostración)" (los demo ya muestran un banner). */
export const stripDemoSuffix = (name: string | null | undefined) => String(name || "").replace(DEMO_SUFFIX, "");

// Calendario del modelo de fechas: feriados nacionales de Chile calculados por ley, fines de semana largos, fechas
// especiales (Fiestas Patrias, Navidad, Año Nuevo) y las entradas que carga el dueño en aitickets_market_calendar
// (interferiados, feriados regionales, vacaciones escolares, elecciones, mega eventos…). Fechas como "YYYY-MM-DD".
import { type Category, CATEGORY_INFO, type TypeGroup } from "./taxonomy";

const DAY_MS = 86_400_000;

export const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
export const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"] as const;

const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fmt(toTime(d) + n * DAY_MS);
/** a − b en días. */
export const diffDays = (a: string, b: string) => Math.round((toTime(a) - toTime(b)) / DAY_MS);
/** 0 = domingo … 6 = sábado. */
export const dayOfWeek = (d: string) => new Date(toTime(d)).getUTCDay();
export const isValidDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && fmt(toTime(d)) === d;

const chileDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" });
/** Hoy en Chile (YYYY-MM-DD). */
export const todayChile = (now = new Date()) => chileDayFmt.format(now);

/** Días entre from y to, ambos incluidos. */
export function dateRange(from: string, to: string): string[] {
    const out: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
}

// ---------------------------------------------------------------------------
// Feriados nacionales (Chile)
// ---------------------------------------------------------------------------

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): string {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Ley 19.668: martes, miércoles o jueves → lunes de esa semana; viernes → lunes siguiente; sábado, domingo y lunes no se mueven. */
function movedToMonday(d: string): string {
    const w = dayOfWeek(d);
    if (w >= 2 && w <= 4) return addDays(d, -(w - 1));
    if (w === 5) return addDays(d, 3);
    return d;
}

/** Día de los Pueblos Indígenas (Ley 21.357): el día del solsticio de invierno en Chile. */
const INDIGENOUS_DAY: Record<number, string> = { 2022: "06-21", 2023: "06-21", 2024: "06-20", 2025: "06-20", 2026: "06-21", 2027: "06-21", 2028: "06-20", 2029: "06-20", 2030: "06-21" };
function indigenousDay(year: number): { date: string; approx: boolean } {
    if (INDIGENOUS_DAY[year]) return { date: `${year}-${INDIGENOUS_DAY[year]}`, approx: false };
    // Solsticio aproximado (2000-06-21 01:48 UTC + años trópicos) llevado a hora de Chile (UTC−4 en junio)
    const t = Date.UTC(2000, 5, 21, 1, 48) + (year - 2000) * 365.2422 * DAY_MS - 4 * 3600_000;
    return { date: fmt(Math.floor(t / DAY_MS) * DAY_MS), approx: true };
}

export type Holiday = { date: string; name: string; approx?: boolean };
const holidayCache = new Map<number, Holiday[]>();

/** Feriados nacionales del año. No incluye interferiados ni feriados regionales: se cargan en el calendario de mercado. */
export function chileHolidays(year: number): Holiday[] {
    const cached = holidayCache.get(year);
    if (cached) return cached;
    const y = (md: string) => `${year}-${md}`;
    const easter = easterSunday(year);
    const indigenous = indigenousDay(year);
    const out: Holiday[] = [
        { date: y("01-01"), name: "Año Nuevo" },
        { date: addDays(easter, -2), name: "Viernes Santo" },
        { date: addDays(easter, -1), name: "Sábado Santo" },
        { date: y("05-01"), name: "Día Nacional del Trabajo" },
        { date: y("05-21"), name: "Día de las Glorias Navales" },
        { date: indigenous.date, name: "Día Nacional de los Pueblos Indígenas", ...(indigenous.approx ? { approx: true } : {}) },
        { date: movedToMonday(y("06-29")), name: "San Pedro y San Pablo" },
        { date: y("07-16"), name: "Día de la Virgen del Carmen" },
        { date: y("08-15"), name: "Asunción de la Virgen" },
        { date: y("09-18"), name: "Independencia Nacional" },
        { date: y("09-19"), name: "Día de las Glorias del Ejército" },
        { date: movedToMonday(y("10-12")), name: "Encuentro de Dos Mundos" },
        { date: y("11-01"), name: "Día de Todos los Santos" },
        { date: y("12-08"), name: "Inmaculada Concepción" },
        { date: y("12-25"), name: "Navidad" },
    ];
    // 2 de enero cuando es lunes
    if (dayOfWeek(y("01-02")) === 1) out.push({ date: y("01-02"), name: "Feriado de Año Nuevo (lunes 2 de enero)" });
    // 17 de septiembre si es lunes; 20 de septiembre si es viernes
    if (dayOfWeek(y("09-17")) === 1) out.push({ date: y("09-17"), name: "Fiestas Patrias (lunes 17)" });
    if (dayOfWeek(y("09-20")) === 5) out.push({ date: y("09-20"), name: "Fiestas Patrias (viernes 20)" });
    // Iglesias Evangélicas (Ley 20.299): martes → viernes anterior; miércoles → viernes siguiente
    const oct31 = y("10-31");
    const w = dayOfWeek(oct31);
    out.push({ date: w === 2 ? addDays(oct31, -4) : w === 3 ? addDays(oct31, 2) : oct31, name: "Día de las Iglesias Evangélicas y Protestantes" });
    out.sort((a, b) => a.date.localeCompare(b.date));
    holidayCache.set(year, out);
    return out;
}

// ---------------------------------------------------------------------------
// Calendario de mercado (entradas del dueño)
// ---------------------------------------------------------------------------

export const CALENDAR_KINDS = [
    "holiday",
    "bridge_holiday",
    "no_holiday",
    "school_vacation",
    "election",
    "mega_event",
    "high_demand",
    "low_demand",
    "blackout",
    "other",
] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
    holiday: "Feriado (regional o especial)",
    bridge_holiday: "Interferiado",
    no_holiday: "Anula un feriado calculado",
    school_vacation: "Vacaciones escolares",
    election: "Elecciones (ley seca)",
    mega_event: "Mega evento",
    high_demand: "Temporada o fecha de alta demanda",
    low_demand: "Temporada o fecha de baja demanda",
    blackout: "Fecha a evitar",
    other: "Otro",
};

export type CalendarEntry = {
    id?: number;
    kind: CalendarKind;
    label: string;
    date_from: string;
    date_to: string;
    region?: string | null;
    city_key?: string | null;
    categories?: string[] | null;
    impact?: number | null;
    notes?: string | null;
};

export type Scope = { cityKey: string | null; region: string | null };

/** Multiplicador por defecto de una entrada según su tipo (kind) y el tipo de evento. null = no cambia la nota. */
function defaultImpact(kind: CalendarKind, type: Category): number | null {
    switch (kind) {
        case "school_vacation":
            return type === "infantil" ? 1.15 : type === "feria" ? 1.05 : null;
        case "election":
            return type === "fiesta" || type === "club" ? 0.5 : type === "concierto" ? 0.8 : 0.9;
        case "mega_event":
            return 0.75;
        case "high_demand":
            return 1.15;
        case "low_demand":
            return 0.8;
        case "blackout":
            return 0.3;
        default:
            return null;
    }
}

export type CalendarFactor = { label: string; multiplier: number; source: "computed" | "calendar"; entry_id?: number };
export type LongWeekend = { start: string; end: string; days: number; holidays: string[] };

export function makeCalendar(entries: CalendarEntry[] = []) {
    const inScope = (e: CalendarEntry, scope: Scope) => (!e.region || e.region === scope.region) && (!e.city_key || e.city_key === scope.cityKey);
    const on = (date: string, scope: Scope) => entries.filter((e) => e.date_from <= date && e.date_to >= date && inScope(e, scope));

    function holidayName(date: string, scope: Scope): string | null {
        const here = on(date, scope);
        const custom = here.find((e) => e.kind === "holiday" || e.kind === "bridge_holiday");
        if (custom) return custom.label;
        if (here.some((e) => e.kind === "no_holiday")) return null;
        return chileHolidays(Number(date.slice(0, 4))).find((h) => h.date === date)?.name || null;
    }

    const isWorking = (date: string, scope: Scope) => {
        const w = dayOfWeek(date);
        return w !== 0 && w !== 6 && !holidayName(date, scope);
    };

    /** Fin de semana largo: 3 o más días seguidos sin trabajo con al menos un feriado. */
    function longWeekend(date: string, scope: Scope): LongWeekend | null {
        if (isWorking(date, scope)) return null;
        let start = date;
        let end = date;
        for (let i = 0; i < 10 && !isWorking(addDays(start, -1), scope); i++) start = addDays(start, -1);
        for (let i = 0; i < 10 && !isWorking(addDays(end, 1), scope); i++) end = addDays(end, 1);
        const days = diffDays(end, start) + 1;
        if (days < 3) return null;
        const holidays = dateRange(start, end)
            .map((d) => holidayName(d, scope))
            .filter((n): n is string => Boolean(n));
        return holidays.length ? { start, end, days, holidays: [...new Set(holidays)] } : null;
    }

    /**
     * Día de la semana "efectivo" para la demanda: la víspera de un feriado se comporta como viernes para eventos de
     * noche, un feriado seguido de otro día libre como sábado, y el último día libre como domingo.
     */
    function effectiveDow(date: string, group: TypeGroup, scope: Scope): number {
        const w = dayOfWeek(date);
        const today = isWorking(date, scope);
        const tomorrow = isWorking(addDays(date, 1), scope);
        if (group === "formacion") return today ? w : w === 6 || w === 0 ? w : 0;
        if (!today) return tomorrow ? 0 : 6;
        if (group === "noche" && !tomorrow) return 5;
        return w;
    }

    /** Fechas especiales calculadas y entradas del calendario que cambian la nota de esa fecha para ese tipo. */
    function factors(date: string, type: Category, scope: Scope & { destination: boolean }): CalendarFactor[] {
        const out: CalendarFactor[] = [];
        const md = date.slice(5);
        const group = CATEGORY_INFO[type].group;
        const nightlife = type === "fiesta" || type === "club";
        const lw = longWeekend(date, scope);
        const fiestasPatrias = (md >= "09-17" && md <= "09-20") || Boolean(lw && lw.start.slice(5) <= "09-19" && lw.end.slice(5) >= "09-18" && lw.start.slice(0, 4) === date.slice(0, 4));
        if (fiestasPatrias) {
            out.push({ label: "Fiestas Patrias: compiten las fondas y mucha gente sale de la ciudad", multiplier: nightlife ? 0.85 : type === "concierto" ? 0.7 : 0.6, source: "computed" });
        } else if (lw) {
            if (scope.destination && group !== "formacion") {
                out.push({ label: `Fin de semana largo (${lw.start} a ${lw.end}): llega gente de otras ciudades`, multiplier: 1.1, source: "computed" });
            } else if (!scope.destination && scope.cityKey !== "online") {
                out.push({ label: `Fin de semana largo (${lw.start} a ${lw.end}): mucha gente sale de la ciudad`, multiplier: 0.88, source: "computed" });
            }
        }
        if (md === "12-24") out.push({ label: "Nochebuena", multiplier: 0.3, source: "computed" });
        if (md === "12-25") out.push({ label: "Navidad", multiplier: type === "cine" ? 0.7 : 0.4, source: "computed" });
        if (md >= "12-26" && md <= "12-30") out.push({ label: "Semana entre Navidad y Año Nuevo", multiplier: group === "formacion" ? 0.5 : 0.9, source: "computed" });
        if (md === "12-31") {
            out.push(
                nightlife
                    ? { label: "Año Nuevo: la noche más fuerte para fiestas (y la más competida)", multiplier: 1.15, source: "computed" }
                    : { label: "31 de diciembre: la gente tiene otros planes", multiplier: 0.35, source: "computed" },
            );
        }
        if (md === "01-01") out.push({ label: "1 de enero", multiplier: nightlife ? 0.7 : 0.5, source: "computed" });

        for (const e of on(date, scope)) {
            if (e.categories?.length && !e.categories.includes(type)) continue;
            const m = e.impact != null ? Number(e.impact) : defaultImpact(e.kind, type);
            if (m == null || m === 1) continue;
            out.push({ label: `${CALENDAR_KIND_LABELS[e.kind]}: ${e.label}`, multiplier: m, source: "calendar", ...(e.id ? { entry_id: e.id } : {}) });
        }
        return out;
    }

    return { entries, holidayName, isWorking, longWeekend, effectiveDow, factors };
}

export type MarketCalendar = ReturnType<typeof makeCalendar>;

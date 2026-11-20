// Modelo de fechas v1: ¿es buena esta fecha para un evento de este tipo en esta ciudad? y ¿qué fechas recomiendo?
//
// Es un modelo heurístico EXPLICABLE, no un modelo de ML: con pocos datos un modelo entrenado sería ruido. Parte de
// supuestos razonables (priors) y los corrige con los eventos registrados (externos + AI Tickets) a medida que hay más,
// con "shrinkage" bayesiano: con 0 datos manda el prior, con cientos mandan los datos. Cada factor devuelve su
// multiplicador y una explicación, así la nota se puede auditar y discutir.
//
//   nota = 100 × día_semana^0.6 × temporada × calendario × competencia × quincena × resultados × anticipación
//
//   día_semana   preferencia del tipo por ese día (prior + distribución observada); la víspera de feriado cuenta como viernes
//   temporada    mes del año (prior por tipo; los destinos de verano suben en enero y febrero)
//   calendario   fin de semana largo, Fiestas Patrias, Navidad, Año Nuevo y el calendario de mercado del dueño
//   competencia  eventos parecidos ese día y alrededor en la misma ciudad, vs lo normal para ese día de la semana
//   quincena     cerca del pago de sueldos sube, la segunda quincena baja (leve)
//   resultados   % de eventos agotados de ese tipo por día de la semana (solo con ≥ 8 resultados)
//   anticipación cuánto falta: muy poco tiempo para vender baja la nota
//
// Spec: docs/specs/eventos-externos.md.
import { addDays, dayOfWeek, diffDays, makeCalendar, MONTH_NAMES, WEEKDAY_NAMES, type CalendarEntry, type CalendarFactor } from "./calendar";
import { affinity, cityInfo, isDestination, normalizeText, TYPE_INFO, type EventType, type TypeGroup } from "./taxonomy";

export const MODEL_VERSION = "v1-heuristico";

export type MarketEvent = {
    key: string;
    source: "external" | "aitickets";
    id: number;
    name: string;
    event_type: EventType;
    genre: string | null;
    date: string;
    /** Noche a la que pertenece: una función que empieza antes de las 06:00 es de la noche anterior. */
    night_date: string;
    start_time: string | null;
    city_key: string | null;
    city: string | null;
    region: string | null;
    venue_name: string | null;
    capacity: number | null;
    organizer_key: string | null;
    organizer_name: string | null;
    ticketing_platform: string | null;
    price_min: number | null;
    price_max: number | null;
    is_free: boolean | null;
    status: string;
    sold_out: boolean | null;
    sold_pct: number | null;
    announced_at: string | null;
    series_key: string | null;
    organization_id: number | null;
    lead_id: string | null;
};

/** Noche del evento: antes de las 06:00 cuenta como la noche anterior. */
export const nightDate = (date: string, startTime: string | null | undefined) => (startTime && startTime < "06:00" ? addDays(date, -1) : date);

const MONTH_BASE = [0.78, 0.72, 0.92, 1, 1, 0.95, 0.92, 0.97, 0.9, 1, 1, 0.95];
const MONTH_BY_TYPE: Partial<Record<EventType, number[]>> = {
    festival: [1, 1, 0.95, 0.8, 0.65, 0.55, 0.55, 0.6, 0.75, 0.9, 1, 0.95],
    feria: [0.9, 0.9, 0.9, 0.95, 0.9, 0.8, 0.85, 0.85, 0.95, 1, 1, 1],
    deportes: [0.85, 0.8, 0.95, 1, 0.95, 0.85, 0.85, 0.9, 0.95, 1, 1, 0.9],
    infantil: [0.9, 0.85, 0.8, 0.9, 0.9, 0.9, 1, 0.9, 0.9, 0.95, 0.95, 0.9],
    conferencia: [0.5, 0.4, 0.9, 1, 1, 1, 0.85, 1, 0.9, 1, 1, 0.65],
    taller: [0.6, 0.5, 0.95, 1, 1, 0.95, 0.85, 1, 0.9, 1, 1, 0.7],
    fiesta: [0.85, 0.8, 0.95, 0.95, 0.95, 0.9, 0.9, 0.95, 1, 1, 1, 1],
    club: [0.85, 0.8, 0.95, 0.95, 0.95, 0.9, 0.9, 0.95, 1, 1, 1, 1],
};

/** Fracción de eventos que ya está anunciada N días antes (prior); se corrige con announced_at. */
const ANNOUNCE_PRIOR: [number, number][] = [
    [7, 0.95],
    [14, 0.9],
    [30, 0.8],
    [60, 0.6],
    [90, 0.45],
    [180, 0.3],
    [Infinity, 0.2],
];
const announcePrior = (lead: number) => ANNOUNCE_PRIOR.find(([max]) => lead <= max)![1];

const DECAY = [1, 0.3, 0.12, 0.05];
const WEEKDAY_PRIOR_STRENGTH = 25;
const ANNOUNCE_PRIOR_STRENGTH = 20;
const MEGA_CAPACITY = 8000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;
const sizeWeight = (cap: number | null) => (cap && cap > 0 ? clamp(Math.sqrt(cap / 400), 0.5, 4) : 1);
const median = (xs: number[]) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function verdictFor(score: number): "buena" | "aceptable" | "riesgosa" | "mala" {
    return score >= 75 ? "buena" : score >= 60 ? "aceptable" : score >= 40 ? "riesgosa" : "mala";
}

export type DateQuery = {
    event_type: EventType;
    city?: string | null;
    region?: string | null;
    start_time?: string | null;
    genre?: string | null;
    capacity?: number | null;
    price?: number | null;
    /** Claves de MarketEvent a ignorar (p. ej. el mismo evento que se está evaluando). */
    exclude_keys?: string[];
};

export type Factor = { factor: string; multiplier: number; detail: string };

export function buildDateModel(opts: { events: MarketEvent[]; calendarEntries?: CalendarEntry[]; today: string }) {
    const { today } = opts;
    const calendar = makeCalendar(opts.calendarEntries || []);
    const active = opts.events.filter((e) => e.status !== "cancelled" && e.status !== "postponed");

    const byNight = new Map<string, MarketEvent[]>();
    for (const e of active) {
        const list = byNight.get(e.night_date);
        if (list) list.push(e);
        else byNight.set(e.night_date, [e]);
    }

    // Día de la semana efectivo de cada evento registrado (con su propio alcance)
    const effCache = new Map<string, number>();
    const effDowOf = (date: string, group: TypeGroup, cityKey: string | null, region: string | null) => {
        const k = `${date}|${group}|${cityKey}|${region}`;
        let v = effCache.get(k);
        if (v === undefined) {
            v = calendar.effectiveDow(date, group, { cityKey, region });
            effCache.set(k, v);
        }
        return v;
    };
    const groupOf = (type: EventType, startTime: string | null | undefined): TypeGroup => {
        const base = TYPE_INFO[type].group;
        if (base === "formacion" || !startTime) return base;
        return startTime >= "06:00" && startTime < "17:00" ? "dia" : "noche";
    };
    const eventEffDow = (e: MarketEvent) => effDowOf(e.night_date, groupOf(e.event_type, e.start_time), e.city_key, e.region);

    function scopeFor(q: DateQuery) {
        const info = cityInfo(q.city, q.region);
        return { cityKey: info.key, region: info.region, label: info.label, destination: info.destination };
    }
    type Scope = ReturnType<typeof scopeFor>;

    const inCity = (e: MarketEvent, scope: Scope) => !scope.cityKey || e.city_key === scope.cityKey;
    /** Eventos de ese tipo en la ciudad (o en todo Chile si la ciudad tiene pocos). */
    function sampleFor(type: EventType, scope: Scope, min = 15) {
        const all = active.filter((e) => e.event_type === type && (scope.cityKey === "online" ? e.city_key === "online" : e.city_key !== "online"));
        const local = scope.cityKey ? all.filter((e) => inCity(e, scope)) : all;
        return local.length >= min || !scope.cityKey ? { events: local, national: !scope.cityKey } : { events: all, national: true };
    }

    // --- Día de la semana -------------------------------------------------
    const fitCache = new Map<string, ReturnType<typeof weekdayFits>>();
    function weekdayFit(type: EventType, scope: Scope) {
        const k = `${type}|${scope.cityKey}`;
        let v = fitCache.get(k);
        if (!v) {
            v = weekdayFits(type, scope);
            fitCache.set(k, v);
        }
        return v;
    }
    /** Preferencia (0 a 1) de cada día de la semana: supuesto inicial + días observados, con shrinkage. */
    function weekdayFits(type: EventType, scope: Scope) {
        const prior = TYPE_INFO[type].weekday;
        const priorSum = prior.reduce((a, b) => a + b, 0);
        const { events, national } = sampleFor(type, scope);
        const counts = [0, 0, 0, 0, 0, 0, 0];
        const seen = new Set<string>();
        for (const e of events) {
            const k = `${e.series_key || e.key}|${e.night_date}`;
            if (seen.has(k)) continue;
            seen.add(k);
            counts[eventEffDow(e)] += 1;
        }
        const n = counts.reduce((a, b) => a + b, 0);
        const k = WEEKDAY_PRIOR_STRENGTH;
        const shares = counts.map((c, i) => (c + (k * prior[i]) / priorSum) / (n + k));
        const max = Math.max(...shares);
        return { fits: shares.map((x) => x / max), n, national, counts };
    }

    // --- Resultados (agotados) por día de la semana ------------------------
    function outcomeAdjust(type: EventType, scope: Scope, dow: number) {
        const { events } = sampleFor(type, scope, 8);
        const known = events.filter((e) => e.night_date < today && (e.sold_out != null || e.sold_pct != null));
        const none = { multiplier: 1, n: known.length, rate: null as number | null, rate_dow: null as number | null };
        if (known.length < 8) return none;
        const ok = (e: MarketEvent) => e.sold_out === true || (e.sold_pct != null && e.sold_pct >= 90);
        const rateAll = known.filter(ok).length / known.length;
        if (rateAll <= 0) return { ...none, rate: 0 };
        const sameDow = known.filter((e) => eventEffDow(e) === dow);
        const rateDow = (sameDow.filter(ok).length + 6 * rateAll) / (sameDow.length + 6);
        return { multiplier: clamp(Math.sqrt(rateDow / rateAll), 0.85, 1.15), n: known.length, rate: rateAll, rate_dow: rateDow };
    }

    // --- Anuncio de eventos (para corregir fechas lejanas) -----------------
    const announceCache = new Map<string, number>();
    function announcedFraction(type: EventType, lead: number) {
        const bucket = ANNOUNCE_PRIOR.findIndex(([max]) => lead <= max);
        const ck = `${type}|${bucket}`;
        const cached = announceCache.get(ck);
        if (cached !== undefined) return cached;
        const prior = announcePrior(lead);
        const sample = active.filter((e) => e.announced_at && e.night_date < today && affinity(type, e.event_type) >= 0.5);
        const ge = sample.filter((e) => diffDays(e.night_date, String(e.announced_at).slice(0, 10)) >= lead).length;
        const f = (ge + ANNOUNCE_PRIOR_STRENGTH * prior) / (sample.length + ANNOUNCE_PRIOR_STRENGTH);
        announceCache.set(ck, f);
        return f;
    }

    // --- Competencia -------------------------------------------------------
    function cityFactor(e: MarketEvent, scope: Scope) {
        if (!scope.cityKey) return e.city_key === "online" ? 0.3 : 1;
        if (e.city_key === scope.cityKey) return 1;
        if (scope.cityKey === "online" || e.city_key === "online") return 0.1;
        if (!e.city_key) return 0.3;
        if (scope.region && e.region === scope.region) return 0.15;
        return 0;
    }

    type Hit = { event: MarketEvent; weight: number; days_apart: number };
    function pressureOn(date: string, q: DateQuery, scope: Scope, exclude: Set<string>) {
        const hits: Hit[] = [];
        const genre = q.genre ? normalizeText(q.genre) : null;
        for (let dd = -3; dd <= 3; dd++) {
            for (const e of byNight.get(addDays(date, dd)) || []) {
                if (exclude.has(e.key)) continue;
                const cf = cityFactor(e, scope);
                if (!cf) continue;
                let a = affinity(q.event_type, e.event_type);
                if (a > 0 && a < 1 && genre && e.genre && normalizeText(e.genre) === genre) a = Math.min(1, a * 1.3);
                if (dd === 0 && cf >= 1 && (e.capacity || 0) >= MEGA_CAPACITY) a = Math.max(a, 0.4);
                if (!a) continue;
                const weight = a * cf * DECAY[Math.abs(dd)] * sizeWeight(e.capacity);
                if (weight > 0) hits.push({ event: e, weight, days_apart: dd });
            }
        }
        const total = hits.reduce((s, h) => s + h.weight, 0);
        const lead = diffDays(date, today);
        const announced = lead > 0 ? announcedFraction(q.event_type, lead) : 1;
        return { hits, total, adjusted: total / Math.max(announced, 0.25), announced };
    }

    /** Rango de fechas con datos en ese alcance (fuera de él, "0 eventos" significa "no registramos", no "no hubo"). */
    function coverage(scope: Scope) {
        const dates = active.filter((e) => cityFactor(e, scope) >= 1).map((e) => e.night_date);
        if (!dates.length) return null;
        let min = dates[0];
        let max = dates[0];
        for (const d of dates) {
            if (d < min) min = d;
            if (d > max) max = d;
        }
        return { from: min, to: max };
    }

    function competition(date: string, q: DateQuery, scope: Scope, exclude: Set<string>, memo: Map<string, ReturnType<typeof pressureOn>>) {
        const at = (d: string) => {
            let p = memo.get(d);
            if (!p) {
                p = pressureOn(d, q, scope, exclude);
                memo.set(d, p);
            }
            return p;
        };
        const here = at(date);
        const cov = coverage(scope);
        const baselineValues: number[] = [];
        if (cov) {
            for (let k = -8; k <= 8; k++) {
                if (!k) continue;
                const d = addDays(date, 7 * k);
                if (d >= cov.from && d <= cov.to) baselineValues.push(at(d).adjusted);
            }
        }
        const baseline = median(baselineValues) ?? 0;
        const ratio = here.adjusted / Math.max(baseline, 1);
        const multiplier = ratio <= 0.6 ? 1 : Math.max(0.3, 1 / (1 + 0.45 * (ratio - 0.6)));
        return { here, baseline, baseline_samples: baselineValues.length, ratio, multiplier };
    }

    // --- Nota de una fecha --------------------------------------------------
    function scoreDate(date: string, q: DateQuery, scope: Scope, exclude: Set<string>, memo: Map<string, ReturnType<typeof pressureOn>>) {
        const type = q.event_type;
        const group = groupOf(type, q.start_time);
        const leisure = group !== "formacion";
        const dow = dayOfWeek(date);
        const eff = calendar.effectiveDow(date, group, scope);
        const factors: Factor[] = [];

        const wf = weekdayFit(type, scope);
        // Un feriado o su víspera se comporta como el día equivalente, con un 10% de descuento (no es un viernes o
        // sábado "de verdad"). Para ocio nunca es peor que el día real; para formación sí (un feriado es malo).
        let fit = wf.fits[dow];
        if (eff !== dow) fit = group === "formacion" ? wf.fits[eff] : Math.max(wf.fits[dow], 0.9 * wf.fits[eff]);
        const weekdayMult = Math.pow(Math.max(fit, 0.01), 0.6);
        const effNote = eff !== dow ? ` (se comporta como ${WEEKDAY_NAMES[eff]}: ${eff === 5 ? "víspera de día libre" : eff === 6 ? "día libre seguido de otro libre" : "día libre antes de volver al trabajo"})` : "";
        factors.push({
            factor: "dia_semana",
            multiplier: r3(weekdayMult),
            detail:
                `${WEEKDAY_NAMES[dow]}${effNote}: preferencia ${Math.round(fit * 100)}% del mejor día para ${TYPE_INFO[type].label.toLowerCase()} ` +
                (wf.n ? `(${wf.n} eventos registrados${wf.national ? " en todo Chile" : ""} + supuesto inicial)` : "(supuesto inicial, aún sin datos)"),
        });

        const month = Number(date.slice(5, 7)) - 1;
        let season = (MONTH_BY_TYPE[type] || MONTH_BASE)[month];
        const summerDestination = scope.destination && leisure && (month === 0 || month === 1);
        if (summerDestination) season = Math.min(1.1, season * 1.25);
        factors.push({ factor: "temporada", multiplier: r3(season), detail: `${MONTH_NAMES[month]}${summerDestination ? " en destino de verano" : ""} (supuesto inicial por tipo de evento)` });

        const calFactors: CalendarFactor[] = calendar.factors(date, type, scope);
        const calMult = clamp(
            calFactors.reduce((m, f) => m * f.multiplier, 1),
            0.15,
            1.3,
        );
        if (calFactors.length) factors.push({ factor: "calendario", multiplier: r3(calMult), detail: calFactors.map((f) => `${f.label} (×${f.multiplier})`).join("; ") });

        const comp = competition(date, q, scope, exclude, memo);
        const sameDay = comp.here.hits.filter((h) => h.days_apart === 0);
        factors.push({
            factor: "competencia",
            multiplier: r3(comp.multiplier),
            detail:
                `${sameDay.length} evento(s) que compiten ese día y ${comp.here.hits.length - sameDay.length} en los días cercanos` +
                `; presión ${r1(comp.here.adjusted)} vs ${r1(comp.baseline)} normal para un ${WEEKDAY_NAMES[dow]}` +
                (comp.here.announced < 0.95 ? ` (corregida: a esta distancia solo ~${Math.round(comp.here.announced * 100)}% de los eventos ya está anunciado)` : ""),
        });

        let payday = 1;
        const dom = Number(date.slice(8, 10));
        if (leisure && (dom <= 7 || dom >= 28)) payday = 1.04;
        else if (leisure && dom >= 15 && dom <= 24) payday = 0.97;
        if (payday !== 1) factors.push({ factor: "quincena", multiplier: payday, detail: payday > 1 ? "Cerca del pago de sueldos" : "Segunda quincena: bolsillos más apretados" });

        const oa = outcomeAdjust(type, scope, eff);
        if (oa.multiplier !== 1) {
            factors.push({
                factor: "resultados",
                multiplier: r3(oa.multiplier),
                detail: `Agotados: ${Math.round((oa.rate_dow || 0) * 100)}% ese día de la semana vs ${Math.round((oa.rate || 0) * 100)}% en general (${oa.n} eventos con resultado conocido)`,
            });
        }

        const lead = diffDays(date, today);
        let leadMult = 1;
        if (lead >= 0) {
            const big = type === "festival" || type === "concierto";
            const steps: [number, number][] = big ? [[21, 0.8], [45, 0.9], [60, 0.97]] : group === "formacion" ? [[14, 0.85], [28, 0.95]] : [[10, 0.8], [21, 0.9], [35, 0.97]];
            leadMult = steps.find(([max]) => lead < max)?.[1] ?? 1;
            if (leadMult !== 1) factors.push({ factor: "anticipacion", multiplier: leadMult, detail: `Faltan ${lead} días: poco tiempo para promocionar y vender` });
        }

        const raw = 100 * weekdayMult * season * calMult * comp.multiplier * payday * oa.multiplier * leadMult;
        const score = Math.round(clamp(raw, 0, 100));
        return { date, dow, eff, score, verdict: verdictFor(score), factors, comp, lead, calendar: calFactors, weekday: wf };
    }

    function confidenceFor(date: string, q: DateQuery, scope: Scope, lead: number) {
        const nType = active.filter((e) => e.event_type === q.event_type && inCity(e, scope)).length;
        const around = active.filter((e) => cityFactor(e, scope) >= 1 && Math.abs(diffDays(e.night_date, date)) <= 7).length;
        const reasons: string[] = [];
        if (nType < 12) reasons.push(`Solo ${nType} eventos de este tipo registrados${scope.cityKey ? ` en ${scope.label}` : ""}: la preferencia por día sale casi toda del supuesto inicial.`);
        if (around < 5) reasons.push(`Hay ${around} eventos registrados en esa semana${scope.cityKey ? ` en ${scope.label}` : ""}: la competencia puede estar subestimada. Registra más eventos de esas fechas.`);
        if (lead > 60) reasons.push(`Faltan ${lead} días: muchos eventos de esa fecha aún no se anuncian (la competencia se corrige, pero con menos certeza).`);
        const level = nType >= 40 && around >= 15 && lead <= 60 ? "alta" : nType >= 12 && around >= 5 ? "media" : "baja";
        return { level, events_of_type: nType, events_that_week: around, reasons };
    }

    const presentHit = (h: Hit) => ({
        name: h.event.name,
        event_type: h.event.event_type,
        date: h.event.date,
        days_apart: h.days_apart,
        city: h.event.city,
        venue: h.event.venue_name,
        capacity: h.event.capacity,
        ticketing_platform: h.event.ticketing_platform,
        source: h.event.source,
        ...(h.event.source === "external" ? { external_event_id: h.event.id } : { aitickets_event_id: h.event.id }),
        weight: r3(h.weight),
    });

    function priceCheck(q: DateQuery, scope: Scope) {
        if (q.price == null) return null;
        const { events, national } = sampleFor(q.event_type, scope, 8);
        const priced = events.filter((e) => !e.is_free && e.price_min != null && e.price_min > 0);
        if (!priced.length) return { n: 0, note: "Sin precios registrados para este tipo de evento." };
        const mins = priced.map((e) => Number(e.price_min));
        const maxs = priced.filter((e) => e.price_max != null).map((e) => Number(e.price_max));
        const below = mins.filter((p) => p <= Number(q.price)).length;
        return {
            n: priced.length,
            national,
            median_price_min: median(mins),
            median_price_max: median(maxs),
            your_price: q.price,
            percentile: Math.round((below / mins.length) * 100),
        };
    }

    /** Evalúa una fecha: nota, veredicto, factores, competencia, calendario y alternativas cercanas. */
    function evaluate(date: string, q: DateQuery, opts: { alternativesDays?: number } = {}) {
        const scope = scopeFor(q);
        const exclude = new Set(q.exclude_keys || []);
        const memo = new Map<string, ReturnType<typeof pressureOn>>();
        const s = scoreDate(date, q, scope, exclude, memo);
        const conf = confidenceFor(date, q, scope, s.lead);
        const windowDays = opts.alternativesDays ?? 14;
        const alternatives: { date: string; weekday: string; score: number; verdict: string; why: string[] }[] = [];
        if (windowDays > 0) {
            const candidates: (ReturnType<typeof scoreDate> & { distance: number })[] = [];
            for (let dd = -windowDays; dd <= windowDays; dd++) {
                if (!dd) continue;
                const d = addDays(date, dd);
                if (s.lead >= 0 && d <= today) continue;
                const alt = scoreDate(d, q, scope, exclude, memo);
                if (alt.score > s.score) candidates.push({ ...alt, distance: Math.abs(dd) });
            }
            candidates.sort((a, b) => b.score - a.score || a.distance - b.distance);
            for (const c of candidates.slice(0, 3)) {
                alternatives.push({ date: c.date, weekday: WEEKDAY_NAMES[c.dow], score: c.score, verdict: c.verdict, why: topReasons(c.factors, s.factors) });
            }
        }
        const lw = calendar.longWeekend(date, scope);
        return {
            date,
            weekday: WEEKDAY_NAMES[s.dow],
            event_type: q.event_type,
            city: scope.label,
            city_key: scope.cityKey,
            score: s.score,
            verdict: s.verdict,
            confidence: conf,
            factors: s.factors,
            competition: {
                same_day: s.comp.here.hits.filter((h) => h.days_apart === 0).length,
                nearby_days: s.comp.here.hits.filter((h) => h.days_apart !== 0).length,
                pressure: r1(s.comp.here.adjusted),
                normal_for_weekday: r1(s.comp.baseline),
                baseline_samples: s.comp.baseline_samples,
                ratio: r3(s.comp.ratio),
                events: [...s.comp.here.hits].sort((a, b) => b.weight - a.weight).slice(0, 12).map(presentHit),
            },
            calendar: {
                holiday: calendar.holidayName(date, scope),
                next_day_holiday: calendar.holidayName(addDays(date, 1), scope),
                long_weekend: lw,
                special: s.calendar.map((f) => f.label),
            },
            ...(q.price != null ? { price_check: priceCheck(q, scope) } : {}),
            alternatives,
            model: { version: MODEL_VERSION, today },
        };
    }

    /** Mejores fechas en un rango, con lo que más pesa en cada una y la mejor de cada semana. */
    function recommend(q: DateQuery, opts: { from: string; to: string; weekdays?: number[]; top?: number; minScore?: number }) {
        const scope = scopeFor(q);
        const exclude = new Set(q.exclude_keys || []);
        const memo = new Map<string, ReturnType<typeof pressureOn>>();
        const scored: ReturnType<typeof scoreDate>[] = [];
        for (let d = opts.from; d <= opts.to; d = addDays(d, 1)) {
            if (opts.weekdays?.length && !opts.weekdays.includes(dayOfWeek(d))) continue;
            scored.push(scoreDate(d, q, scope, exclude, memo));
        }
        const eligible = scored.filter((s) => opts.minScore == null || s.score >= opts.minScore);
        const ranked = [...eligible].sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
        const present = (s: (typeof scored)[number]) => ({
            date: s.date,
            weekday: WEEKDAY_NAMES[s.dow],
            score: s.score,
            verdict: s.verdict,
            same_day_competitors: s.comp.here.hits.filter((h) => h.days_apart === 0).length,
            why: topReasons(s.factors),
        });
        // Mejor fecha de cada semana (lunes a domingo)
        const weeks = new Map<string, (typeof scored)[number]>();
        for (const s of eligible) {
            const monday = addDays(s.date, -((s.dow + 6) % 7));
            const best = weeks.get(monday);
            if (!best || s.score > best.score) weeks.set(monday, s);
        }
        const mid = scored.length ? scored[Math.floor(scored.length / 2)].date : opts.from;
        return {
            event_type: q.event_type,
            city: scope.label,
            city_key: scope.cityKey,
            from: opts.from,
            to: opts.to,
            evaluated_dates: scored.length,
            top: ranked.slice(0, opts.top ?? 8).map(present),
            best_per_week: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, s]) => ({ week_of: week, ...present(s) })),
            confidence: confidenceFor(mid, q, scope, diffDays(mid, today)),
            model: { version: MODEL_VERSION, today },
        };
    }

    return { evaluate, recommend, calendar, isDestination };
}

/** Los 3 factores que más mueven la nota (o los que más la diferencian de otra fecha). */
function topReasons(factors: Factor[], versus?: Factor[]): string[] {
    const mine = new Map(factors.map((f) => [f.factor, f]));
    const base = new Map((versus || []).map((f) => [f.factor, f]));
    const names = [...new Set([...mine.keys(), ...base.keys()])];
    return names
        .map((name) => {
            const f = mine.get(name);
            const b = base.get(name);
            const impact = Math.abs(Math.log((f?.multiplier ?? 1) / (b?.multiplier ?? 1)));
            const text = f ? `${f.factor} ×${f.multiplier}: ${f.detail}` : `sin ${name} (la fecha original tenía ×${b!.multiplier}: ${b!.detail})`;
            return { impact, text };
        })
        .filter((x) => x.impact > 0.01)
        .sort((a, b) => b.impact - a.impact)
        .slice(0, 3)
        .map((x) => x.text);
}

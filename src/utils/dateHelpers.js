/**
 * Utilidades para formateo de fechas y horas.
 *
 * Los eventos ocurren en Chile, así que las horas se muestran SIEMPRE en la
 * zona horaria del evento (America/Santiago por defecto, o la del recinto),
 * nunca en la zona horaria del navegador de quien mira la página. Así un
 * visitante desde otro país ve la misma hora que aparece en el afiche.
 */

export const DEFAULT_EVENT_TIMEZONE = "America/Santiago";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;

/**
 * Devuelve una zona horaria válida (o la de Chile si no es válida).
 * @param {string} [tz]
 */
export const resolveTimeZone = (tz) => {
  if (!tz) return DEFAULT_EVENT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_EVENT_TIMEZONE;
  }
};

/**
 * Zona horaria del navegador. Se mantiene por compatibilidad, pero NO se usa
 * para mostrar horarios de eventos.
 */
export const getUserTimeZone = () => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Offset (en minutos) de una zona horaria en un instante dado.
 * Ej: America/Santiago en invierno => -240
 * @param {Date} date
 * @param {string} timeZone
 */
export const getTimeZoneOffsetMinutes = (date, timeZone = DEFAULT_EVENT_TIMEZONE) => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timeZone),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUTC - (date.getTime() - date.getMilliseconds())) / 60000);
};

const formatOffset = (minutes) => {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
};

const normalizeTime = (timeString) => {
  const match = TIME_RE.exec(timeString || "");
  if (!match) return "00:00:00";
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
};

/**
 * Convierte una fecha local (YYYY-MM-DD) + hora local (HH:MM[:SS]) de una zona
 * horaria en un objeto Date (instante real).
 * @param {string} dateString
 * @param {string} timeString
 * @param {string} [timeZone]
 * @returns {Date|null}
 */
export const zonedDateTimeToDate = (dateString, timeString, timeZone = DEFAULT_EVENT_TIMEZONE) => {
  if (!dateString) return null;
  const day = String(dateString).slice(0, 10);
  if (!DATE_ONLY_RE.test(day)) return null;
  const time = normalizeTime(timeString);
  const naiveUTC = new Date(`${day}T${time}Z`);
  if (Number.isNaN(naiveUTC.getTime())) return null;
  // Dos pasadas para manejar correctamente los cambios de horario (DST)
  let offset = getTimeZoneOffsetMinutes(naiveUTC, timeZone);
  let result = new Date(naiveUTC.getTime() - offset * 60000);
  const offset2 = getTimeZoneOffsetMinutes(result, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = new Date(naiveUTC.getTime() - offset * 60000);
  }
  return result;
};

/**
 * ISO 8601 con el offset de la zona horaria (ej: 2025-10-22T20:00:00-03:00).
 * Válido para schema.org.
 * @param {Date|string} date - instante
 * @param {string} [timeZone]
 */
export const toZonedISOString = (date, timeZone = DEFAULT_EVENT_TIMEZONE) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const tz = resolveTimeZone(timeZone);
  const offset = getTimeZoneOffsetMinutes(d, tz);
  const local = new Date(d.getTime() + offset * 60000);
  const iso = local.toISOString().slice(0, 19); // YYYY-MM-DDTHH:MM:SS
  return `${iso}${formatOffset(offset)}`;
};

/**
 * ISO con offset a partir de fecha + hora local del recinto.
 */
export const zonedDateTimeToISO = (dateString, timeString, timeZone = DEFAULT_EVENT_TIMEZONE) => {
  const d = zonedDateTimeToDate(dateString, timeString, timeZone);
  return d ? toZonedISOString(d, timeZone) : null;
};

/**
 * Partes locales (fecha YYYY-MM-DD y hora HH:MM:SS) de un instante en una zona.
 * @param {Date|string} date
 * @param {string} [timeZone]
 * @returns {{date: string, time: string}|null}
 */
export const getZonedParts = (date, timeZone = DEFAULT_EVENT_TIMEZONE) => {
  const iso = toZonedISOString(date, timeZone);
  if (!iso) return null;
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
};

/**
 * Formatea una fecha en la zona horaria del evento.
 * Si recibe un string "YYYY-MM-DD" (columna date) lo trata como fecha de
 * calendario (sin corrimiento de un día).
 * @param {Date|string} date - La fecha a formatear
 * @param {Object} options - Opciones de Intl (se puede pasar timeZone)
 * @returns {string} Fecha formateada
 */
export const formatLocalDate = (date, options = {}) => {
  if (date === null || date === undefined || date === "") return "";
  const defaultOptions = {
    day: "numeric",
    month: "long",
    timeZone: DEFAULT_EVENT_TIMEZONE,
  };
  if (typeof date === "string" && DATE_ONLY_RE.test(date)) {
    // Fecha de calendario: formatear a mediodía UTC en UTC para evitar corrimientos
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("es-CL", {
      ...defaultOptions,
      ...options,
      timeZone: "UTC",
    });
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-CL", {
    ...defaultOptions,
    ...options,
    timeZone: resolveTimeZone(options.timeZone),
  });
};

/**
 * Formatea una hora en la zona horaria del evento.
 * @param {Date|string} datetime - La fecha/hora a formatear
 * @param {Object} options - Opciones de Intl (se puede pasar timeZone)
 * @returns {string} Hora formateada (HH:MM)
 */
export const formatLocalTime = (datetime, options = {}) => {
  if (!datetime) return "";
  const d = new Date(datetime);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
    timeZone: resolveTimeZone(options.timeZone),
  });
};

/**
 * Formatea una hora desde un string de tiempo (HH:MM[:SS]) — columnas `time`
 * que ya están en hora local del recinto. No aplica conversión.
 * @param {string} timeString
 * @returns {string} HH:MM
 */
export const formatLocalTimeFromString = (timeString) => {
  if (!timeString) return "";
  const match = TIME_RE.exec(String(timeString));
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  // Timestamp completo: convertir a la zona del evento
  return formatLocalTime(timeString);
};

/**
 * Fecha + hora legibles de una función (event_dates row).
 * @param {{date: string, start_time?: string, end_time?: string}} fn
 */
export const formatFunctionDate = (fn, options = { weekday: "short", day: "numeric", month: "long" }) => {
  if (!fn?.date) return "";
  return formatLocalDate(String(fn.date).slice(0, 10), options);
};

export const formatFunctionTimeRange = (fn) => {
  if (!fn) return "";
  const start = formatLocalTimeFromString(fn.start_time);
  const end = formatLocalTimeFromString(fn.end_time);
  if (start && end) return `${start} - ${end} hrs`;
  if (start) return `${start} hrs`;
  return "";
};

/**
 * Formatea una fecha completa con rango de fechas y horas
 * @param {Array} dateArray - Array de objetos con date, start_time, end_time
 * @returns {string} Fecha y hora formateada
 */
export const formatFullDateRange = (dateArray) => {
  if (!dateArray || !dateArray.length) return "No hay fechas disponibles";

  const start = dateArray[0];
  const end = dateArray[dateArray.length - 1];

  const startDate = formatLocalDate(String(start.date).slice(0, 10));
  const endDate = formatLocalDate(String(end.date).slice(0, 10));

  const startTime = formatLocalTimeFromString(start.start_time);
  const endTime = formatLocalTimeFromString(end.end_time);

  const timePart = endTime
    ? `desde las ${startTime} hasta las ${endTime} hrs`
    : `desde las ${startTime} hrs`;

  return startDate !== endDate
    ? `Del ${startDate} al ${endDate}, ${timePart}`
    : `${startDate}, ${timePart}`;
};

/**
 * Formatea el rango de fechas de un evento. Usa `event.dates` (funciones) si
 * existen; si no, `start_date`/`end_date` en la zona horaria del evento.
 * @param {Object} event
 * @returns {string}
 */
export const formatEventDateRange = (event) => {
  if (!event) return "";
  const tz = resolveTimeZone(event.timezone);

  const dates = Array.isArray(event.dates)
    ? event.dates.filter((d) => d && d.date && d.start_time)
    : [];
  if (dates.length > 0) {
    if (dates.length > 1) {
      const first = formatLocalDate(String(dates[0].date).slice(0, 10));
      const last = formatLocalDate(String(dates[dates.length - 1].date).slice(0, 10));
      return first === last
        ? `${first} · ${dates.length} funciones`
        : `Del ${first} al ${last} · ${dates.length} funciones`;
    }
    return formatFullDateRange(dates);
  }

  if (!event.start_date) return "Fecha por confirmar";
  const startDate = formatLocalDate(event.start_date, { timeZone: tz });
  const startTime = formatLocalTime(event.start_date, { timeZone: tz });
  if (!event.end_date) return `${startDate}, desde las ${startTime} hrs`;

  const endDate = formatLocalDate(event.end_date, { timeZone: tz });
  const endTime = formatLocalTime(event.end_date, { timeZone: tz });
  return startDate !== endDate
    ? `Del ${startDate} al ${endDate}, desde las ${startTime} hasta las ${endTime} hrs`
    : `${startDate}, desde las ${startTime} hasta las ${endTime} hrs`;
};

/**
 * Formatear fecha del evento (zona horaria del evento)
 * @param {Object} event
 * @returns {string}
 */
export const formattedDate = (event) => {
  if (!event?.start_date) return "Fecha no disponible";
  return formatLocalDate(event.start_date, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: resolveTimeZone(event.timezone),
  });
};

/**
 * Formatear hora del evento (zona horaria del evento)
 * @param {Object} event
 * @returns {string}
 */
export const formattedTime = (event) => {
  if (!event?.start_date) return "Hora no disponible";
  return formatLocalTime(event.start_date, { timeZone: resolveTimeZone(event.timezone) }) + " hrs";
};

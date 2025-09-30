/**
 * Utilidades para formateo de fechas y horas que se adaptan automáticamente
 * a la zona horaria local del usuario
 */

/**
 * Obtiene la zona horaria local del usuario
 * @returns {string} La zona horaria del usuario (ej: "America/Santiago", "Europe/Madrid")
 */
export const getUserTimeZone = () => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

/**
 * Formatea una fecha usando la zona horaria local del usuario
 * @param {Date|string} date - La fecha a formatear
 * @param {Object} options - Opciones de formateo
 * @returns {string} Fecha formateada
 */
export const formatLocalDate = (date, options = {}) => {
  const defaultOptions = {
    day: "numeric",
    month: "long",
    timeZone: getUserTimeZone()
  };
  
  return new Date(date).toLocaleDateString("es-CL", { ...defaultOptions, ...options });
};

/**
 * Formatea una hora usando la zona horaria local del usuario
 * @param {Date|string} datetime - La fecha/hora a formatear
 * @param {Object} options - Opciones de formateo
 * @returns {string} Hora formateada
 */
export const formatLocalTime = (datetime, options = {}) => {
  const defaultOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: getUserTimeZone()
  };
  
  return new Date(datetime).toLocaleTimeString("es-CL", { ...defaultOptions, ...options });
};

/**
 * Formatea una hora desde un string de tiempo (HH:MM)
 * @param {string} timeString - String de tiempo en formato HH:MM
 * @param {Object} options - Opciones de formateo
 * @returns {string} Hora formateada
 */
export const formatLocalTimeFromString = (timeString, options = {}) => {
  if (!timeString) return "";
  
  // Para strings de tiempo simples (HH:MM o HH:MM:SS), devolverlos directamente
  // ya que ya vienen formateados correctamente desde getTimeFromTimestamp
  if (timeString.match(/^\d{1,2}:\d{2}(:\d{2})?$/)) {
    // Asegurar formato HH:MM (sin segundos para consistencia)
    const parts = timeString.split(':');
    const hours = parts[0].padStart(2, '0');
    const minutes = parts[1].padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  
  // Para otros formatos más complejos, usar formateo estándar
  const defaultOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: getUserTimeZone()
  };
  
  try {
    return new Date(`1970-01-01T${timeString}`).toLocaleTimeString("es-CL", { ...defaultOptions, ...options });
  } catch (error) {
    console.warn(`Error formateando tiempo "${timeString}":`, error);
    return timeString; // Devolver el string original si hay error
  }
};

/**
 * Formatea una fecha completa con rango de fechas y horas
 * @param {Array} dateArray - Array de objetos con date, start_time, end_time
 * @returns {string} Fecha y hora formateada
 */
export const formatFullDateRange = (dateArray) => {
  if (!dateArray.length) return "No hay fechas disponibles";

  const start = dateArray[0];
  const end = dateArray[dateArray.length - 1];

  const startDate = formatLocalDate(start.date);
  const endDate = formatLocalDate(end.date);

  const startTime = formatLocalTimeFromString(start.start_time);
  const endTime = formatLocalTimeFromString(end.end_time);

  return startDate !== endDate 
    ? `Del ${startDate} al ${endDate}, desde las ${startTime} hasta las ${endTime} hrs` 
    : `${startDate}, desde las ${startTime} hasta las ${endTime} hrs`;
};

/**
 * Formatea un rango de fechas para eventos con start_date y end_date
 * @param {Object} event - Objeto evento con start_date y end_date
 * @returns {string} Fecha y hora formateada
 */
export const formatEventDateRange = (event) => {
  const startDate = formatLocalDate(event.start_date);
  const endDate = formatLocalDate(event.end_date);

  const startTime = formatLocalTime(event.start_date);
  const endTime = formatLocalTime(event.end_date);

  return startDate !== endDate 
    ? `Del ${startDate} al ${endDate}, desde las ${startTime} a las ${endTime} hrs` 
    : `${startDate}, desde las ${startTime} a las ${endTime} hrs`;
};


/**
 * Formatear fecha del evento usando zona horaria local del usuario
 * @param {Object} event - Objeto evento con start_date y end_date
 * @returns {string} Fecha formateada
 */
export const formattedDate = (event) => {
  if (!event.start_date) return "Fecha no disponible";
  return formatLocalDate(event.start_date, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
};

/**
 * Formatear hora del evento usando zona horaria local del usuario
 * @param {Object} event - Objeto evento con start_date y end_date
 * @returns {string} Hora formateada
 */
export const formattedTime = (event) => {
  if (!event.start_date) return "Hora no disponible";
  return formatLocalTime(event.start_date) + " hrs";
};

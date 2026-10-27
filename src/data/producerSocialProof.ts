// Prueba social de la landing /organizadores (SPEC_landing_productores §5.1 y §13.2-3). SOLO datos reales y con
// permiso: logos de productoras que lo autorizaron por escrito y cifras de la plataforma que se decidió publicar.
// Nunca inventar ni redondear hacia arriba. Con las dos listas vacías, la fila completa no se muestra.

/** Logo en gris (public/landing/logos/...), con el nombre de la productora como texto alternativo. */
export type ProducerLogo = { name: string; src: string; width: number; height: number };
/** Cifra ya formateada en es-CL ("1.240") y su rótulo ("funciones publicadas"). */
export type ProducerStat = { value: string; label: string };

export const PRODUCER_LOGOS: ProducerLogo[] = [];
export const PRODUCER_STATS: ProducerStat[] = [];

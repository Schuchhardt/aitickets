// Prueba social de la landing /organizadores (SPEC_landing_productores §5.1 y §13.2-3). SOLO datos reales y con
// permiso: logos de productoras que lo autorizaron por escrito y cifras de la plataforma que se decidió publicar.
// Nunca inventar ni redondear hacia arriba. Con las dos listas vacías, la fila completa no se muestra.

/** Logo en gris (public/landing/logos/...), con el nombre de la productora como texto alternativo. */
export type ProducerLogo = { name: string; src: string; width: number; height: number };
/** Cifra ya formateada en es-CL ("1.240") y su rótulo ("funciones publicadas"). */
export type ProducerStat = { value: string; label: string };

export const PRODUCER_LOGOS: ProducerLogo[] = [];
export const PRODUCER_STATS: ProducerStat[] = [];

/** Cita de un productor con nombre, productora y foto, todo autorizado por escrito (foto en public/landing/...). */
export type ProducerTestimonial = {
  quote: string;
  name: string;
  /** Productora y ciudad ("Risas Producciones · Santiago") */
  company: string;
  photo: { src: string; width: number; height: number };
};

/** Testimonio de /ticketera-stand-up (SPEC_landing_standup §4.8). null: la sección no se renderiza. */
export const STANDUP_TESTIMONIAL: ProducerTestimonial | null = null;

/**
 * Cita de una directora o director de academia (SPEC_landing_academias §3.7 y §0.4): solo si es real y autorizada por
 * escrito. La foto de la sección es la de la academia (también autorizada). null: no se muestra la cita y quedan los
 * chips "Hecho para".
 */
export type AcademyTestimonial = {
  quote: string;
  name: string;
  /** Academia y ciudad ("Academia de Música Allegro · Valparaíso") */
  academy: string;
};

/** Testimonio de /academias. null: la cita no se renderiza. */
export const ACADEMY_TESTIMONIAL: AcademyTestimonial | null = null;

/**
 * Cita con formato de prensa de /ticketera-musica-en-vivo (SPEC_landing_musica §4.10 y §0.8): solo si es real, con
 * nombre, banda/productora/sala, ciudad y foto autorizados por escrito. company = "Banda / productora / sala · ciudad".
 * null: la sección no se renderiza.
 */
export const MUSIC_TESTIMONIAL: ProducerTestimonial | null = null;

/**
 * Cita con formato de crítica de /ticketera-teatro (SPEC_landing_teatro §4.9 y §0.8): solo si es real, con nombre,
 * compañía o sala, ciudad y foto autorizados por escrito. company = "Compañía o sala · ciudad". null: la sección no se
 * renderiza.
 */
export const THEATRE_TESTIMONIAL: ProducerTestimonial | null = null;

/**
 * Cita de "nota pegada" de /ticketera-talleres (SPEC_landing_talleres §4.10 y §0.8): solo si es real, con nombre,
 * taller o espacio, ciudad y foto autorizados por escrito. company = "Taller o espacio · ciudad". null: la sección no se
 * renderiza. highlight: la frase clave de la cita (un trozo literal de quote), que va con el destacador.
 */
export type WorkshopTestimonial = ProducerTestimonial & { highlight?: string };
export const WORKSHOP_TESTIMONIAL: WorkshopTestimonial | null = null;

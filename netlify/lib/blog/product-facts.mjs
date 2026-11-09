// Lo ÚNICO que un artículo del blog puede afirmar de AI Tickets, y las páginas propias a las que puede enlazar.
//
// Igual que las landings (src/data/landings.ts), solo lo que el producto hace HOY. Cada hecho sale de lo ya verificado
// allí y en src/data/producerFaq.ts / organizadoresFaq.ts; tarifas y plazos se arman desde sus fuentes únicas
// (netlify/lib/fees.mjs y legal.mjs) para que no queden desfasados. Si cambia el producto, actualizar aquí también.
// tests/unit/blog-engine.test.mjs revisa que cada landing y cada guía estén en INTERNAL_PAGES.
import { IVA_PERCENT_LABEL, SERVICE_FEE_PERCENT_LABEL, computeFeeSplit } from '../fees.mjs'
import { PAYOUT_BUSINESS_DAYS, PAYOUT_RELEASE_HOURS } from '../legal.mjs'

const clp = (n) => `$${Math.round(n).toLocaleString('es-CL')}`
const example = computeFeeSplit(10000)

export const PRODUCT_FACTS = [
  `Crear la cuenta y publicar eventos es gratis y no hay mensualidad. El productor recibe el 100% del valor de sus entradas (0% de comisión para el productor).`,
  `Por cada entrada pagada, el comprador paga un cargo por servicio de ${SERVICE_FEE_PERCENT_LABEL} del valor de la entrada más IVA (${IVA_PERCENT_LABEL}) sobre ese cargo: en una entrada de ${clp(10000)} el comprador paga ${clp(example.total)}. Las entradas gratis no pagan cargo.`,
  'El productor puede absorber el cargo por servicio en un evento: el comprador ve un precio final y el cargo se descuenta de la venta.',
  'El comprador paga con Webpay o tarjeta. La comisión de la pasarela de pago la cubre AI Tickets.',
  `Lo vendido en cada función queda disponible ${PAYOUT_RELEASE_HOURS} horas después de que termina; el productor pide el retiro y llega en hasta ${PAYOUT_BUSINESS_DAYS} días hábiles a una cuenta bancaria verificada.`,
  'Cada evento tiene su página optimizada para el celular, con preguntas frecuentes y un asistente que responde dudas de los compradores. La IA ayuda a escribir la descripción y las preguntas frecuentes.',
  'Los eventos se crean como borrador y se pueden revisar con un link de vista previa privado antes de publicarlos.',
  'Un evento puede tener varias funciones (fechas), cada una con su aforo, y varios tipos de entrada con cupo propio (por ejemplo preventa, general, estudiante).',
  'Códigos de descuento por porcentaje o monto, con usos máximos, límite por comprador y fecha de término.',
  'Cada entrada llega por email al instante con un código QR único y un recordatorio antes del evento.',
  'El equipo valida los QR con la cámara del celular, sin apps ni lectores; si se cae la señal sigue validando con la lista descargada y sincroniza al volver la conexión. El rol Puerta valida entradas sin ver finanzas.',
  'Cortesías con su propio QR, enviadas por correo desde el panel, que no cuentan como venta.',
  'Links de venta con seguimiento (ref y parámetros UTM) para cada promotor, artista o campaña: las métricas del evento muestran órdenes, entradas e ingresos por canal. Cada promotor puede ver sus ventas con un link privado, sin cuenta.',
  'Métricas del evento: visitas, conversión, ventas por día, por canal y por tipo de entrada, con exportación a CSV.',
  'Difusión automática en Instagram: el productor conecta su cuenta y aprueba una serie de historias con cuenta regresiva y publicaciones que salen solas hasta el día del evento; a quien responde se le envía el link de compra por mensaje directo.',
  'Anuncios opcionales en Instagram y Facebook creados desde AI Tickets con la cuenta publicitaria de Meta del productor; Meta cobra el gasto directo.',
  'Entradas numeradas con mapa de asientos para salas con butacas.',
  'Lista de espera: cuando hay entradas de nuevo, se avisa sola a quienes la pidieron.',
  'Certificados de asistencia en PDF para quienes ingresaron (seminarios y cursos).',
  'Web de eventos gratis para la productora, con todos sus eventos.',
  'Reporte semanal por correo con las ventas de la semana y sugerencias de difusión.',
  'Asistente de IA conectado (ChatGPT o Claude) para gestionar eventos, entradas, invitados y ventas conversando.',
]

/**
 * Páginas propias que un artículo puede enlazar (ruta → para qué sirve). Las landings verticales y de funcionalidad,
 * las guías y las páginas fijas; los artículos del blog publicados se agregan en tiempo de ejecución.
 */
export const INTERNAL_PAGES = [
  { path: '/organizadores', title: 'AI Tickets para organizadores: todo lo que incluye' },
  { path: '/organizadores/registro', title: 'Crear una cuenta gratis de productor' },
  { path: '/precios', title: 'Precios y calculadora de cargos' },
  { path: '/ticketeras-en-chile', title: 'Comparación de ticketeras en Chile con fuentes' },
  { path: '/web-gratis', title: 'Web de eventos gratis para productoras' },
  { path: '/ticketera-stand-up', title: 'Vender entradas para stand-up' },
  { path: '/ticketera-teatro', title: 'Vender entradas para teatro' },
  { path: '/ticketera-musica-en-vivo', title: 'Vender entradas para conciertos y música en vivo' },
  { path: '/ticketera-discotecas', title: 'Ticketera para clubs y discotecas' },
  { path: '/ticketera-fiestas', title: 'Vender entradas para fiestas' },
  { path: '/ticketera-seminarios', title: 'Inscripciones para seminarios y congresos' },
  { path: '/ticketera-talleres', title: 'Inscripciones para talleres y cursos' },
  { path: '/academias', title: 'Entradas para muestras y recitales de academias' },
  { path: '/vender-entradas-online', title: 'Cómo vender entradas online en Chile' },
  { path: '/entradas-con-qr', title: 'Entradas con QR y control de acceso' },
  { path: '/ventas-por-promotor', title: 'Links de venta por promotor' },
  { path: '/guias/como-vender-entradas-online', title: 'Guía: cómo vender entradas online' },
  { path: '/guias/como-hacer-una-preventa', title: 'Guía: cómo armar una preventa que funcione' },
  { path: '/guias/como-medir-ventas-por-promotor', title: 'Guía: cómo medir las ventas de cada promotor' },
  { path: '/guias/como-hacer-check-in-con-qr', title: 'Guía: cómo hacer el check-in con QR' },
]

export const isInternalPath = (path, extra = []) => {
  const clean = String(path || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  return INTERNAL_PAGES.some((p) => p.path === clean) || extra.includes(clean) || clean === '/blog' || clean.startsWith('/blog/tema/')
}

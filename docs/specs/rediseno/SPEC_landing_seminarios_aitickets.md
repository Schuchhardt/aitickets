# AI Tickets — Landing especializada para seminarios, congresos y charlas

**Para:** Claude Code (implementación)
**Ruta:** `/ticketera-seminarios` (**nueva**). Sigue el patrón de las otras verticales (`/ticketera-teatro`, `/ticketera-talleres`, `/ticketera-fiestas`) y cubre "ticketera para seminarios", "inscripción a seminarios", "inscripciones para congresos" y "acreditación de eventos con QR". Igual que las otras landings dedicadas: entrada **nueva** en `src/data/landings.ts` con `dedicated: true` y página propia `src/pages/ticketera-seminarios.astro`; la tarjeta, el sitemap, las relacionadas y "Según lo que produces" de `/organizadores` leen de `landings.ts`. Sin redirecciones (Preguntas abiertas 1).
**Público:** quienes organizan **eventos de conocimiento con expositores**: seminarios de un día, congresos y encuentros de dos o tres días, charlas abiertas, ciclos de charlas, jornadas de gremios, colegios profesionales, fundaciones, universidades y áreas de personas o comunicaciones de empresas. Su realidad: un **programa** por días y bloques (bienvenida, keynote, paneles, café, cierre), **expositores** que hay que acreditar e invitar, públicos con precios distintos (general, estudiante, socio o convenio, pase completo o por día), **empresas que compran para su equipo** y piden factura, auspiciadores y prensa con cortesía, la **acreditación** de 08:30 con fila en el hall y el wifi del hotel que se cae, y después la encuesta, las presentaciones por correo y la próxima edición. Hoy lo resuelven con un formulario, transferencias, una planilla de inscritos impresa y credenciales hechas a mano.
**Frontera con otras landings:** la **clase práctica con grupos chicos** (cerámica, cocina, fotografía) va en `/ticketera-talleres`; la **muestra de fin de año** va en `/academias`; un **show** con funciones va en stand-up, teatro o música. Esta página es para **el evento donde alguien expone y el público se inscribe para escuchar**, con agenda, acreditación y compradores institucionales. Se enlazan entre sí.
**Promesa:** *Tú armas el programa. La acreditación es un QR.* Inscripciones gratis o pagadas con Webpay, un congreso de varios días en un solo evento (pase completo o por día), precios para estudiantes y convenios, la empresa que compra para su equipo, cortesías para expositores, acreditación con el celular aunque no haya señal y lo de cada jornada disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina. 0% de comisión para el organizador.
**Métrica:** visitas → cuentas creadas → primer seminario publicado **con al menos dos tipos de entrada** (por ejemplo, general y estudiante) **o con dos o más funciones**, comparada con `/organizadores`. Secundaria: proporción de eventos gratis vs pagados y uso del escáner (eventos con ≥ 1 check-in).
**Prototipo:** no hay artboard. Esta spec define layout, copy y comportamiento; si después se dibuja un prototipo y difiere, manda este documento.
**Reutiliza** de `SPEC_landing_productores_aitickets.md`: fórmula de precio (§5.3), header sticky (§4), accesibilidad (§9), analítica base (§11). De lo ya implementado en el repo: `LandingFaq`, `LandingMobileBar`, `LandingMotion` (`data-lp-reveal` / `data-lp-step`), `CtaTracking`, `AppFooter tone="dark"`, `SoonBadge` (src/components/ui), `priceQuote` / `parseAmount` / `CALC_PRICE` / `CALC_QTY` / `formatCLP` (producerLanding.js), `usePayerToggle` y `useDelayedAnnouncement` (usePriceCalculator.js), `useAdsDemo`, `useWallDemo`, `cardLabel` / `stockSummary` / `formatSaleStart` (src/components/event/eventView.js), el patrón `photo()` de `fiestasLanding.js` y el patrón `pick`/`reword` de `fiestasFaq.ts`. **No reutiliza** el lenguaje visual de ninguna otra landing (ver §1).

---

## 0. Antes de empezar (Claude Code)

1. **Tema propio** `[data-theme="seminarios"]` en `src/styles/landing-seminarios.css`, prefijo `se-`, con scope y sin tocar los tokens globales; puente a `--surface-*`, `--text-*`, `--border` como música, clubs y fiestas (para `LandingFaq`, `LandingMobileBar`, `SoonBadge`). Debe verse distinto de las otras siete landings (tabla de §1).
2. **Dinero y plazos salen del código**, nunca escritos a mano: `SERVICE_FEE_PERCENT_LABEL`, `IVA_PERCENT_LABEL`, `SERVICE_FEE_LABEL`, `SERVICE_FEE_TAX_LABEL`, `SERVICE_FEE_NOTE`, `computeFeeSplit` (netlify/lib/fees.mjs, vía `priceQuote`); `computeDiscountedTotals` (netlify/lib/discounts.mjs); `PAYOUT_RELEASE_HOURS`, `PAYOUT_BUSINESS_DAYS`, `PAYOUT_SCHEDULE_TEXT`, `PAYOUT_SHORT_TEXT`, `LEGAL.receiptLabel` (netlify/lib/legal.mjs); `ABSORB_FEE_ACTIVATION`, `PRODUCER_FAQ`, `TERMS_NOTE`, `MAX_EVENT_FUNCTIONS` (src/data/producerFaq.ts); `DEFAULT_MAX_PER_PURCHASE` (Reservation/pricing.js); `CHECKIN_RELEASE_THRESHOLD`, `RESERVE_HOLD_DAYS` (src/lib/producer-api/ledger.ts); `LARGE_CAPACITY`, `HIGH_AMOUNT_CLP`, `RESERVE_BY_LEVEL` (netlify/lib/event-risk.mjs); `MAX_COURTESY_PER_REQUEST` (src/lib/courtesy.ts); `MAX_MESSAGES_PER_EVENT_PER_DAY` (tools/messaging.ts: módulo de servidor, se pasa por props o se espeja con test como `MAX_EVENT_FUNCTIONS`). En esta spec los montos van como `{…}` o con su valor actual solo para verificar.
3. **Hallazgos de dinero y plazos que el copy tiene que respetar (manda el código):**
   - **Cobro por jornada:** cada día del congreso es una función; el ledger libera cada orden `{PAYOUT_RELEASE_HOURS}` h después del **término de su función**. Una orden con **pase completo** (entrada para todas las funciones, `event_date_id = NULL`) o con entradas de varios días se libera con la **última función del evento** (`ledger.ts`). La regla no existe como texto en `legal.mjs`: el texto se arma en `seminariosLanding.js` con `PAYOUT_RELEASE_HOURS` y un comentario que cita `ledger.ts` (como talleres).
   - **Condiciones de liberación** (`ledger.ts`, términos §8): identidad aprobada, cuenta verificada, check-ins ≥ `CHECKIN_RELEASE_THRESHOLD` de lo pagado de la función (para el pase completo, los del evento) **o** que el organizador acredite que se realizó, sin reclamos abiertos; después, reserva por riesgo. La página no las detalla: usa `PAYOUT_SCHEDULE_TEXT` / `PAYOUT_SHORT_TEXT` con `*` y `TERMS_NOTE`, y una nota corta: acreditar en la puerta también cuenta para tu pago.
   - **Documentos tributarios:** los términos (`src/pages/terms.astro` §3) dicen *"Por el cargo por servicio emitimos boleta electrónica. El precio de la entrada lo documenta el productor."* Cada compra trae un `LEGAL.receiptLabel` ("Comprobante de compra"), que **no** es boleta ni factura. El copy de empresas (§4.4, FAQ 8) dice exactamente eso; AI Tickets **no emite factura** por el valor de las entradas. El comentario de `terms.astro` marca ese punto como pendiente de validar con abogado y contador: Preguntas abiertas 6.
   - **Reserva por riesgo** (`event-risk.mjs`): un congreso grande de un organizador nuevo suma señales (`new_producer`, `high_amount` sobre `HIGH_AMOUNT_CLP`, `large_capacity` sobre `LARGE_CAPACITY`) y puede quedar en nivel alto (`RESERVE_BY_LEVEL.high`% retenido hasta `RESERVE_HOLD_DAYS` días). Va en la FAQ 16 con `terms` (mismo texto validado en música y fiestas). Ver Preguntas abiertas 10.
4. **Rótulos y textos reales, tal cual** (la demo dice lo que dice el producto):
   - Card del evento (`cardLabel`): `Gratis`, `Gratis · Quedan N cupos`, `Gratis · Cupos llenos`, `Asistencia confirmada`, `Últimas entradas`, `{n} funciones` (y `· {n} lugares`), `Agotado`, `Venta abre el {formatSaleStart}`. Botones: `Confirmar asistencia`, `Elegir entradas`, `Comprar entrada`. Checkout: `Disponible desde el {formatSaleStart(iso)}`, `Agotada`, `{SERVICE_FEE_NOTE}`. La página pública dice **"funciones"** (`Próximas funciones`), no "días": la demo lo muestra así (Preguntas abiertas 2).
   - Escáner (`ValidateQR.vue`): `✅ Entrada validada con éxito para {nombre}`, `(pendiente de sincronizar)`, ` · Ojo: entrada para {función}`, aviso `⚠️ Esta entrada es para otra función: {función}. Puedes validarla de todas formas si corresponde.`, `✅ Entrada validada manualmente para {nombre}`, `❌ Este ticket ya fue validado`, `{n} / {m} entradas validadas`, `▼ Buscar asistente (validación manual / reenviar entradas)`, `Buscar por nombre o correo...`.
   - Página del evento: `Organiza: {razón social} · RUT {rut}` y `✓ Productor verificado` (`EventTrust.vue`), `Añadir al calendario` (`shareActions.js`), botón de compartir con LinkedIn (`ShareSheet.vue`).
   - Encuesta: `RATING_LABELS` (`Malo` … `Excelente`), campo `Mensaje privado para {organizador} (opcional)` con *"Sugerencias, algo que mejorar… Solo lo verá la productora."* (`EventReviews.vue`), etiqueta `Privado` en el panel (`EventReviewsManager.vue`).
   - Canales: `categorizeReferrer` etiqueta las visitas que vienen de LinkedIn como `LinkedIn`; `DIRECT_CHANNEL` (eventAnalytics.ts).
5. **"Pronto"**: todo lo de §0.7 que se muestre lleva `SoonBadge` (`dark` sobre turquesa y auditorio). Nunca se dibuja como si funcionara.
6. **Verificado en el código (se puede prometer):**
   - **Inscripción gratis** en la card del evento (`RsvpForm.vue`): nombre y correo, `Confirmar asistencia`, QR al correo, sin cargo (`PRODUCER_FAQ`). Cupo por tipo de entrada; al llenarse, `Gratis · Cupos llenos` y la página ofrece dejar el correo (solo registra, §0.7).
   - **Inscripción pagada** con Webpay (Flow): tarjetas de crédito y débito, también las de empresa. Cargo absorbible por evento (`ABSORB_FEE_ACTIVATION`).
   - **Congreso de varios días en un evento:** hasta `MAX_EVENT_FUNCTIONS` funciones, cada una con fecha, hora de inicio y término y lugar (`EditEventForm.vue`, `schedule.ts`). Cada tipo de entrada sirve para **una** función (cupo propio) **o para todas** (pase completo, cupo compartido): no para dos de tres días. En la página el público elige la función y luego la entrada (`checkoutFunctions`); la card muestra `{n} funciones` y chips de fechas.
   - **Tipos de entrada** con precio, cupo, máximo por compra (`DEFAULT_MAX_PER_PURCHASE`; de 1 a 50 desde el asistente de IA, `tools/tickets.ts`) y **ventana de venta** (`init_date`/`end_date`, hoy desde el asistente de IA: sirve para una preventa que cierra en una fecha). Todos los tipos son visibles: no hay entradas ocultas que se desbloqueen con código.
   - **Códigos de descuento** desde el panel (`DiscountCodesManager.vue`, `discounts.mjs`): % o monto (> 0), usos máximos, límite por comprador, inicio y término, **de un evento o de toda la organización**; se aplican al subtotal de la orden (no a un tipo de entrada). En el panel, usos, compras, descuento y ventas por código.
   - **Cortesías nominadas** desde el panel (`CourtesyTicketsForm.vue`, `courtesy.ts`): tipo de entrada, nombre y correo, hasta `MAX_COURTESY_PER_REQUEST` por envío; QR propio, no cuentan como venta. Lista de invitados (nombre, contacto, acompañantes) y envío del link por correo o WhatsApp: **desde el asistente de IA** (`tools/guests.ts`).
   - **Compra de varias entradas:** el correo trae cada entrada con su link "Ver QR" para pasársela a otra persona (`src/pages/ticket/[id].astro`). **Cambiar el titular** de una entrada (QR nuevo a su correo, el anterior deja de servir): desde el asistente de IA (`transfer_ticket`, `tools/postsale.ts`). Sin transferir, el escáner muestra el nombre de quien compró.
   - **Identificación del organizador** en la página (`EventTrust.vue`): razón social y RUT si los registró, y `Productor verificado` con la identidad aprobada.
   - **CSV de órdenes** desde el panel (`ordersExport.ts`, `EXPORT_HEADER`): `Comprador`, `Email`, `Entradas`, `Cantidad`, `Código de descuento`, `Total pagado`, `Neto productor`, `Medio de pago`, `Canal`, entre otras. **Lista de asistentes** con quién ingresó y a qué hora, filtrable por tipo y función: desde el asistente de IA (`list_attendees`, tools/access.ts).
   - **Evento privado** (no aparece en la cartelera ni en buscadores, solo con el link) desde el panel (`EditEventForm.vue`). **Vista previa privada** de un borrador para mostrarlo a socios o al equipo (`PreviewLinksManager.vue`, panel).
   - **Página del evento:** descripción con títulos, listas y enlaces (`sanitize.ts`: `h2`, `h3`, `ul`, `ol`, `li`…), preguntas frecuentes generadas con IA (`EventFAQManager.vue`), asistente que responde con la información cargada (`EventAssistant.vue`), `Añadir al calendario`, mapa, video de portada y galería (`GALLERY_MAX_IMAGES`). **"Quiénes van"**: emoji + mensaje (`FEED_MESSAGE_MAX`) que ven **solo quienes tienen entrada**, moderado por el organizador (`attendee-community.mjs`).
   - **Recordatorio automático** por correo el día antes de cada función a quienes tienen entrada para esa función; a quien tiene pase completo, **solo antes de la primera** (`send-event-reminders`). **Mensajes y recordatorios extra** a los inscritos (ahora o programados; a todos o solo a quienes no han ingresado; máx. `MAX_MESSAGES_PER_EVENT_PER_DAY` por día): **desde el asistente de IA** (`send_attendee_message`, `schedule_reminder`).
   - **Difusión:** links con seguimiento por expositor, auspiciador o institución y métricas por canal (`TrackingLinkBuilder.vue`, `eventAnalytics.ts`); la venta se asocia si compra en la misma visita (`PRODUCER_FAQ`). Visitas por origen, incluido `LinkedIn` (`categorizeReferrer`); compartir en LinkedIn desde la página. **Instagram automático** (`socialSeries.ts`, `DEFAULT_CADENCE`, `DEFAULT_KEYWORD`), piezas con IA (`/api/promote/generate`), **anuncios** en Instagram y Facebook con la cuenta publicitaria de Meta del organizador (`zernio-ads.mjs`, `AD_LIMITS`). Reporte semanal por correo (`weekly-report-send.mjs`).
   - **Acreditación:** escáner en el celular con varias personas a la vez (rol Puerta en `permissions.ts`; link de escáner sin cuenta que vence solo, **hoy desde el asistente de IA**, `tools/access.ts`), sin señal con sincronización, aviso si la entrada es de otra función (`getFunctionCheck`, `checkin.mjs`) con opción de validarla igual, búsqueda por nombre o correo con validación manual y reenvío (`/api/orders/resend`), contador de validadas. **Una entrada se valida una sola vez** (`confirm-ticket`): el pase completo se acredita el primer día que la persona llega; si se escanea otro día, el escáner dice `❌ Este ticket ya fue validado` (§0.7). Estadísticas de ingreso por tipo de entrada: desde el asistente de IA (`get_checkin_stats`).
   - **Después:** encuesta por correo entre `REVIEW_REQUEST_DELAY_HOURS` y `REVIEW_REQUEST_WINDOW_HOURS` h después de cada función: estrellas, comentario público, **mensaje privado para el organizador** y hasta `MAX_PHOTOS_PER_PERSON` fotos; se ven y exportan desde el panel (`EventReviewsManager.vue`). Código de premio opcional (`REWARD_LIMITS`, `REWARD_CODE_PREFIX`). **Invitar a la próxima edición** a `INVITE_AUDIENCES` (incluye *Solo quienes ingresaron (check-in)*), máx. `MAX_INVITATIONS_PER_ORG_PER_DAY` envíos al día. **Duplicar** el evento con sus tipos de entrada y preguntas frecuentes (`eventDuplicate.ts`). **Web gratis** con la cartelera de la institución (`/web-gratis`, plantilla `clasico` "ideal para teatro, charlas y ferias").
   - **Eventos grandes o masivos:** aforo > `LARGE_CAPACITY` o masivo piden documentos (permiso, póliza y, si es masivo, la autorización de la Delegación Presidencial; Ley 21.659).
7. **No existe (no prometer; `Pronto` si se muestra):**
   - **Agenda con expositores, horarios y salas como sección propia de la página** → `Pronto` en §4.3. Hoy el programa va en la descripción (títulos por día, lista por bloque) y el asistente lo usa para responder.
   - **Ingreso diario con el mismo pase completo** (validar una vez por función) → `Pronto` en §4.3 y §4.7. Hoy el pase se acredita una vez.
   - **Datos de cada asistente al comprar** (nombre de cada persona, empresa, cargo) → `Pronto` en §4.4. Hoy la orden guarda los datos de quien compra; el titular se cambia desde el asistente de IA.
   - **Datos de facturación al comprar** (RUT y razón social de la empresa) → `Pronto` en §4.4.
   - **Imprimir credenciales con nombre** desde AI Tickets → `Pronto` en §4.7. La credencial de la página es un recurso gráfico, no una función.
   - **Certificado de asistencia** a partir de los check-ins → `Pronto` en §4.9.
   - **Publicar en LinkedIn** (y Facebook, TikTok y reels en la serie automática) → `Pronto` en §4.5. **Segmentar anuncios por profesión o intereses** → `Pronto`.
   - **Ver la lista de espera y avisar cuando se libera un cupo** (hoy solo se registra, `api/events/waitlist.ts`) → `Pronto` en §4.6.
   - **Aforo en vivo en el panel** (hoy, contador del escáner y asistente de IA) → `Pronto` en §4.7.
   - **No se muestran** (ni como `Pronto`): pago con orden de compra, transferencia o crédito a 30 días; descuento por volumen ("5 o más entradas"); entradas ocultas solo con código; transmisión online o híbrida; preguntas propias en la encuesta; inscripción sujeta a aprobación. Van a Preguntas abiertas.
8. **Fotos:** las de `public/landing/aitk-seminario-*.jpg` son de referencia generadas con IA (`fotos-nicho.md`). En producción van fotos reales de seminarios de organizadores que usen AI Tickets, con autorización escrita del organizador y, si se reconocen, de expositores y asistentes. Mientras no existan, se usan las de referencia con el mismo bloqueo de publicación que las otras landings (anotarlo en el PR). **La de acreditación muestra una pistola lectora**: AI Tickets escanea con la cámara del celular, así que esa foto **no puede publicarse** (ver §8). Lista de fotos reales en §8. **No se generan imágenes nuevas.**
9. **Testimonio:** solo una cita real (nombre, cargo, institución u organización, ciudad, foto autorizada). Si no hay (`SEMINAR_TESTIMONIAL = null` en `producerSocialProof.ts`, cambio aditivo), la sección no se renderiza.
10. **Nombres de ejemplo** (evento, organización, expositores, asistentes, empresas, códigos): ficticios, y cada card con datos dice `ejemplo`. **Nunca nombres de universidades, gremios, colegios profesionales o empresas reales.** Antes de publicar, revisar que "Jornada Equipos 2026" y los demás no coincidan con eventos o personas reales de Chile (Preguntas abiertas 18).
11. Las fases (§12) son commits dentro del PR único del rediseño (ver `README.md`): agregar `rediseno(seminarios): landing especializada` a la lista de commits del README (antes de "assets optimizados, SEO, analítica y tests") y la fila de la spec a su tabla.

---

## 1. Sistema visual propio: "credencial, programa y pantalla"

La referencia es **lo que se ve y se lleva en un congreso**: el **programa impreso** con su columna de horas y sus filetes finos, la **credencial** de PVC blanca con la ranura arriba, el **cordón** de color y una banda que dice qué eres (asistente, expositor, prensa), la **pantalla 16:9** donde se proyecta cada lámina con su número abajo, y la **señalética del centro de eventos** (`SALA 2 →`, `ACREDITACIÓN ↓`) con pictogramas y flechas. Es la landing **más sobria y precisa**: clara, institucional, alineada a una grilla de 12 columnas, **nada girado** (lo opuesto a fiestas) y con un solo color con carácter, el **turquesa del cordón**. Lo único que se mueve como objeto físico es la credencial, que cuelga y se balancea. La página se recorre como **un centro de eventos**: cada sección abre con su **rótulo de sala** y el header es la **pantalla que hay afuera de cada sala** (`AHORA` / `A CONTINUACIÓN`).

| | Stand-up | Academias | Música en vivo | Teatro | Talleres | Clubs | Fiestas | **Seminarios** |
|---|---|---|---|---|---|---|---|---|
| Fondo | negro cálido | papel cálido | negro frío + papel de afiche + rojo a sangre | azul noche + terciopelo + marfil | papel de cuaderno con cuadrícula + pizarra verde | negro violáceo + halos + blanco servicio | bloques planos naranja, cobalto y crema | **papel de programa neutro `#F5F5F0`** + **blanco pantalla** para láminas; **un bloque turquesa `#006B65`** (el hall de acreditación) y **auditorio `#0F1517`** solo en el cierre |
| Acento | lima + crema | tinta + café | rojo de sala | dorado de palco | azul lápiz + destacador | rosa fluor + violeta UV | los tres colores de pulsera + amarillo confeti | **turquesa del cordón `#00877F`** (gráficos) / `#006B65` (texto) + grafito; lima solo en "✅ validada" y "Tú recibes" |
| Titulares | Unbounded + Fraunces cursiva | Unbounded + Fraunces cursiva | Anton mayúsculas | Bodoni Moda | Bricolage Grotesque + destacador | Doto (LED) | Bagel Fat One + sticker | **Archivo variable**: Expanded 800 (`wdth 125`); el énfasis es **un cambio de ancho**: la frase pasa a **Condensed 700 (`wdth 62`) en turquesa**. Nunca cursiva, sticker, destacador ni subrayado |
| Metadatos | sans | sans | mono (setlist) | Prompt espaciada | Caveat manuscrita | horas en Doto | Prompt en la pulsera | **Archivo SemiCondensed (`wdth 75`) 600 en mayúsculas**, horas del programa en `tabular-nums`; leyendas de foto **"Fig. 01 —"** |
| Formas | radios 18–28, pill | radios 24–32 | 0 px, talones | arco de proscenio | fichas, cartón | cápsulas, LED | pulseras, stickers troquelados | **rectángulos de 4 px y filetes de 1 px**; la **credencial** (radio 12, ranura, cordón), **láminas 16:9** con pie numerado, **rótulos de sala** (pictograma + flecha); botones rectangulares con flecha que avanza |
| Fotos | color cálido | color con sombra | duotono + grano | viñeta de foco | color natural impreso, girado | color de club + fuga de luz | desechable con flash y fecha | **color natural sobrio** (`saturate(.92) contrast(1.04)`), radio 4, filete de 1 px, **leyenda numerada** abajo; en el hero, la **pantalla de la sala proyecta láminas** |
| Ritmo | capítulos alternados | comparador y pasos | cortes duros "01 —" | actos centrados | separadores con pestaña | hora a hora | la vida de una fiesta (pulseras) | **señalética de sala**: cada sección abre con su rótulo (`SALA 2 · EL PROGRAMA →`); grilla de 12 columnas, nada girado; header con la **pantalla "Ahora / A continuación"** |
| Firma interactiva | mapa de sala | antes/después del chat | curva de venta + tandas | cartelera + fader | arma tu taller + pasar lista | crossfader + linterna UV | escalera de preventa + stickers | **"El programa"**: formato → **matriz de acceso** (qué entrada vale qué día) con las funciones y la card tal como quedan publicadas + **"Mesa de acreditación"**: escáner con los textos reales y la **credencial que se imprime y cuelga del cordón** |

```css
[data-theme="seminarios"] {
  --se-papel: #F5F5F0;          /* papel del programa: fondo principal */
  --se-papel-2: #E9EAE3;        /* secciones alternas */
  --se-blanco: #FFFFFF;         /* láminas, credencial, cards */
  --se-grafito: #15191C;        /* texto y filetes fuertes (16,2:1 sobre papel) */
  --se-text-2: #3E464C;         /* texto secundario (8,8:1 sobre papel) */
  --se-text-3: #5B646B;         /* meta (5,5:1 sobre papel; 5,0:1 sobre papel-2) */
  --se-filete: rgba(21, 25, 28, 0.16); /* filetes de 1 px del programa */
  --se-cordon: #00877F;         /* turquesa del cordón: bandas, barras, pictogramas. Nunca texto bajo 24 px (4:1 sobre papel) */
  --se-cordon-ink: #006B65;     /* turquesa para texto sobre papel (5,8:1) y fondo del hall (blanco encima 6,4:1) */
  --se-cordon-claro: #CFEAE5;   /* bloques del programa, fila elegida (grafito encima 13,9:1; cordon-ink 5,0:1) */
  --se-auditorio: #0F1517;      /* sala a oscuras: solo el cierre */
  --se-auditorio-2: #1A2225;    /* cards sobre auditorio */
  --se-text-dark-2: #C9D1D0;    /* (11,9:1 sobre auditorio) */
  --se-text-dark-3: #95A1A0;    /* meta sobre auditorio (6,9:1) */
  --se-proyector: #4FD1C5;      /* turquesa sobre oscuro: cifras, puntero (9,9:1 sobre auditorio) */
  --brand-lime: (lima de marca);
  /* puente a los tokens que leen LandingFaq, LandingMobileBar, SoonBadge (como en música, clubs y fiestas) */
  --surface-0: var(--se-papel); --surface-1: var(--se-papel-2); --surface-2: var(--se-blanco);
  --text-1: var(--se-grafito); --text-2: var(--se-text-2); --text-3: var(--se-text-3);
  --border: var(--se-filete);
}
/* En el hall (turquesa) y el cierre (auditorio) se redefinen localmente --surface-*, --text-* y --border (clase .se-on-dark) */
```

**Reglas de color**
- **Turquesa** (`--se-cordon`): solo gráfico (cordón, bandas de credencial, barras, pictogramas, filete de la fila elegida). Como texto, siempre `--se-cordon-ink`. Sobre el bloque turquesa del hall el texto es blanco y las cifras grandes blancas.
- **Lima** (marca): solo `✅ … validada` en el escáner y el bloque `TÚ RECIBES` de la cotización. Los CTA son grafito (sobre papel) o blancos (sobre turquesa y auditorio), nunca lima.
- **Sin un segundo color de acento.** Lo que en otras landings se distingue por color, aquí se distingue por **trama**: la banda de la credencial es sólida turquesa (asistente), sólida grafito (expositor), con rayas diagonales turquesa/blanco (estudiante) o con contorno y rayado fino (cortesía). Nunca solo color para distinguir.
- Rojo solo para el error del escáner (el del producto), nunca decorativo.

**Tipografía**
- **Archivo** variable con ejes `wght` y `wdth` (`@fontsource-variable/archivo`; importar el CSS que incluye el eje de ancho y **verificar** en el build el nombre del woff2 `latin` y que traiga Á É Í Ó Ú Ñ ¿ ¡). Un solo archivo para titulares, énfasis y meta. `font-display: swap`; fallback con métricas ajustadas `"Archivo", "Archivo Fallback", "Arial", system-ui, sans-serif` (`@font-face { font-family: "Archivo Fallback"; src: local("Arial"); size-adjust: …; ascent-override: …; }`). Con el fallback, el titular tiene que leerse igual (el énfasis pierde el ancho pero conserva el color).
- **Titular:** Archivo 800, `font-stretch: 125%` (Expanded), tracking −0,02em, caja alta y baja. **Énfasis** (prop `emphasis` de `SeminarHeading`): la frase en Archivo 700 `font-stretch: 62%` (Condensed), `--se-cordon-ink`, mismo tamaño, en su propia línea. Es un solo `<h1>`/`<h2>` con un `<span>`.
- **Meta / señalética:** Archivo 600, `font-stretch: 75%`, 12 px, mayúsculas, tracking .08em, `tabular-nums`. **Leyendas:** Archivo 500 `75%` 13 px: `Fig. 01 — Texto.`
- **Cuerpo:** Prompt (la sans actual). Números de cotización y escáner: Archivo `tabular-nums`.
- **Escala desktop:** H1 88/88, H2 60/62, H3 26/30 (Archivo 700 `wdth 100`), cuerpo 18/29, cifras 56–96. **Mobile:** H1 44/46, H2 34/38, H3 21/26, cuerpo 16/25.

**Recursos gráficos**
- **Rótulo de sala** (`WayfindingSign.astro`): barra grafito de 48 px de alto (40 en mobile) y ancho de contenido (no a sangre), con un **cuadrado blanco** de 48×48 a la izquierda con un pictograma lucide en grafito, el texto `SALA 2 · EL PROGRAMA` en meta blanco 13 px y un **cuadrado turquesa** a la derecha con la flecha (`→`, `↓`, `↗`, según la prop `arrow`). Abre cada sección, alineado a la columna 1. El texto real de la sección está en el H2; el rótulo lleva `aria-hidden` salvo su eyebrow textual (`<p class="sr-only">`).
- **Credencial** (`Credential.astro` + swing en `seminariosLanding.client.js`): tarjeta blanca 260×372 (200×286 mobile), radio 12, filete grafito 1 px, sombra `0 18px 36px rgba(21,25,28,.14)`; **ranura** arriba (44×8, radio 4, recorte con `mask`); **cordón**: dos bandas turquesa de 14 px (SVG) que suben y salen del borde superior de su contenedor, con un clip metálico gris; **banda de tipo** de 40 px arriba con su trama y el tipo en meta blanco o grafito (`ASISTENTE`, `EXPOSITORA`, `ESTUDIANTE`, `CORTESÍA`); nombre en Archivo 800 Expanded 26 px (dos líneas máx.), organización en Prompt 14, `JORNADA EQUIPOS 2026 · DÍA 1` en meta, y un **QR decorativo** (SVG precalculado, `aria-hidden`) abajo a la derecha. Props: `name`, `org`, `type`, `day`, `swing` (bool). Sello `ejemplo` en meta, abajo a la izquierda. **No es una función del producto** (credenciales impresas son `Pronto`).
- **Lámina** (`Slide.astro`): rectángulo 16:9 blanco con filete 1 px, padding 6%, y **pie** de 28 px con filete superior: `JORNADA EQUIPOS 2026 · EJEMPLO` a la izquierda y `03 / 12` a la derecha (meta). Contenedor de mockups (programa, encuesta, canales).
- **Programa** (`ProgramGrid`): columna de horas (meta, `tabular-nums`, 64 px) + bloques separados por filetes de 1 px; bloque elegido con fondo `--se-cordon-claro` y filete izquierdo turquesa de 3 px. Pausas (café, almuerzo) en `--se-text-3` con pictograma.
- **Figura** (`Figure.astro`): `<figure>` con `<picture>`, radio 4, filete 1 px, filtro sobrio y `<figcaption>` `Fig. 0N — …` en meta. Sin giro, sin overlay.
- **Botón**: rectangular 52 px de alto, radio 4, Archivo 700 `wdth 100` 16 px, con flecha `→` en un cuadrado a la derecha que **avanza 4 px** en hover/foco. Primario: grafito con texto blanco (sobre papel), blanco con texto grafito (sobre turquesa y auditorio). Secundario: contorno 1,5 px. Foco: anillo 3 px `--se-cordon-ink` (blanco sobre turquesa/auditorio) + offset 3 px.
- Iconos: lucide del sitio (`presentation`, `mic`, `building-2`, `graduation-cap`, `id-card`, `qr-code`, `coffee`, `scan-line`, `receipt`, `users`, `megaphone`, `clipboard-check`). Nada de logos de LinkedIn, Instagram, Facebook ni de instituciones.

---

## 2. Estructura

| # | Rótulo de sala | Sección | Fondo | Ancla |
|---|---|---|---|---|
| 1 | — | Hero: H1, foto de la sala con la **pantalla que proyecta láminas**, credencial | papel | |
| 2 | `SALA 1 · PARA QUIÉN →` | Formatos: charla, seminario, congreso, ciclo, jornada, encuentro académico | papel | `#para-quien` |
| 3 | `SALA 2 · EL PROGRAMA →` | **El programa** (firma 1): formato, matriz de acceso, así queda publicado | blanco | `#programa` |
| 4 | `SALA 3 · EMPRESAS →` | La empresa compra para su equipo; convenios, cortesías, comprobantes | papel-2 | `#empresas` |
| 5 | `SALA 4 · DIFUSIÓN ↗` | Tus expositores convocan: links, Instagram, LinkedIn, anuncios | papel | `#difusion` |
| 6 | `CAFÉ · ANTES DEL DÍA →` | La página responde, recuerda y conecta | papel-2 | `#pagina` |
| 7 | `HALL · ACREDITACIÓN ↓` | **Mesa de acreditación** (firma 2) | **turquesa** | `#acreditacion` |
| 8 | `SALA 5 · PRECIO →` | La cotización (calculadora) y el cobro por jornada | papel | `#precio` |
| 9 | `SALA 6 · DESPUÉS →` | Encuesta, presentaciones, próxima edición | papel-2 | |
| 10 | — | Testimonio (solo si es real) | papel | |
| 11 | `INFORMACIONES · PREGUNTAS ↓` | Preguntas frecuentes | papel | |
| 12 | — | Cierre: la última lámina | **auditorio** | |
| 13 | — | Footer (`AppFooter tone="dark"`) | grafito | |

Orden pensado como el recorrido de un organizador por su propio congreso: qué haces, cómo armas el programa, a quién le vendes, cómo convocas, qué pasa antes, el hall de las 08:30, la plata y el día después.

---

## 3. Header y pantalla "Ahora / A continuación"

- `SeminarHeader.vue` (patrón de `StandupHeader.vue` / `PartyHeader.vue`): `position: fixed`, fondo `--se-papel` al 92% + `backdrop-filter: blur(12px)` + filete inferior `--border` desde el inicio (el hero es claro: no hay estado transparente).
- Logo · links `Programa` (`#programa`) · `Empresas` (`#empresas`) · `Acreditación` (`#acreditacion`) · `Precio` (`#precio`) · `Ingresar` · botón grafito `Publicar mi seminario`.
- **Pantalla de sala** (en lugar de la barra de lectura de stand-up, el reloj de clubs y la pulsera de fiestas): en desktop ≥ 1180 px, entre el logo y los links, un recuadro grafito de 300×40 (radio 4) con dos líneas en meta: `AHORA` (turquesa claro `--se-proyector`) + nombre de la sección visible en blanco, y `A CONTINUACIÓN` (gris) + la siguiente. Debajo, a lo ancho del header, un filete de 2 px turquesa que se llena con el scroll (`transform: scaleX`). Nombres: `Apertura`, `Para quién`, `El programa`, `Empresas`, `Difusión`, `Antes del día`, `Acreditación`, `Precio`, `Después`, `Preguntas`, `Cierre`. `aria-hidden` (es decorativa; la navegación real son los links). Entre 768 y 1180 px solo el filete; en mobile, el filete.
- Mobile: logo + botón de menú 44×44 (cuadrado grafito). `LandingMobileBar variant="pill-light"` con `title="Gratis para publicar"`, `subtitle="0% de comisión para el organizador"`, `ctaLabel="Publicar mi seminario"`; aparece después del hero y se oculta en el cierre (comportamiento existente).

---

## 4. Secciones (copy es-CL completo)

### 4.1 Hero (papel)
- Altura `min(100svh, 880px)` desktop / auto mobile. Grid de 12 columnas: texto en 1–5, foto en 6–12.
- **Izquierda:**
  - Eyebrow (meta, `--se-text-3`): `PARA SEMINARIOS, CONGRESOS, CHARLAS Y JORNADAS`
  - H1 (`SeminarHeading`): **Tú armas el programa.** / énfasis: **La acreditación es un QR.**
  - Bajada (con constantes): *Inscripciones gratis o pagadas con Webpay, un congreso de varios días en un solo evento, precios para estudiantes y convenios, y la acreditación con el celular aunque se caiga el wifi del hotel. Lo de cada jornada queda disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina\*. 0% de comisión para ti.*
  - CTAs: botón grafito `Publicar mi seminario →` (`landing.cta.label`, `publishUrl("seminarios_hero")`) · botón contorno `Ver una inscripción de ejemplo` (`landing.demo.url`, Preguntas abiertas 12).
  - Microcopy meta: `SIN MENSUALIDAD · SIN PERMANENCIA · LAS INSCRIPCIONES GRATIS NO PAGAN NADA`. Nota `*` → `TERMS_NOTE`, 12 px.
- **Derecha: la sala** (`HeroScreen.vue`, isla `client:visible`):
  - `Figure` con `aitk-seminario-sala` **sin recorte** (`aspect-ratio: 1024 / 688`, para que el overlay calce) y leyenda `Fig. 01 — Expositor y audiencia en una sala de conferencias.`
  - **La pantalla proyecta láminas:** sobre el telón en blanco de la foto (rectángulo `screenRect` en fracciones de la imagen, valor inicial `{ x: .523, y: .006, w: .457, h: .496 }`, **verificar a ojo** y guardarlo junto a la foto en `seminariosLanding.js`; cada foto real trae el suyo) se posiciona una `Slide` con `opacity: .94` y un brillo interior suave (`box-shadow: inset 0 0 40px rgba(255,255,255,.6)`), sin pie en esta versión. Tres láminas que avanzan cada 6 s solo mientras se ven:
    1. **`PROGRAMA · DÍA 1`** — `09:00 Bienvenida` · `09:15 Keynote · Paula Ríos` · `10:30 Café` (mini `ProgramGrid`, la fila del keynote elegida).
    2. **`INSCRITOS`** — `248 de 260 · ejemplo` en cifra grande y una barra apilada por tipo (`Pase completo`, `Solo día 1`, `Solo día 2`, `Estudiante`) con su leyenda.
    3. **`ACREDITACIÓN`** — `214 / 272 entradas validadas` (texto real del contador) y `08:47 · Mesa 2` en meta.
  - Controles bajo la foto (meta): `‹` `1 / 3` `›` y `Pausa` / `Seguir` (WCAG 2.2.2). Un **puntero** (punto de 10 px `--se-proyector` con halo) se mueve a la cifra de cada lámina al entrar (decorativo, `aria-hidden`).
  - **Credencial colgante** (`Credential`, `swing`) pegada al borde inferior izquierdo de la foto, colgando de un cordón que sale por arriba de la foto: `ASISTENTE` · **Carolina Muñoz** · `Empresa ejemplo` · `JORNADA EQUIPOS 2026 · DÍA 1`.
- Datos de ejemplo para todo el sitio (`seminariosLanding.js`, en el frontmatter; la página es `prerender`): **Jornada Equipos 2026**, Día 1 = el **jueves** que cae al menos 35 días después del build (hora de Chile, `EVENT_TIMEZONE`) de 09:00 a 18:00, Día 2 = el viernes siguiente de 09:00 a 13:30, "Centro de eventos en Providencia".
- **Mobile:** eyebrow, H1, bajada, CTAs a ancho completo; la foto recortada 4:3 (`object-position: 60% 30%`) **sin overlay**; debajo, las láminas como un carrusel de `Slide` a ancho completo con `scroll-snap` (sin auto-avance); la credencial a 200 px a la derecha de los CTA, sin balanceo.

### 4.2 Para quién (papel, `SALA 1 · PARA QUIÉN →`, ancla `#para-quien`)
- H2 **Charla, seminario o congreso.** / énfasis **Un solo lugar para inscribir.**
- Bajada: *Desde una charla gratis un martes en la tarde hasta un congreso de dos días con quinientas personas.*
- **Seis fichas** en grid 3×2 (1 columna mobile), separadas por filetes como un índice de programa; cada una con su pictograma en un cuadrado de señalética (grafito con ícono blanco), título Archivo 700 y una línea:
  1. `mic` · **Charlas abiertas** — Una fecha, inscripción gratis con nombre y correo, y un cupo que se cierra solo.
  2. `presentation` · **Seminarios de un día** — Entrada general y estudiante, el café en la descripción y la acreditación a primera hora.
  3. `calendar-range` · **Congresos de varios días** — Cada día es una función (hasta `{MAX_EVENT_FUNCTIONS}`), con pase completo o entrada por día.
  4. `list-ordered` · **Ciclos de charlas** — Una charla al mes, cada una con su cupo y su inscripción. Duplicas la anterior y cambias la fecha.
  5. `building-2` · **Jornadas de empresa o gremio** — Un evento privado, solo con el link, para tus socios o tu equipo.
  6. `graduation-cap` · **Encuentros académicos** — Colegios profesionales, universidades y fundaciones: socios con código de convenio y estudiantes con su propia entrada.
- Fila final de enlaces meta: *¿Clases prácticas con grupos chicos?* `Talleres →` (`/ticketera-talleres`) · *¿La muestra de fin de año?* `Academias →` (`/academias`).

### 4.3 El programa (firma 1, blanco, `SALA 2 · EL PROGRAMA →`, ancla `#programa`)
- H2 **Un congreso de dos días,** / énfasis **un solo evento.**
- Bajada: *Elige el formato y decide qué entrada vale qué día. A la derecha ves cómo queda en tu panel y lo que ve tu público, con los rótulos de la página real.*
- **Layout desktop** (`ProgramBuilder.vue`, card blanca con filete y etiqueta meta `ejemplo`), grid `7fr 5fr`:
  - **Izquierda, arriba:** segmented `Charla` · `Seminario de un día` · `Congreso de dos días` (default: congreso) y segmented `Con entrada` / `Inscripción gratis`.
  - **Izquierda, el programa** (`ProgramGrid`, una columna por día con su fecha en meta `JUE {d1}` / `VIE {d2}`; bloques de ejemplo fijos por formato en `seminariosLanding.js`):
    - Charla: `19:00 Recepción` · `19:15 Cómo medir lo que aprende un equipo · Paula Ríos` · `20:15 Preguntas`.
    - Seminario: `08:30 Acreditación` · `09:00 Bienvenida` · `09:15 Keynote · Paula Ríos` · `10:30 Café` · `11:00 Panel: equipos híbridos · Tomás Vidal, Fernanda Lagos` · `12:30 Cierre`.
    - Congreso: Día 1 igual al seminario hasta `12:30 Almuerzo` + `14:00 Sesiones de la tarde` · `17:30 Cierre del día`; Día 2 `09:00 Keynote · Diego Mardones` · `10:30 Café` · `11:00 Panel de cierre` · `13:00 Conclusiones`.
    - Al cambiar de formato, los bloques entran y salen con FLIP (C7). Al pasar o enfocar un bloque, el puntero (C6) lo marca. No se editan los textos (es una muestra).
  - **Izquierda, abajo: la matriz de acceso** (`AccessMatrix`, una `<table>` real): filas = tipos de entrada, columnas = `Día 1`, `Día 2` y `Todos los días`; en cada fila hay **un** radio por columna (la regla del producto: *una entrada sirve para un día o para todos*). Filas por formato:
    - Congreso con entrada: `Pase completo · $60.000 · 120` (Todos), `Solo día 1 · $40.000 · 60` (Día 1), `Solo día 2 · $30.000 · 40` (Día 2), `Estudiante · $25.000 · 40` (Todos). Toggle `+ Entrada estudiante` la quita o la agrega.
    - Seminario con entrada: `General · $35.000 · 150`, `Estudiante · $15.000 · 40` (una sola columna: `Día 1`).
    - Charla con entrada: `General · $8.000 · 120`. Con `Inscripción gratis`, en cualquier formato: `Inscripción · Gratis · 120` (y en congreso, `Inscripción · Gratis` para todos los días).
    - Bajo la tabla, en meta: *Una entrada sirve para un día o para todos. El pase completo se acredita una vez, el primer día que la persona llega.* + chip `Ingreso cada día con el mismo pase` + **Pronto**.
  - **Derecha, "En tu panel"** (lista meta con filetes): `1 evento` · `{n} funciones` con fecha y horario de cada una · `{n} tipos de entrada` con su función (`Día 1`, `Día 2` o `Todas las funciones`) · `Aforo {suma de cupos}`. Línea: *Lo de cada día queda disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina; el pase completo, `{PAYOUT_RELEASE_HOURS}` h después del último día\*.* (texto de `seminariosLanding.js`, ver §0.3).
  - **Derecha, "Lo que ve tu público"** (`BuyerCardPreview`, card blanca que imita la card de acción **con `cardLabel` real**): congreso → rótulo `2 funciones`, chips `jue {d1}` / `vie {d2}` y botón `Elegir entradas`; seminario o charla con entrada → precio + `{SERVICE_FEE_NOTE}` y `Comprar entrada`; gratis → `Gratis` (o `Gratis · Quedan 12 cupos` con el toggle `Casi lleno`) y el formulario `Nombre` / `Correo` / `Confirmar asistencia` (deshabilitado, `aria-hidden`). Al elegir en la matriz una fila, la vista muestra la fila del checkout con `Disponible desde el …` si la fila tiene preventa (ver toggle).
  - **Derecha, "La agenda"** (debajo): un extracto de la **descripción** con el programa como texto (`h3` por día, lista por bloque) y la nota: *El programa va en la descripción, con títulos y listas. El asistente de tu página lo usa para responder "¿a qué hora es el panel?".* + chip `Agenda con expositores y salas` + **Pronto**.
  - Toggle extra (solo con entrada): `Preventa hasta el {fecha}` → agrega `Preventa · $50.000 · 50` (Todos) y en la vista del público la fila `General` aparece `Disponible desde el {formatSaleStart(cierre de preventa)}`. Nota meta: *La fecha de inicio y cierre de cada entrada se programa hoy desde tu asistente de IA o escribiéndonos por WhatsApp.*
- **Foto** al lado del título (desktop, columnas 9–12 sobre la card, 4:5, 260 px): `aitk-seminario-organizadora` con `Fig. 02 — La organizadora repasa el programa antes de abrir.`
- **Mobile:** segmented en scroll horizontal; el programa por día en pestañas (`Día 1` / `Día 2`); la matriz pasa a **una card por tipo de entrada** con un segmented `Día 1 · Día 2 · Todos`; "En tu panel" y "Lo que ve tu público" debajo, colapsables (`<details>` abiertos por defecto el segundo); la foto se omite.
- **Accesibilidad:** la matriz es una tabla con `<caption>` visible ("Qué entrada vale qué día") y radios con `aria-label` ("Pase completo: todos los días"); los cambios se anuncian con `useDelayedAnnouncement` ("2 funciones, 4 tipos de entrada, aforo 260"). **Sin JS:** se ve el congreso por defecto, la matriz como tabla de solo lectura con ✓ y la card de ejemplo.

### 4.4 Empresas (papel-2, `SALA 3 · EMPRESAS →`, ancla `#empresas`)
- H2 **La empresa compra para su equipo.** / énfasis **Cada uno llega con su QR.**
- Texto: *Recursos humanos compra diez entradas en una sola compra y reenvía a cada persona la suya. Los socios del colegio pagan con su código de convenio, los estudiantes con su entrada y tus expositores llegan con una cortesía a su nombre.*
- **Izquierda: "Una compra, ocho personas"** (`TeamOrder.vue`, isla `client:visible`, card blanca con filete, `ejemplo`):
  - Cabecera: `Comprador: Marcela Ortiz · Personas y Cultura` · `8 × Pase completo` · `Total pagado {buyerPays × 8}` (con `priceQuote(60000)`: **$525.696**).
  - Ocho filas `Entrada 1 de 8 … 8 de 8`, cada una con `Ver QR` (link de ejemplo, no navega) y, en las tres primeras, un nombre de destinatario en meta (`→ Jorge Peña`, `→ Valentina Díaz`, `→ Ignacio Rojas`) como "reenviada por correo".
  - Toggle `Poner cada entrada a nombre de su titular`: la fila 2 se despliega con `Valentina Díaz · valentina@empresa-ejemplo.cl` → `QR nuevo enviado. El anterior deja de servir.` y en meta *Lo hace tu equipo desde tu asistente de IA.* Abajo: chip `Que la empresa escriba el nombre de cada asistente al comprar` + **Pronto**.
  - Nota meta: *Hasta `{DEFAULT_MAX_PER_PURCHASE}` entradas por compra si no lo cambias; se sube hasta 50 desde tu asistente de IA.*
- **Derecha: seis ítems** (pictograma en cuadrado de señalética + título Archivo 700 + texto):
  1. `id-card` **Un precio para cada público.** General, estudiante, socio o pase completo, cada uno con su precio y su cupo. En la acreditación, tu equipo ve qué entrada trae cada persona y pide la credencial de estudiante.
  2. `ticket-percent` **Convenios con código.** Un código para cada colegio profesional, universidad o empresa con convenio: porcentaje o monto, usos máximos, límite por persona y fecha de término. Puede servir para este evento o para todos los tuyos. *Ejemplo:* `COLEGIO20` en un pase de $60.000 → el socio paga **$52.570** con el cargo incluido (`computeDiscountedTotals`, `ejemplo`).
  3. `badge-check` **Expositores, auspiciadores y prensa.** Cortesías a su nombre desde tu panel, hasta `{MAX_COURTESY_PER_REQUEST}` por envío. Les llega su QR, se acreditan como cualquier entrada y no cuentan como venta.
  4. `building` **Saben a quién le compran.** Tu página muestra tu razón social y tu RUT, y el sello `Productor verificado` cuando apruebas tu identidad.
  5. `receipt` **Cada compra, con su comprobante.** El cargo por servicio lo documenta AI Tickets con boleta electrónica. El valor de la entrada lo documentas tú, como organizador: si una empresa te pide factura, se la emites con los datos de su compra. *(texto de §0.3; `terms`)* + chip `RUT y razón social de la empresa al comprar` + **Pronto**.
  6. `sheet` **Tu contabilidad, en un CSV.** Exportas las órdenes con comprador, correo, entradas, código de descuento, total pagado, neto para ti y medio de pago.
- **Mobile:** la orden arriba (filas 1–3 visibles + `Ver las 8`), ítems en una columna.

### 4.5 Difusión (papel, `SALA 4 · DIFUSIÓN ↗`, ancla `#difusion`)
- H2 **Tus expositores convocan.** / énfasis **Y sabes cuánto.**
- Bajada: *Cada expositor, auspiciador o institución comparte su propio link. En las métricas del evento ves cuántas visitas e inscripciones trajo cada uno, y cuántas llegaron desde LinkedIn.*
- **Izquierda: "Por dónde llegan"** (`ChannelTable.vue`, dentro de una `Slide` con pie `04 / 12`): tabla con filetes, columnas `Canal` · `Visitas` · `Entradas` · `Ingresos` (`ejemplo`), filas: `ref:paula-rios · Expositora` · `ref:colegio · Convenio` · `LinkedIn · origen de la visita` · `Instagram (bio)` · `ref:invite · Invitar a alguien` · `{DIRECT_CHANNEL}`. Ingresos calculados con los precios del congreso de §4.3 (no a mano). Selector `Por entradas` / `Por ingresos` (reordena con FLIP). Al tocar `ref:paula-rios`, se despliega su link `aitickets.cl/eventos/jornada-equipos-2026?ref=paula-rios` con `Copiar` (copia el texto de ejemplo; toast `Es un ejemplo: crea los tuyos en el panel`).
  - Nota meta bajo la tabla: *La venta se asocia al link cuando la persona compra en la misma visita en que llegó con él.* (`PRODUCER_FAQ`).
- **Derecha, tres cards** (blancas, filete, sin giro):
  - **Instagram, solo.** *Conectas tu Instagram una vez y apruebas la serie. Con la imagen y los datos de tu evento armamos historias con cuenta regresiva, diarias la última semana, y un post diario esa semana. A quien responde `{DEFAULT_KEYWORD}` le llega el link por DM.* Mockup: tres historias 9:16 de 120×213 con el texto real de `pieceText` (frontmatter) sobre un recorte vertical de `aitk-seminario-sala`: `Faltan 10 días`, `Faltan 3 días` (con `Quedan N entradas` solo si cumple `scarcity_threshold_pct`, lo verifica el test), `Mañana`. Chips: `● Instagram` · `Facebook` + Pronto · `TikTok` + Pronto · `Reels` + Pronto.
  - **LinkedIn.** *Las visitas que llegan desde LinkedIn aparecen como canal propio en tus métricas, y tu página trae el botón para compartir en LinkedIn. Pide a tus expositores que publiquen su link.* + chip `Publicar en LinkedIn desde tu panel` + **Pronto**.
  - **Anuncios** (`SeminarAdsDemo.vue`, piel nueva sobre `useAdsDemo`, misma matemática que las otras): badge meta `QUEDAN 38 · FALTAN 9 DÍAS`; H3 **¿Faltan inscritos? Impúlsalo.**; texto: *Lanza un anuncio en Instagram y Facebook desde tu panel, para tu ciudad y desde los `{AD_LIMITS.defaultAgeMin}` años. Defines cuánto invertir por día y por cuántos días, y lo pausas cuando quieras. Meta cobra el gasto directo en tu cuenta publicitaria y ves cuántas entradas vendió cada anuncio.* Slider `Presupuesto diario` ($3.000–$50.000, default $8.000), slider `Días` (1–7; nota `hasta {AD_LIMITS.maxDays} días`), chips `Santiago · 25 km` · `{defaultAgeMin}–65 años` · `Recursos humanos` + Pronto (deshabilitado). Botón `Impulsar · {total} en total` → `✓ Anuncio activo · {días} días` + `Pausar`. **Sin alcance ni resultados estimados.**
- Links meta: `Guía: cómo medir ventas por promotor →` (`/guias/como-medir-ventas-por-promotor`) · `Ventas por promotor →` (`/ventas-por-promotor`).
- **Mobile:** la tabla con 3 columnas (`Canal`, `Entradas`, `Ingresos`; `Visitas` en la fila desplegada), las cards apiladas, historias en scroll horizontal, anuncios con un solo slider (`Días` fijo en 3).

### 4.6 Antes del día (papel-2, `CAFÉ · ANTES DEL DÍA →`, ancla `#pagina`)
- H2 **Las dudas se responden solas.** / énfasis **Tú sigues con el programa.**
- **Izquierda: la página del evento** en un teléfono (300×600, marco grafito radio 36; mockup decorativo, no copia exacta): imagen del evento, título, rótulo `2 funciones`, `Organiza: Red de Gestión SpA (ejemplo) · RUT 76.000.000-0` (RUT ficticio y evidente, ver Preguntas abiertas 18) con `✓ Productor verificado`, el programa en la descripción y, abajo, una burbuja del asistente: pregunta *"¿Hay estacionamiento?"* → respuesta *"Sí, el centro de eventos tiene estacionamiento pagado en el subterráneo."* con la etiqueta meta `responde con lo que cargaste`.
- **Derecha: "Quiénes van"** (`SeminarWall.vue`, piel sobre `useWallDemo`; mismos `FEED_EMOJIS` y `FEED_MESSAGE_MAX`; demo local que no publica): encabezado meta `LO VEN SOLO QUIENES TIENEN ENTRADA`; mensajes de ejemplo como tarjetas de presentación (nombre en Archivo 700, cargo en meta): *"Vamos 4 del área de Personas. ¿Alguien más de Concepción?"* — `Camila R.`, *"Primera vez en la jornada. Nos vemos en el café."* — `Felipe A.`, *"Llevo preguntas para el panel de cierre."* — `Rocío M.`
- **Foto:** `aitk-seminario-networking` (4:5, 280 px) con `Fig. 03 — Conversaciones en el café.`
- **Seis ítems** (dos columnas):
  1. **Un asistente que responde.** El horario del panel, el estacionamiento o el dress code, con la información que cargaste. Las preguntas frecuentes las generas con IA desde tu panel.
  2. **Recordatorio el día antes.** Sale solo, con fecha, hora, lugar y el link a la entrada. Al pase completo le llega antes del primer día; para el segundo, programas uno desde tu asistente de IA.
  3. **Mensajes a tus inscritos.** El link de la transmisión, el cambio de sala o las presentaciones: a todos o solo a quienes no han llegado, ahora o programado, desde tu asistente de IA.
  4. **Al calendario de cada uno.** Tu página trae `Añadir al calendario` con la fecha elegida.
  5. **Privado si es interno.** Un evento privado no aparece en la cartelera ni en buscadores: solo entra quien tiene el link. Antes de publicar, compartes una vista previa privada con tu comité o tus auspiciadores.
  6. **Cuando se llena.** La página ofrece dejar el correo para avisar si se libera un cupo. + chip `Ver la lista de espera y avisarles` + **Pronto**.
- **Mobile:** teléfono a 240×480, muro compacto debajo (como `WallDemo` en `compact`), foto omitida, ítems en una columna.

### 4.7 Mesa de acreditación (firma 2, turquesa `--se-cordon-ink`, `HALL · ACREDITACIÓN ↓`, ancla `#acreditacion`)
- Única sección turquesa (`.se-on-dark`). El rótulo de sala usa el cuadrado blanco y la flecha en grafito.
- H2 (blanco) **08:30, el hall lleno.** / énfasis (blanco al 80%, Condensed) **La fila avanza con el celular.**
- Bajada: *Tu equipo acredita desde su teléfono, en varias mesas a la vez. Antes de abrir, cada celular descarga la lista: si el wifi del hotel se cae, sigue acreditando y se sincroniza cuando vuelve.*
- **Centro: la mesa** (`AccreditationDesk.vue`, isla `client:visible`), grid `1fr 300px 1fr` en desktop:
  - **Arriba, colgando del borde de la sección:** la **credencial** (`Credential`) con el cordón que baja desde el rótulo; cambia con cada caso.
  - **Escáner** (teléfono 300×600, interfaz de puerta en tonos claros): arriba `Mesa 2` y el contador real `{n} / 272 entradas validadas`; chip meta `Sin conexión · 2 por sincronizar` en el caso 2 y 3. Botón `Acreditar siguiente` que recorre cinco casos con los **textos reales** (§0.4):
    1. **Carolina Muñoz** · `Solo día 1` → `✅ Entrada validada con éxito para Carolina Muñoz` (banner lima). Credencial `ASISTENTE`.
    2. **Diego Fuentes** · `Estudiante` → `✅ … para Diego Fuentes (pendiente de sincronizar)` + nota meta *Pide la credencial de estudiante.* Credencial `ESTUDIANTE` (rayas).
    3. **Andrea Soto** · `Solo día 2`, escaneada el Día 1 → aviso amarillo del producto `⚠️ Esta entrada es para otra función: vie {d2} 09:00. Puedes validarla de todas formas si corresponde.` con dos botones `Validar igual` / `Cancelar`; `Validar igual` → `✅ … para Andrea Soto (pendiente de sincronizar) · Ojo: entrada para vie {d2} 09:00`.
    4. **Rodrigo Pérez** no trae su QR → la vista abre `▼ Buscar asistente (validación manual / reenviar entradas)`, el campo `Buscar por nombre o correo...` escribe `Rodrigo` solo (animado) y aparece la fila con `Validar` y `Reenviar` → `✅ Entrada validada manualmente para Rodrigo Pérez`.
    5. **Paula Ríos** · `Cortesía` → `✅ … para Paula Ríos`. Credencial `EXPOSITORA` (banda grafito).
    - Después del 5, `↻ Otra vez`. El contador sube con cada válida. `aria-live="polite"` con el resultado. **Sin JS:** se ven los cinco casos como lista (`<ol>`) con su texto.
  - **Izquierda: tres mesas** (columna de meta, filetes blancos al 30%): `Mesa 1 · 71`, `Mesa 2 · 68`, `Mesa 3 · 75` (suma con el contador; la mesa 2 sube con la demo) y una **fila** dibujada con 8 credenciales en miniatura (siluetas 18×26) que se acorta con cada caso.
  - **Derecha: foto** `aitk-seminario-acreditacion` (4:5, 260 px) con `Fig. 04 — Acreditación en el hall.` **Solo staging** (§8): en producción va una foto con celular; si no hay, la columna muestra la lista de ítems y la foto se quita.
- **Siete ítems** bajo la mesa (dos columnas, número en cuadrado blanco con texto turquesa):
  1. **Varias mesas a la vez.** Cada persona de tu equipo entra con el rol Puerta, o con un link de escáner que vence solo (lo creas desde tu asistente de IA). No necesitan tu cuenta.
  2. **Sin wifi, igual.** Cada celular acredita y rechaza lo que ya escaneó; al volver la conexión, se cruza con las demás mesas.
  3. **¿Llegó el día equivocado?** Si la entrada es de otro día, el escáner avisa y tu equipo decide si la deja pasar.
  4. **¿Sin QR?** Se busca por nombre o correo, se acredita a mano o se le reenvía la entrada.
  5. **La mesa ve qué entrada es.** General, estudiante, convenio o cortesía, con el nombre de su titular.
  6. **El pase completo, una vez.** Se acredita el primer día que la persona llega. + chip `Ingreso cada día con el mismo pase` + **Pronto** (`dark`).
  7. **¿Cuántos llegaron de cada tipo?** El contador del escáner te dice cuántos entraron; el detalle por tipo de entrada te lo da tu asistente de IA. + chip `Aforo en vivo en el panel` + **Pronto** (`dark`).
- Chip suelto bajo los ítems: `Imprimir credenciales con nombre` + **Pronto** (`dark`), con la línea meta *Mientras, exportas tus inscritos a CSV para preparar las credenciales con tu plantilla.*
- Nota con `*` (12 px): *Acreditar también cuenta para tu pago: los check-ins acreditan que el evento se realizó, una de las condiciones para liberar lo vendido.* (`ledger.ts`, `TERMS_NOTE`).
- Links meta (blancos): `Guía: check-in con QR →` (`/guias/como-hacer-check-in-con-qr`) · `Entradas con QR →` (`/entradas-con-qr`).
- **Mobile:** credencial arriba (200 px, sin balanceo continuo, solo C12 al cambiar), escáner a 260×520, mesas en una fila de 3 cifras, foto omitida, ítems en una columna.

### 4.8 La cotización (papel, `SALA 5 · PRECIO →`, ancla `#precio`)
- H2 **Tú recibes el 100%** / énfasis **de cada inscripción.**
- Texto (armado como el `priceLead` de stand-up, con constantes): *Para ti, 0% de comisión. Quien compra paga un cargo por servicio de `{SERVICE_FEE_PERCENT_LABEL}` más IVA (`{IVA_PERCENT_LABEL}`) sobre ese cargo. Si prefieres precios redondos, lo absorbes tú, por evento. `{ABSORB_FEE_ACTIVATION}` Las inscripciones gratis y las cortesías no pagan nada.*
- Garantías en meta con `·`: `Sin mensualidad · Sin permanencia · {PAYOUT_SHORT_TEXT}*`.
- **Cotización** (`QuoteCalculator.vue`, usa `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement`; la lógica de filas se comparte con `StageCalculator.vue` de fiestas: extraer `useTicketLines` a `src/composables` como cambio aditivo, sin cambiar el comportamiento de fiestas, igual que `useWallDemo`): documento blanco con filete grafito y radio 4, **con forma de cotización**:
  - Cabecera: `COTIZACIÓN N° 0001 · EJEMPLO` a la izquierda, `Jornada Equipos 2026 · {fecha de build}` a la derecha (meta), filete doble.
  - Tabla de líneas (Archivo `tabular-nums`): `Tipo de entrada` · `Precio` (campo, `parseAmount`, tope `CALC_PRICE.inputMax`) · `Cantidad` (campo, 1 a `CALC_QTY.inputMax`) · `Tu público paga` (por entrada) · `Tú recibes` (subtotal de la línea). Filas por defecto (las del congreso de §4.3): Pase completo $60.000 × 120 · Solo día 1 $40.000 × 60 · Solo día 2 $30.000 × 40 · Estudiante $25.000 × 40. `+ Línea` (hasta 5) y `×` (hasta 1). Una línea fija de cierre en `--se-text-3`: `Cortesías (expositores y prensa) · no son venta · $0`.
  - Segmented `Paga el público` / `Lo absorbo yo`.
  - Pie: desglose de **una** entrada de la línea elegida (`Entrada`, `SERVICE_FEE_LABEL`, `SERVICE_FEE_TAX_LABEL`), `SI SE VENDE TODO, TU PÚBLICO PAGA {Σ}` (meta) y bloque lima **`TÚ RECIBES {Σ priceQuote(precio, payer, cantidad).total}`** (Archivo 800 Expanded 56, grafito).
  - **Verificación** (computeFeeSplit): $60.000 → público $65.712 / tú $60.000; absorbido $54.288. $40.000 → $43.808 / $40.000; absorbido $36.192. $30.000 → $32.856; absorbido $27.144. $25.000 → $27.380; absorbido $22.620. Con las cuatro líneas (260 entradas): **tú recibes $11.800.000** y tu público paga **$12.923.360**; absorbido, **$10.676.640**.
- **Cobro por jornada** (fila con pictograma de reloj, debajo): `{PAYOUT_SCHEDULE_TEXT}*` + *En un congreso, lo de cada día se libera con ese día; lo del pase completo, `{PAYOUT_RELEASE_HOURS}` h después del último día. Ejemplo: Solo día 1 → sáb {d1+2} 18:00; pase completo y Solo día 2 → dom {d2+2} 13:30.* (fechas calculadas en `seminariosLanding.js`: término de cada función + `PAYOUT_RELEASE_HOURS`).
- Nota: `TERMS_NOTE` → `/terminos-productores`.
- **Mobile:** cada línea como card apilada (precio y cantidad en una fila; "Tu público paga" y "Tú recibes" debajo), totales apilados.

### 4.9 Después (papel-2, `SALA 6 · DESPUÉS →`)
- H2 **La encuesta llega sola.** / énfasis **La próxima edición se llena con esta.**
- **Izquierda: "Resultados"** (`SurveyResults.astro` dentro de una `Slide` con pie `11 / 12`, `ejemplo`): distribución de estrellas en barras horizontales con `RATING_LABELS` (`Excelente 61%`, `Muy bueno 27%`, `Bueno 9%`, `Regular 2%`, `Malo 1%`), promedio `4,5` en cifra grande, un comentario público (*"El panel de cierre fue lo mejor. Más tiempo para preguntas."*) y un **mensaje privado** con la etiqueta real `Privado` y candado: *"El audio del fondo de la sala se escuchaba bajo."*
- **Derecha: cinco ítems** (número Archivo 800 turquesa):
  1. **Una encuesta por correo.** Entre `{REVIEW_REQUEST_DELAY_HOURS}` y `{REVIEW_REQUEST_WINDOW_HOURS}` h después de cada jornada les llega un correo para calificar con estrellas, comentar, subir hasta `{MAX_PHOTOS_PER_PERSON}` fotos y dejarte un mensaje privado. Lo ves y lo exportas desde tu panel.
  2. **Las presentaciones, por correo.** Mandas el link a todos los inscritos desde tu asistente de IA.
  3. **Invita a la próxima edición.** A todos, solo a quienes se acreditaron o solo a quienes calificaron con 4 o 5 estrellas. Si quieres, con un código de premio para quien respondió la encuesta.
  4. **La próxima, en un clic.** Duplicas el evento con sus tipos de entrada y sus preguntas frecuentes, subes las fotos a la galería y el domingo te llega por correo cómo vendió la semana.
  5. **Certificados de asistencia.** Con los check-ins de la acreditación. + **Pronto**. *Mientras, tu asistente de IA te da la lista de quienes ingresaron.*
- **Mobile:** la lámina a ancho completo; ítems en una columna.

### 4.10 Testimonio (solo si es real)
- Solo si `SEMINAR_TESTIMONIAL` no es `null`. La cita va **en una lámina** (`Slide` 16:9 en desktop, 4:5 en mobile) en Archivo 500 `wdth 100` 30/42 (21/30 mobile), con comillas de Archivo 800 turquesa de 88 px; a la derecha, una **credencial** con la foto autorizada en lugar del QR, nombre, cargo e institución, banda `ORGANIZADORA`. Pie de la lámina: `Institución · ciudad`.
- Si es `null`, no se renderiza nada (ni el contenedor).

### 4.11 Preguntas frecuentes (papel, `INFORMACIONES · PREGUNTAS ↓`)
`src/data/seminariosFaq.ts`, mismo patrón que `fiestasFaq.ts` (`pick` con error si falta, `reword`). Orden:

| # | Fuente | Pregunta |
|---|---|---|
| 1 | `PRODUCER_FAQ` | ¿Cuánto cuesta usar AI Tickets? |
| 2 | nueva | ¿Cuánto cuesta una charla gratuita? — *Nada. Las inscripciones gratis no pagan cargo por servicio y no hay mensualidad.* |
| 3 | nueva (`terms`) | ¿Cuándo recibo lo recaudado? — `{PAYOUT_SCHEDULE_TEXT}` + *En un congreso, lo de cada día se libera con ese día y lo del pase completo, `{PAYOUT_RELEASE_HOURS}` h después del último día. Acreditar en la puerta cuenta: los check-ins acreditan que el evento se realizó, una de las condiciones para liberar el pago. Para retirar necesitas registrar una cuenta bancaria, que AI Tickets verifica normalmente en 1 día hábil.* (última frase tomada de `PRODUCER_FAQ`, no reescrita) |
| 4 | `PRODUCER_FAQ` | ¿Puedo absorber el cargo por servicio? |
| 5 | nueva | ¿Cómo publico un congreso de varios días? — *Un solo evento con un día por función (hasta `{MAX_EVENT_FUNCTIONS}`), y entradas que sirven para un día o para todos (pase completo). Tu público ve las fechas en la página y elige. El pase completo se acredita una vez, el primer día que la persona llega.* |
| 6 | nueva | ¿Dónde va el programa con los expositores? — *En la descripción del evento, con un título por día y una lista por bloque. El asistente de tu página lo usa para responder preguntas como "¿a qué hora es el panel?". Una sección propia de agenda, con expositores y salas, todavía no existe.* |
| 7 | nueva | ¿Una empresa puede comprar para todo su equipo? — *Sí. Son hasta `{DEFAULT_MAX_PER_PURCHASE}` entradas por compra si no lo cambias (se sube hasta 50 desde tu asistente de IA o escribiéndonos por WhatsApp). Quien compra recibe cada entrada con su link "Ver QR" y se la reenvía a cada persona. Si quieres el nombre de cada asistente en la acreditación, tu equipo pone cada entrada a nombre de su titular desde tu asistente de IA: le llega un QR nuevo y el anterior deja de servir.* |
| 8 | nueva (`terms`) | ¿Pueden pedirme factura? — *El cargo por servicio lo documenta AI Tickets con boleta electrónica. El valor de la entrada lo documentas tú, como organizador: si una empresa necesita factura, se la emites con los datos de su compra. Desde tu panel exportas las órdenes a CSV con comprador, correo, entradas, montos y medio de pago.* (validar, Preguntas abiertas 6) |
| 9 | nueva | ¿Puedo tener precio de socio o de convenio? — *Sí, con un código de descuento por institución: porcentaje o monto, usos máximos, límite por persona y fecha de término. Puede servir para un evento o para todos los tuyos, y se aplica al total de la compra.* |
| 10 | nueva | ¿Cómo funciona la entrada estudiante? — *Es un tipo de entrada con su precio y su cupo. AI Tickets no verifica al comprar que la persona sea estudiante: en la acreditación tu equipo ve el tipo de entrada al escanearla y pide la credencial.* |
| 11 | nueva | ¿Cómo acredito a expositores, auspiciadores y prensa? — *Con cortesías desde tu panel: tipo de entrada, nombre y correo, hasta `{MAX_COURTESY_PER_REQUEST}` por envío. Les llega su QR, se acreditan como cualquier entrada y no cuentan como venta.* |
| 12 | nueva | ¿Qué pasa si se cae el wifi del lugar? — *Antes de abrir, el escáner descarga la lista de entradas. Si se cae la conexión, cada celular sigue acreditando y rechaza lo que él ya escaneó; al volver, se sincroniza con los demás. Si alguien no trae su QR, se busca por nombre o correo y se acredita a mano o se le reenvía la entrada.* |
| 13 | nueva | ¿Entregan certificado de asistencia? — *Todavía no: está en camino. Hoy tu asistente de IA te da la lista de quienes ingresaron, con su hora, para que emitas los certificados.* |
| 14 | nueva | ¿Puedo hacer un evento solo para mi empresa o mis socios? — *Sí. Un evento privado no aparece en la cartelera de AI Tickets ni en buscadores: solo entra quien tiene el link. Antes de publicarlo, puedes compartir una vista previa privada con tu comité o tus auspiciadores.* |
| 15 | nueva | ¿Sirve para una charla online o híbrida? — *AI Tickets inscribe y acredita eventos presenciales; no transmite. Si tu charla tiene transmisión, mandas el link a tus inscritos por correo desde tu asistente de IA.* (Preguntas abiertas 15) |
| 16 | nueva (`terms`) | ¿Sirve para un congreso grande? — (mismo texto de la FAQ 11 de fiestas / 13 de música, con "congreso") *Sí. Si el aforo pasa de `{LARGE_CAPACITY}` personas o es un evento masivo, te pedimos el permiso del lugar y una póliza de responsabilidad civil (y, si es masivo, la autorización de la Delegación Presidencial). Según el riesgo del evento, entre el `{RESERVE_BY_LEVEL.medium}`% y el `{RESERVE_BY_LEVEL.high}`% de lo vendido puede quedar como reserva hasta `{RESERVE_HOLD_DAYS}` días después del evento.* |
| 17 | `ORGANIZADORES_FAQ` | ¿Cómo funciona la publicación automática en redes? |
| 18 | `ORGANIZADORES_FAQ` reformulada | ¿Cómo funciona la encuesta después del evento? (respuesta de "¿Cómo funcionan las reseñas?" + *Además de las estrellas y el comentario, cada persona puede dejarte un mensaje privado que solo ves tú.*) |
| 19 | `PRODUCER_FAQ` | ¿Qué pasa si tengo que cambiar o cancelar una función? (`terms`) |
| 20 | `PRODUCER_FAQ` | ¿Me ayudan a publicar mi primer evento? |

- Estilo: `LandingFaq` con los tokens puente; pregunta en Archivo 700 `wdth 100`; el `+` es un cuadrado de señalética grafito 32×32 con `+` blanco que pasa a `−` (sin giro).

### 4.12 Cierre (auditorio)
- **La última lámina:** la sección es la sala a oscuras; al centro, una `Slide` grande (máx. 960 px, 16:9 en desktop, 4:5 en mobile) "proyectada" (blanco al 96% con halo `0 0 120px rgba(79,209,197,.18)`), con pie `12 / 12`.
- Dentro de la lámina, H2 (`SeminarHeading`, grafito, 80 / 40 mobile) **Tu próximo seminario,** / énfasis **con inscripciones abiertas hoy.**
- Bajada (en la lámina): *Crear tu cuenta es gratis y no hay costos fijos. Si quieres, armamos el primero contigo.*
- CTAs (en la lámina): botón grafito `Publicar mi seminario →` (`publishUrl("seminarios_closing")`) · contorno `Hablar por WhatsApp` · link `Agenda una demo de 15 min` (mismos destinos que stand-up y fiestas).
- Bajo la lámina, en meta `--se-text-dark-3`: *También para* `talleres` · `academias` · `teatro` (links).

### 4.13 Footer
`AppFooter tone="dark"`. En "Para quién" se agrega `{ href: "/ticketera-seminarios", label: "Seminarios" }` después de `Talleres` (cambio aditivo en `AppFooter.vue`, anotar en el PR). En talleres, el link que pedía su spec: `¿Charlas o seminarios? Mira la página para seminarios →` junto al de academias en `WorkshopHero.astro` (aditivo).

---

## 5. Mobile

- Ancho base 390; gutter 20 px; secciones 72 px de padding vertical (desktop 128). Grilla de 4 columnas. Los rótulos de sala van al ancho del contenido (no a sangre): sin riesgo de scroll horizontal.
- Orden igual al desktop. Cambios: el hero sin overlay en la foto y las láminas en carrusel; fichas de formatos en una columna; el programa por pestañas de día y la matriz como cards con segmented; la orden de empresa con 3 filas visibles; la tabla de canales con 3 columnas; teléfono y muro compactos; la mesa de acreditación con la credencial arriba y el escáner debajo; la cotización en cards apiladas; la lámina de resultados a ancho completo; la última lámina en 4:5.
- Objetivos táctiles ≥ 44×44 (radios de la matriz con área de 44, filas de la tabla de canales ≥ 48 de alto). Nada de hover como única forma de ver información: el puntero es decorativo y las láminas tienen botones.
- `LandingMobileBar` en píldora clara aparece después del hero y se oculta al llegar al cierre.

---

## 6. Animaciones (todas con `prefers-reduced-motion`)

Solo `transform`, `opacity` y `clip-path`. Con `prefers-reduced-motion: reduce` todo queda en su estado final: sin balanceo de la credencial, láminas **sin auto-avance** (solo con botones), sin puntero, la credencial cambia sin "impresión", los bloques del programa cambian sin FLIP, el campo de búsqueda del caso 4 aparece ya escrito. Reveals genéricos con `LandingMotion` (`data-lp-reveal` / `data-lp-step`).

| # | Elemento | Animación |
|---|---|---|
| C1 | Hero | H1: la primera línea sube (`translateY 24px`, 500 ms); la de énfasis entra **ensanchándose**: `transform: scaleX(.86)→1` desde la izquierda + `opacity`, 520 ms, delay 200 ms (simula el cambio de ancho sin animar `font-stretch`) |
| C2 | Foto del hero | Revelado `clip-path: inset(0 0 0 100%) → inset(0)` (700 ms, `cubic-bezier(.2,.8,.2,1)`); después la pantalla **se enciende**: la primera lámina `opacity 0→.94` con un parpadeo corto (`.94→.6→.94`, 240 ms) |
| C3 | Láminas del hero | Avanzan cada 6 s solo en viewport y sin hover/foco: la saliente `translateX(-4%)` + `opacity` 0, la entrante desde `4%` (360 ms); barra de progreso de 2 px bajo los controles (`scaleX` lineal 6 s) |
| C4 | Credencial (hero y hall) | **Péndulo amortiguado** desde el clip: `rotate 4°→-3°→2°→-1°→0°` (1,6 s) al entrar en viewport y al cambiar de caso; en scroll rápido, un empujón de ±2° (como máximo una vez cada 800 ms). `transform-origin` en el clip |
| C5 | Rótulos de sala | Al 30% de visibilidad la barra entra con `clip-path: inset(0 100% 0 0) → inset(0)` (420 ms) y la flecha avanza 6 px y vuelve (240 ms) |
| C6 | Puntero | Punto turquesa que se desplaza a la cifra o bloque elegido (`translate`, 500 ms, `ease-out`) con halo que late 2 veces (`scale 1→1.6`, `opacity .5→0`) |
| C7 | Programa | Cambio de formato: bloques con FLIP (320 ms); nuevos con `opacity` + `translateY 8px`; la fila elegida de la matriz pinta su fondo con `clip-path` de izquierda a derecha (200 ms) |
| C8 | "Lo que ve tu público" | El rótulo de la card cambia con un deslizamiento vertical de 12 px (como en la página real, `ev-motion`) |
| C9 | Orden de empresa | Filas entran con stagger 50 ms; al poner a nombre del titular, la fila se despliega (`grid-template-rows` no: `clip-path` + `translateY`) y el QR viejo se tacha con un filete que crece (`scaleX`) |
| C10 | Tabla de canales | Barras de entradas `scaleX 0→valor` (700 ms, stagger 80 ms); reordenar con FLIP 320 ms |
| C11 | Escáner | El banner de resultado baja (`translateY -12px→0`, 200 ms); el aviso de otra función entra con un borde que se dibuja; el contador sube sin interpolar |
| C12 | Credencial en la mesa | **Se imprime**: la tarjeta nueva entra con `clip-path: inset(0 0 100% 0) → inset(0)` (450 ms, de arriba abajo) y luego C4 |
| C13 | Fila de acreditación | La primera silueta sale hacia la mesa (`translateX` + `opacity`, 300 ms) y las demás avanzan un lugar (FLIP) |
| C14 | Cotización | Montos interpolan 250 ms (opcional); una línea nueva entra con `clip-path` horizontal |
| C15 | Resultados de la encuesta | Barras `scaleX` con stagger 90 ms; el promedio cuenta de 0 a 4,5 (800 ms) |
| C16 | Pantalla del header | El texto de `AHORA` / `A CONTINUACIÓN` cambia con un deslizamiento vertical de 8 px (180 ms); el filete de progreso es estado (`scaleX`, sin transición) |
| C17 | Cierre | La sala se oscurece al entrar (overlay `opacity .4→0` sobre el auditorio) y la lámina se enciende como C2 |

---

## 7. Rendimiento

- **LCP = foto del hero** (`aitk-seminario-sala`, 1024×688): AVIF/WebP a 640 y 1024 con sharp, como las demás (la real debe venir a ≥ 2400 px y entonces se suma 1344/2048), `fetchpriority="high"`, sin `loading="lazy"`. Las láminas proyectadas son HTML, no imagen.
- Archivo: un solo woff2 `latin` variable con `wght` y `wdth`; `preload` solo en esta página (como Bagel en fiestas). Si pesa más de 90 KB, recortar el rango de `wdth` (62–125) y `wght` (500–800) con un subset propio no está permitido sin aprobación: usar el de Fontsource y medir. Fallback con `size-adjust` (CLS < 0,05).
- Rótulos, credencial, cordón, QR decorativo, puntero y siluetas de la fila son CSS/SVG inline. El QR decorativo es **un** SVG precalculado (no se genera en el cliente). Sin `filter: blur` animado.
- Islas Vue con `client:visible` (`HeroScreen`, `ProgramBuilder`, `TeamOrder`, `ChannelTable`, `SeminarAdsDemo`, `SeminarWall`, `AccreditationDesk`, `QuoteCalculator`) y `client:idle` (`SeminarHeader`, `LandingMobileBar`). El balanceo de la credencial es un script chico en `seminariosLanding.client.js` (IntersectionObserver + un listener de scroll pasivo con `requestAnimationFrame`). La página se lee completa sin JS (estados SSR descritos en cada sección).
- La foto del hero se reutiliza recortada en las historias de §4.5 (mismo archivo, `object-position` distinto).
- Resto de fotos `loading="lazy"`, `srcset`, `aspect-ratio` reservado. Lighthouse móvil ≥ 90 en performance y accesibilidad.

---

## 8. Fotos

**Se reutilizan** (todas en `public/landing/`; generar AVIF/WebP de las que aún no tienen):

| Uso | Archivo | Tratamiento | Variantes |
|---|---|---|---|
| Hero (con la pantalla proyectando), fondo de las historias | `aitk-seminario-sala.jpg` (3:2, 1024 px) | figura sobria + overlay en `screenRect` | 640/1024 (crear) |
| El programa (Fig. 02) | `aitk-seminario-organizadora.jpg` (4:5, 896 px) | figura | 480/896 (crear) |
| Antes del día (Fig. 03) | `aitk-seminario-networking.jpg` (4:5, 896 px) | figura | 480/896 (crear) |
| Acreditación (Fig. 04), **solo staging** | `aitk-seminario-acreditacion.jpg` (4:5, 896 px) | figura | 480/896 (crear) |

No se usan `aitk-puerta-qr`, `aitk-publico`, `aitk-taller*` ni las de otras landings: cada landing con sus fotos. No se generan imágenes nuevas. Reparos de las de referencia: **la de acreditación muestra una pistola lectora de códigos**, y AI Tickets escanea con la cámara del celular (`ValidateQR.vue` no recibe lectores externos), así que es **bloqueante** para producción; los cordones de las fotos son azul marino (no turquesa): no importa, son fotos naturales, pero las reales ideales traen cordones de cualquier color salvo los de marcas reconocibles.

**Fotos reales que harían falta** (con autorización escrita del organizador y, si se reconocen, de expositores y asistentes):
1. **Hero:** sala de seminario desde el fondo con un expositor y **la pantalla del proyector en blanco o con una lámina neutra**, horizontal, ≥ 2400 px, con la pantalla de frente (sin mucha perspectiva) y espacio libre a la izquierda o arriba. Al llegar, medir su `screenRect`.
2. **Acreditación:** una persona del equipo escaneando con **su celular** el QR en el celular de un asistente, con credenciales y cordones sobre la mesa, vertical.
3. Organizadora u organizador con el programa o el notebook antes de abrir, vertical.
4. Café o networking con credenciales visibles (sin logos de empresas ni instituciones reales), vertical.
5. Opcional: expositora o expositor en el escenario con micrófono, vertical (para la credencial `EXPOSITORA` del testimonio).
6. Testimonio: retrato de quien da la cita.

---

## 9. SEO

- **Title** (`landings.ts`): *Ticketera para seminarios y congresos en Chile: inscripciones y acreditación con QR · 0% de comisión | AI Tickets*
- **Description:** *Inscripciones gratis o pagadas con Webpay para seminarios, charlas y congresos: varios días en un evento con pase completo o por día, precio estudiante y de convenio, cortesías para expositores y acreditación con QR desde el celular. 0% de comisión.*
- **H1 visible sin JS** (el del hero). En `landings.ts`: `h1: "Tú armas el programa. La acreditación es un QR."`, `card: { title: "Seminarios y congresos", text: "Varios días en un evento, precios para empresas y estudiantes, y acreditación con QR." }`, `eyebrow: "Para organizadores de seminarios, congresos y charlas"`, `kind: "vertical"`, `sections: []`, `faq`: las propias que no vienen de PRODUCER_FAQ/ORGANIZADORES_FAQ (como talleres y fiestas), `demo: { url: "/eventos/evento-demo-gratis", label: "Ver una inscripción de ejemplo" }` (Preguntas abiertas 12), `cta: { label: "Publicar mi seminario", campaign: "vertical_seminarios" }`, `related: ["entradas-con-qr", "ticketera-talleres", "vender-entradas-online"]`, `dedicated: true`. Cambio aditivo: agregar `"ticketera-seminarios"` a `related` de `ticketera-talleres`.
- **Palabras clave a cubrir en el texto, sin forzar** (búsquedas en Chile): ticketera para seminarios, inscripción a seminarios, inscripciones online para eventos, plataforma de inscripciones, inscripción congreso, venta de entradas congreso, entradas para charlas, charla gratuita inscripción, acreditación de eventos, acreditación con QR, sistema de acreditación para congresos, registro de asistentes, control de asistencia seminario, entradas corporativas, eventos corporativos Chile, jornada, simposio, encuentro, conferencia en Santiago, precio estudiante, código de convenio, colegio profesional, cortesías para expositores, evento privado empresa, ticketera sin comisión. **No** se apunta a "certificado de asistencia" mientras sea `Pronto`.
- **JSON-LD:** `BreadcrumbList` (AI Tickets → Para organizadores → Seminarios y congresos), `SoftwareApplication` con `Offer` armada con constantes (como fiestas) y `FAQPage` con `SEMINARIOS_FAQ`.
- Imagen OG: el hero (`image={SEMINAR_PHOTOS.hero.src}`).
- Links internos: `/organizadores`, `/ticketera-talleres`, `/academias`, `/entradas-con-qr`, `/ventas-por-promotor`, `/vender-entradas-online`, `/web-gratis`, `/guias/como-hacer-check-in-con-qr`, `/guias/como-medir-ventas-por-promotor`, `/ticketeras-en-chile`.
- Sitemap: la URL la arma `landings.ts`.
- Alt de fotos descriptivos: *Expositor hablando frente a una audiencia en una sala de conferencias con vista a la cordillera*, *Organizadora revisando el programa en su notebook detrás del escenario*, *Asistentes conversando con café en la pausa de un seminario*, *Acreditación en el hall: un asistente muestra el QR de su entrada en el celular*.

---

## 10. Analítica

Prefijo `se_`, mismo mecanismo que `PartyTracking.astro` (atributos `data-se-*` + `CtaTracking`):
- `se_view`, `se_cta_click {position}` (`hero`, `closing`, `header`, `mobile_bar`), `se_demo_click {position}`, `se_whatsapp_click`, `se_faq_open {question}`, `se_section_view {section}`.
- Propios: `se_slide {index, via: "auto" | "manual"}` (solo manual se envía; auto no), `se_program_format {format}`, `se_program_mode {mode: "paid" | "free"}`, `se_matrix_change {ticket, scope}` (debounce), `se_program_toggle {option, on}`, `se_team_assign`, `se_channel_sort {by}`, `se_channel_open {channel}`, `se_link_copy`, `se_ads_demo {budget, days}`, `se_wall_react {emoji}`, `se_scan_demo {case}`, `se_calc_change {payer, lines}` (debounce).

---

## 11. Componentes

Carpeta `src/components/landing/seminarios/`; datos y cálculos sin Node en `seminariosLanding.js` (como `fiestasLanding.js`): fotos (`photo()` + `screenRect`), nombre y fechas del evento de ejemplo (jueves ≥ 35 días después, en hora de Chile), formatos con sus bloques y tipos de entrada, `programModel(format, mode, options)` → funciones, tipos con su alcance (una función o todas) y aforo, casos del escáner (con sus textos), canales de ejemplo (ingresos calculados), líneas por defecto de la cotización, horas de liberación (término + `PAYOUT_RELEASE_HOURS`) y el texto de cobro por jornada (comentario que cita `ledger.ts`), resultados de la encuesta. `seminariosLanding.client.js`: balanceo de la credencial y helpers de DOM.

| Componente | Tipo | Notas |
|---|---|---|
| `SeminarHeader.vue` | isla `client:idle` | patrón de `StandupHeader`; pantalla "Ahora / A continuación" + filete de progreso |
| `WayfindingSign.astro` | estático | rótulo de sala: `room`, `label`, `icon`, `arrow`, `tone` |
| `SeminarHeading.astro` | estático | H1/H2 en Archivo Expanded con la línea de énfasis Condensed (prop `emphasis`) |
| `Credential.astro` | estático | credencial: `name`, `org`, `type`, `day`, `photo?`, `swing` |
| `Slide.astro` | estático | lámina 16:9 con pie numerado |
| `Figure.astro` | estático | `<picture>` sobrio con leyenda "Fig." |
| `SeminarHero.astro` | estático + CSS | H1, CTAs, figura, credencial |
| `HeroScreen.vue` | isla `client:visible` | láminas proyectadas en `screenRect`, controles, pausa; SSR con la primera lámina |
| `SeminarFormats.astro` | estático | seis fichas + links a talleres y academias |
| `ProgramBuilder.vue` | isla `client:visible` | firma 1: formato, modo, `ProgramGrid`, `AccessMatrix`, "En tu panel", `BuyerCardPreview` (usa `cardLabel`, `formatSaleStart`, `SERVICE_FEE_NOTE`), agenda; SSR con el congreso y la tabla |
| `SeminarCompanies.astro` | estático | ítems de empresas |
| `TeamOrder.vue` | isla `client:visible` | compra de 8 entradas + poner a nombre del titular |
| `SeminarDiffusion.astro` | estático | historias con `pieceText` (por props), cards |
| `ChannelTable.vue` | isla `client:visible` | tabla de canales, orden, link y copiar |
| `SeminarAdsDemo.vue` | isla `client:visible` | piel nueva sobre `useAdsDemo` |
| `SeminarBefore.astro` | estático | teléfono, ítems |
| `SeminarWall.vue` | isla `client:visible` | piel sobre `useWallDemo` |
| `SeminarAccreditation.astro` | estático | ítems, notas, links |
| `AccreditationDesk.vue` | isla `client:visible` | firma 2: escáner con textos reales, credencial que se imprime, mesas, fila; SSR con la lista de casos |
| `SeminarPrice.astro` | estático | texto de precio + cobro por jornada |
| `QuoteCalculator.vue` | isla `client:visible` | cotización; `useTicketLines` (extraído de `StageCalculator`) + `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement` |
| `SeminarAfter.astro` | estático | resultados (`SurveyResults` en `Slide`) + ítems |
| `SeminarQuote.astro` | estático | no renderiza sin `SEMINAR_TESTIMONIAL` |
| `SeminarClosing.astro` | estático | la última lámina, CTAs |
| `SeminarTracking.astro` | script | eventos `se_*` |

Compartidos sin cambios: `LandingFaq`, `LandingMobileBar` (`variant="pill-light"` con textos), `LandingMotion`, `CtaTracking`, `AppFooter tone="dark"`, `SoonBadge`. Cambios aditivos (anotar en el PR): entrada nueva en `landings.ts` (+ `related` de talleres); `SEMINAR_TESTIMONIAL` en `producerSocialProof.ts`; link en `AppFooter.vue`; link `¿Charlas o seminarios?` en `WorkshopHero.astro`; `useTicketLines` extraído de `StageCalculator.vue` (fiestas lo usa sin cambiar su comportamiento); dependencia `@fontsource-variable/archivo`; fila y commit en `README.md`.

Datos: `landings.ts` (§9), `src/data/seminariosFaq.ts` (§4.11).

Tests (como fiestas): unitario de `seminariosLanding.js` — `programModel`: congreso = 2 funciones, cada tipo con **una** función o todas (nunca dos de tres), aforo = suma de cupos (260), modo gratis = un tipo de precio 0; fechas: Día 1 jueves ≥ 35 días después del build en hora de Chile y Día 2 el viernes siguiente; liberación: Solo día 1 = término día 1 + `PAYOUT_RELEASE_HOURS`, pase completo y Solo día 2 = término día 2 + `PAYOUT_RELEASE_HOURS`; cotización con `priceQuote`: $11.800.000 / $12.923.360 / absorbido $10.676.640; convenio `COLEGIO20` sobre $60.000 con `computeDiscountedTotals` → $52.570; compra de empresa 8 × $60.000 → $525.696; los textos de los casos del escáner aparecen literalmente en `ValidateQR.vue` (lectura del archivo en el test); `cardLabel` del congreso de ejemplo = `2 funciones` y del gratis casi lleno = `Gratis · Quedan 12 cupos`; `Quedan N` de la historia bajo `scarcity_threshold_pct`; `MAX_MESSAGES_PER_EVENT_PER_DAY` espejado calza con `tools/messaging.ts`. E2E de la página: carga, H1 visible sin JS, CTA, consola limpia, FAQ con JSON-LD, cotización $60.000 → $65.712 / $60.000 y total $11.800.000, la matriz no permite dos días sueltos, el escáner llega al aviso de otra función y a la validación manual, `Pronto` presente en lo de §0.7 que se muestra, sin testimonio cuando es `null`, con `prefers-reduced-motion` las láminas no avanzan solas, barra mobile, mobile sin scroll horizontal. Agregar la URL a `tests/e2e/marketing.spec.ts` (H1 y sitemap).

---

## 12. Fases (commits dentro del PR único)

1. **Página y tema:** tema `seminarios`, Archivo variable, rótulos de sala, credencial, láminas, figuras; hero con la primera lámina (sin animación), para quién, programa en su estado inicial + tabla, empresas estático, difusión con historias, antes del día (muro estático), acreditación con la lista de casos, cotización, después, FAQ, cierre, footer; `landings.ts`, `seminariosFaq.ts`, link del footer y de talleres, `related`; fotos de referencia en AVIF/WebP (la de acreditación marcada solo staging). Criterio: `npm run check` sin errores; Lighthouse móvil ≥ 90.
2. **Interacción:** láminas con controles, programa con formatos y matriz, vista del público con rótulos reales, orden de empresa, tabla de canales (orden, link, copiar), anuncios, muro (`useWallDemo`), mesa de acreditación con sus cinco casos, cotización (`useTicketLines`), pantalla del header.
3. **Movimiento:** C1–C17 y `prefers-reduced-motion`; analítica `se_*`; tests.
4. **Contenido real:** fotos reales autorizadas (§8, la de acreditación es bloqueante), `screenRect` de la foto real, testimonio, evento de ejemplo de seminario, nombres de ejemplo revisados.

---

## 13. Preguntas abiertas

1. **URL:** `/ticketera-seminarios` sigue el patrón. Confirmar con Search Console o Keyword Planner si "inscripción seminario", "plataforma de inscripción para eventos" o "acreditación de eventos" tienen más volumen que "ticketera para seminarios"; quizás conviene, más adelante, una página por intención ("acreditación de eventos con QR" como landing de funcionalidad).
2. **"Funciones" en la página pública:** para un congreso, la card dice `2 funciones` y el checkout `Próximas funciones`. ¿Se agrega un rótulo por categoría ("días" o "jornadas" cuando la categoría es `Taller / Charla` o el evento es un congreso)? Toca la página del evento: queda fuera del alcance de esta landing (no se cambia `EventDetail.vue` ni sus componentes).
3. **Ingreso diario con el mismo pase** (`Pronto`): hoy `confirm-ticket` valida una sola vez. Un congreso con control en la puerta cada día necesita validar por función las entradas con `event_date_id = NULL` (requiere migración). ¿Entra al roadmap? Mientras, ¿el escáner podría mostrar la fecha de la primera validación en el `❌ Este ticket ya fue validado` (la respuesta 409 ya trae `validated_at`) para que la mesa entienda que se acreditó ayer?
4. **Agenda con expositores** (`Pronto`): ¿se modela (bloques, expositor con foto, sala) o se queda en la descripción? Si se hace, la página del evento la mostraría y el asistente la leería estructurada.
5. **Datos de cada asistente y de facturación al comprar** (`Pronto`): nombre por entrada, empresa, cargo, RUT y razón social. Es lo que más piden las empresas. ¿Roadmap? Afecta el checkout (fuera del alcance de esta landing).
6. **Factura:** el copy dice que el organizador documenta el valor de la entrada y AI Tickets el cargo con boleta, como `terms.astro` §3, que está **pendiente de validación con abogado y contador**. Confirmar antes de publicar la FAQ 8 y el ítem 5 de §4.4; y si el organizador es persona natural, qué documento corresponde.
7. **Certificados de asistencia** (`Pronto`): ¿se generan desde los check-ins (PDF por correo)? Es un diferenciador fuerte del nicho.
8. **Pago con orden de compra, transferencia o crédito** (no se muestra): muchas empresas e instituciones públicas no pagan con tarjeta. ¿Roadmap o se deriva a WhatsApp?
9. **Descuento por volumen** ("5 o más entradas", no se muestra) y **entradas ocultas solo con código** (precio de socio sin que lo vea el público general, no se muestra): ¿roadmap?
10. **Reserva por riesgo y compras corporativas:** un congreso de un organizador nuevo con aforo > `LARGE_CAPACITY` llega a nivel alto y retendría el `{RESERVE_BY_LEVEL.high}`% hasta `{RESERVE_HOLD_DAYS}` días. Además, la señal `shared_buyer` (`SHARED_BUYER_MIN_EMAILS` correos con un mismo teléfono) puede activarse cuando una persona de RR.HH. compra en varias órdenes para colegas con su teléfono. ¿Se ajusta para compras corporativas o se explica en la landing? Hoy solo está en la FAQ 16 y los términos.
11. **Recordatorio del segundo día para el pase completo:** `send-event-reminders` solo avisa antes de la primera función a quien tiene entrada para todas. ¿Se cambia para eventos de varios días consecutivos? Mientras, la landing dice que el segundo se programa desde el asistente de IA.
12. **Evento de ejemplo:** no hay un seminario demo en `demoEvent.mjs`. El CTA secundario apunta a `/eventos/evento-demo-gratis` ("Ver una inscripción de ejemplo"). ¿Se crea `evento-demo-seminario` (dos funciones jueves y viernes, pase completo, solo día 1, solo día 2, estudiante)? Requiere una migración de datos como las de los otros demos: no se hace sin el visto bueno.
13. **LinkedIn** (`Pronto`): ¿publicar desde el panel está en el plan? (hoy `promote/connect.ts` solo acepta `instagram` y `facebook`; verificar si Zernio admite LinkedIn). Y **segmentar anuncios por profesión o intereses** (`Pronto`): ¿está en el plan?
14. **Credenciales impresas** (`Pronto`): ¿plantilla PDF con nombre, tipo y QR para imprimir antes, o impresión en el lugar? Si no está en el plan, sacar el chip y dejar solo el CSV.
15. **Online e híbrido** (no se muestra): ¿hay interés en una entrada "online" con link de transmisión en el correo? Hoy la FAQ 15 dice que no se transmite.
16. **Escáner con lector externo:** la foto de referencia muestra una pistola lectora. `ValidateQR.vue` solo usa la cámara. ¿Se soporta un lector USB/Bluetooth (modo teclado) en un campo de entrada? Es común en congresos grandes. Hasta entonces, la foto no se publica.
17. **Tabla de identidades:** seminarios toma turquesa del cordón + papel neutro + Archivo con cambio de ancho + señalética + credencial. Si una landing futura (deportes, ferias, festivales) se diseña, mantener la tabla de §1 para que nadie repita turquesa ni Archivo. Confirmar con el dueño la tipografía (alternativas con eje de ancho: Bricolage ya está tomada; "Instrument Sans" tiene `wdth`, revisar acentos).
18. **Nombres de ejemplo:** "Jornada Equipos 2026", "Red de Gestión SpA", "Paula Ríos", "Tomás Vidal", "Fernanda Lagos", "Diego Mardones", "Marcela Ortiz", `COLEGIO20` y el RUT ficticio `76.000.000-0` (elegir uno que no exista o mostrar `RUT 00.000.000-0`): revisar que no coincidan con eventos, empresas o personas reales antes de publicar.
19. **Instagram el día del evento:** la serie publica la historia del día a `event_day_time` (09:00) pero no a menos de `min_hours_before_start` (3 h) del inicio; un seminario de 09:00 no tiene historia ese día. La landing no la muestra; ¿se ajusta la cadencia para eventos de mañana?

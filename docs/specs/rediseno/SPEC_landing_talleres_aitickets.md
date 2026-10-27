# AI Tickets — Landing especializada para talleres y cursos cortos

**Para:** Claude Code (implementación)
**Ruta:** `/ticketera-talleres` (ya existe como landing genérica en `src/data/landings.ts`, generada por `[landing].astro`). **Se mantiene la URL**: la entrada de `landings.ts` pasa a `dedicated: true` y la página propia vive en `src/pages/ticketera-talleres.astro`, igual que `/ticketera-stand-up`, `/ticketera-musica-en-vivo` y `/ticketera-teatro`. La tarjeta, el sitemap, las relacionadas y "Según lo que produces" de `/organizadores` siguen leyendo de `landings.ts`; el footer ya enlaza `Talleres` a esta URL (`AppFooter.vue`).
**Público:** talleristas independientes (cerámica, cocina, fotografía, escritura, ilustración, bordado, carpintería, huerto, yoga y bienestar) y los espacios que programan talleres de varias personas (estudios, centros culturales, cafés, bibliotecas, cowork). Su realidad: **cupos chicos** (6 a 20 por fecha), fechas que se repiten (todos los sábados, un ciclo de 4 sesiones, vacaciones de invierno), inscripción **gratis o pagada** (de $10.000 a $120.000), materiales incluidos, gente que pregunta "¿qué tengo que llevar?" y una lista de espera cuando se llena. Hoy lo resuelven con DM de Instagram, transferencias con pantallazo, un formulario y una planilla.
**Promesa:** *Abre inscripciones con un link. El día del taller, solo enseña.* Cupos por fecha que se cierran solos, pago con Webpay o inscripción gratis, la entrada con QR al correo de cada persona, recordatorio el día antes, la lista de asistentes en el celular y lo de cada fecha disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina.
**Métrica:** visitas → cuentas creadas → primer taller publicado **con cupo definido**, comparada con `/organizadores` y con la landing genérica anterior (mismo slug, antes y después). Secundaria: proporción de talleres gratis vs pagados.
**Prototipo:** no hay artboard. Esta spec define layout, copy y comportamiento; si después se dibuja un prototipo y difiere, manda este documento.
**Reutiliza** de `SPEC_landing_productores_aitickets.md`: fórmula de precio (§5.3), header sticky (§4), accesibilidad (§9), analítica base (§11). De la implementación de stand-up, academias, música y teatro (en el repo): `LandingFaq`, `LandingMobileBar`, `LandingMotion` (`data-lp-reveal` / `data-lp-step`, clase `html.lp-motion`), `CtaTracking`, `ReadingProgress` (prop `color`), `priceQuote` y `formatCLP` (`producerLanding.js`), `usePayerToggle`, `useDelayedAnnouncement`, `SoonBadge`, el patrón `photo()` de `teatroLanding.js`, el patrón `pick`/`reword` de `teatroFaq.ts` y `AppFooter tone="paper"` (el de academias). **Del código del evento** reutiliza `cardLabel` y `formatCLP` de `src/components/event/eventView.js` para que la demo diga exactamente lo que dice la página real. **No reutiliza** su lenguaje visual: nada de serif cursiva (stand-up, academias), nada de Anton, mono, duotono, sellos ni talones (música), nada de Bodoni, arcos, terciopelo ni actos (teatro), nada de mapa de asientos (stand-up), nada de comparador antes/después con toggle (academias), nada de curva ni fader.

---

## 0. Antes de empezar (Claude Code)

1. **Tema propio** `[data-theme="talleres"]` en `src/styles/landing-talleres.css`, con scope y prefijo `tl-`, sin tocar los tokens globales. Debe verse distinto de las otras cuatro landings: ver la tabla de §1.
2. **Dinero y plazos salen del código**, nunca escritos a mano: `SERVICE_FEE_PERCENT_LABEL`, `IVA_PERCENT_LABEL`, `SERVICE_FEE_LABEL`, `SERVICE_FEE_TAX_LABEL`, `SERVICE_FEE_NOTE`, `computeFeeSplit` (netlify/lib/fees.mjs, vía `priceQuote`); `PAYOUT_RELEASE_HOURS`, `PAYOUT_BUSINESS_DAYS`, `PAYOUT_SCHEDULE_TEXT`, `PAYOUT_SHORT_TEXT` (netlify/lib/legal.mjs); `ABSORB_FEE_ACTIVATION`, `MAX_EVENT_FUNCTIONS`, `TERMS_NOTE` y `PRODUCER_FAQ` (src/data/producerFaq.ts); `DEFAULT_MAX_PER_PURCHASE` (Reservation/pricing.js); `REVIEW_REQUEST_DELAY_HOURS`, `REVIEW_REQUEST_WINDOW_HOURS`, `MAX_PHOTOS_PER_PERSON`, `INVITE_AUDIENCES`, `REWARD_CODE_PREFIX` (netlify/lib/reviews.mjs); `DEFAULT_CADENCE`, `DEFAULT_KEYWORD` (src/lib/socialSeriesCadence.ts); `MAX_COURTESY_PER_REQUEST` (src/lib/courtesy.ts). En esta spec los montos aparecen como `{…}` o con su valor actual solo para verificar.
3. **Hallazgos de dinero y plazos que el copy tiene que respetar (manda el código):**
   - **Curso de varias sesiones vendido con una sola entrada** (entrada "para todas las funciones", `event_date_id = NULL`): `src/lib/producer-api/ledger.ts` la libera **con la última función del evento** + `PAYOUT_RELEASE_HOURS`, no con la primera sesión. La página lo dice así en el armador (§4.3) y en la FAQ: *"Lo de un curso completo queda disponible `{PAYOUT_RELEASE_HOURS}` h después de la última sesión"*. La regla no existe como texto en `legal.mjs`: el texto se arma en `talleresLanding.js` con `PAYOUT_RELEASE_HOURS` y un comentario que cita `ledger.ts`. Recomendación de producto que la página sí puede dar: **un evento por curso (o por grupo)**, así "la última función" es la última sesión de ese curso y no la de todo el año.
   - **Condiciones de liberación** (`ledger.ts`): identidad aprobada, cuenta verificada y, por función, check-ins ≥ `CHECKIN_RELEASE_THRESHOLD` (30%) de lo pagado **o** que el productor acredite que se realizó (para abonos, `events.held_attested_at`). La página no las detalla: usa `PAYOUT_SCHEDULE_TEXT` / `PAYOUT_SHORT_TEXT` con `TERMS_NOTE` (igual que teatro). Ver Pregunta abierta 2.
   - **Aforo sumado** (`event-risk.mjs`, mismo hallazgo que teatro, Pregunta abierta 1 de esa spec): un taller semanal de 20 cupos con 52 fechas sumaría 1.040 > `LARGE_CAPACITY`. Con talleres chicos y "un evento por curso" casi nunca aplica, pero no se promete lo contrario.
4. **"Pronto"**: todo lo de §0.6 que se muestre lleva `SoonBadge` (`dark` sobre la pizarra). Nunca se dibuja como si funcionara.
5. **Verificado en el código (se puede prometer):**
   - **Inscripción gratis** en la misma card del evento, sin pasos ni modal (`RsvpForm.vue`): nombre y correo, "Confirmar asistencia", entrada con QR al correo, "Ya estás inscrito" con reenvío (`/api/rsvp/resend`), agregar al calendario (`shareActions.js`). Sin cargo por servicio (`PRODUCER_FAQ`).
   - **Inscripción pagada** con Webpay (`CheckoutSheet.vue`: "Pagar $X con Webpay"); precio final con cargo incluido; cargo absorbible por evento (`ABSORB_FEE_ACTIVATION`: hoy desde el asistente de IA o WhatsApp).
   - **Cupos**: cada tipo de entrada tiene su cupo (`total_quantity`); cuando se llena, deja de venderse. Rótulos reales de la card (`cardLabel`, `stockSummary` en `eventView.js`): gratis → `Gratis`, `Gratis · Quedan N cupos` (cuando quedan ≤ 10 o ≤ 15%), `Gratis · Cupos llenos`; pagado → `Últimas entradas` (mismo umbral), `Agotado`; por función → `Últimas` / `Agotada`. Botones reales: `Confirmar asistencia`, `Comprar entrada`, `Elegir entradas`.
   - **Varias fechas en un evento**: hasta `MAX_EVENT_FUNCTIONS` (60), cada una con fecha, hora y lugar; una entrada puede ir amarrada a una fecha (cupo propio) o servir para todas (cupo compartido) (`EditEventForm.vue`, `schedule.ts`). En la página, el público elige la fecha y luego la entrada (`checkoutFunctions`, `ticketRowsFor`). Si cambias fecha u horario de un evento publicado, se avisa por correo (`PRODUCER_FAQ`).
   - **Lista de espera en la página**: cuando se llena (gratis) o se agota, la página ofrece anotarse con el correo (`RsvpForm.vue` modo `full`, `NotifyForm.vue`, `/api/events/waitlist.ts`, también por función). **Solo registra**: el productor no la ve ni hay aviso automático (§0.6).
   - **Recordatorio automático** por correo el día antes de cada fecha a quienes tienen entrada **para esa fecha**; a quienes tienen una entrada "para todas las funciones", **solo antes de la primera fecha próxima** (`send-event-reminders`). Con fecha, hora, lugar y link a su entrada.
   - **Recordatorios y mensajes extra** a los inscritos (inmediatos o programados, con texto propio: "traigan delantal") y recordatorio de una sesión específica `hours_before` (`tools/messaging.ts`: `send_attendee_message`, `schedule_reminder`, máx. `MAX_MESSAGES_PER_EVENT_PER_DAY` = 5 por día). **Hoy solo desde el asistente de IA conectado** (no hay pantalla en el panel). Llegan a todos los que tienen entrada del evento (o solo a quienes no han ingresado).
   - **Página del asistente** (`/order/<id>`, `attendeePage.ts`): fechas, lugar con mapa, links de calendario y FAQ del evento. Quien tiene una orden pagada con entradas vigentes puede **escribirle a la productora** desde ahí (`/api/orders/message`, `attendee-community.mjs`). *Verificar al implementar que las inscripciones gratis (orden de $0) quedan con `status = 'paid'`; si no, el copy dice "quienes pagaron su inscripción".*
   - **Asistente de la página del evento** que responde con lo que cargó el productor (`EventAssistant.vue`, `netlify/functions/ai-assistant`) y **preguntas frecuentes del evento** generadas con IA desde el panel (`EventFAQManager.vue`, `/api/events/ai`).
   - **Ventana de inscripción** por tipo de entrada (`init_date`/`end_date`, "cerrar inscripciones el día antes"): existe, **hoy se configura desde el asistente de IA** (`tools/tickets.ts`).
   - **Máximo por compra** `DEFAULT_MAX_PER_PURCHASE` (10) por tipo de entrada; se cambia (de 1 a 50) desde el asistente de IA (`max_per_order`) o por WhatsApp.
   - **Códigos de descuento** desde el panel (`DiscountCodesManager.vue`, `discounts.mjs`): % o monto, usos máximos, límite por comprador, inicio y término; aplican a todo el evento (o a todos los de la productora). **No** se limitan a una fecha ni a un tipo de entrada.
   - **Cortesías** desde el panel (`CourtesyTicketsForm.vue`, `courtesy.ts`): nombre, correo, tipo de entrada, hasta `MAX_COURTESY_PER_REQUEST` por envío; QR propio, no cuentan como venta, pueden superar el cupo. Sirven para becas, ayudantes o canjes.
   - **Check-in** con QR desde el celular, sin señal con sincronización, entrada usada no vuelve a entrar ("Entrada ya validada"), contador de validadas, búsqueda por nombre, reenvío al correo, aviso "Esta entrada es para otra función" con opción de validarla igual (`ValidateQR.vue`, `confirm-ticket`, `checkin.mjs`, `/api/orders/resend`). Rol Puerta (`permissions.ts`); link de puerta sin cuenta que vence solo (`/puerta/<token>`, **hoy desde el asistente de IA**, `tools/access.ts`).
   - **Una entrada se valida una sola vez** (`confirm-ticket`: `status = 'validated'`). En un curso vendido con una sola entrada para todas las sesiones, el QR entra en la primera sesión y en las siguientes el escáner dice "Entrada ya validada" (§0.6).
   - **Inscritos en CSV** por evento desde el panel (`/api/events/orders-csv`: nombre, apellido, correo, teléfono, entradas, montos, cortesía, ref/UTM).
   - **Links con seguimiento** por persona, comunidad o campaña y ventas por canal (`TrackingLinkBuilder.vue`, `eventAnalytics.ts`); la venta se asocia si compra en la misma visita (`PRODUCER_FAQ`). Reporte semanal por correo (`weekly-report-send.mjs`).
   - **Instagram automático** (`socialSeries.ts`, `socialSeriesCadence.ts`, `socialSeriesRender.ts`): historias que cuentan hacia la próxima fecha (y siguen con la siguiente cuando una pasa), diarias desde D-`daily_from_days`, "Quedan N entradas" bajo `scarcity_threshold_pct`% disponible (el render dice **"entradas"**, no "cupos": Pregunta abierta 6), DM con el link a quien responde `DEFAULT_KEYWORD`. **Anuncios** en Instagram y Facebook con la cuenta publicitaria de Meta del productor (`zernio-ads.mjs`).
   - **Después del taller**: reseñas por correo entre `REVIEW_REQUEST_DELAY_HOURS` y `REVIEW_REQUEST_WINDOW_HOURS` h después de cada función, con estrellas, comentario y hasta `MAX_PHOTOS_PER_PERSON` fotos; código `{REWARD_CODE_PREFIX}…` para premiar a quien califica (`EventReviewsManager.vue`); **en la página se muestran cuando el evento terminó** (`EventDetail.vue`, `showReviews`). **Invitar a los asistentes a tu próximo taller** con un correo, a `INVITE_AUDIENCES` (`invitations.ts`), desde el panel. **Duplicar** el evento: copia datos, lugares, tipos de entrada y FAQ; no copia las fechas (`eventDuplicate.ts`).
   - **Web gratis** del tallerista o del espacio con su cartelera en `aitickets.cl/o/<slug>` y plantillas `clasico`, `nocturno`, `minimal`, `festival` (`sites.ts`, `/web-gratis`).
   - **Equipo**: roles Administrador, Finanzas, Marketing, Puerta, Solo lectura (`ROLE_LABELS`); limitar a un miembro a ciertos eventos **hoy solo desde el asistente de IA** (`assign_event_staff`).
6. **No existe (no prometer; `Pronto` si se muestra):**
   - **Preguntas al inscribirse** (nivel, edad, alergias, talla, nombre de cada participante): hoy cada inscripción guarda nombre y correo del comprador. `Pronto`.
   - **Pasar lista en cada sesión de un curso** con una sola entrada (asistencia por sesión). `Pronto`.
   - **Ver la lista de espera en el panel y avisar cuando se libera un cupo**: la página registra los correos, nadie los ve. `Pronto`.
   - **Repetir una fecha "todos los sábados por N semanas"** en un paso y **copiar un tipo de entrada a cada fecha** (mismo `Pronto` que teatro).
   - **Reseñas visibles en la página mientras el taller sigue con fechas futuras** (mismo `Pronto` que teatro): en un taller semanal largo, no se verían hasta la última fecha.
   - Facebook, TikTok y reels en la serie automática (`Pronto`, como en las demás).
   - **No se muestran** (ni como `Pronto`): certificados de asistencia, pago en cuotas, pago por transferencia o en efectivo, reparto automático de lo recaudado entre espacio y tallerista, cupo mínimo que cancela solo, clases online con link de videollamada. Van a Preguntas abiertas.
7. **Fotos:** las de `public/landing/` son de referencia generadas con IA. En producción van fotos reales de talleres de talleristas o espacios que usen AI Tickets, con autorización escrita de quien dicta y de quienes aparecen (y de sus apoderados si hay menores). Mientras no existan, se usan las de referencia con el mismo bloqueo de publicación que las otras landings (anotarlo en el PR). Lista en §8. **No se generan imágenes nuevas.**
8. **Testimonio:** solo una cita real (nombre, taller o espacio, ciudad, foto autorizada). Si no hay (`WORKSHOP_TESTIMONIAL = null` en `producerSocialProof.ts`), la sección no se renderiza.
9. **Nombres de ejemplo** (talleres, talleristas, espacios, inscritos): ficticios, y cada card con datos dice `ejemplo`. Antes de publicar, revisar que no coincidan con talleres o espacios chilenos reales (Pregunta abierta 10).
10. Las fases (§12) son commits dentro del PR único del rediseño (ver `README.md`): `rediseno(talleres): landing especializada`.

---

## 1. Sistema visual propio: "cuaderno de taller"

La referencia es la mesa de trabajo de un taller y el cuaderno de quien lo dicta: el **cuaderno de matemáticas de cuadro grande** con su margen, las **fichas** de cartulina donde se anota a cada inscrito, el **destacador amarillo** sobre lo importante, las **notas al margen en lápiz pasta azul** con flechas, las **fotos impresas** sujetas con un clip y la **pizarra** del día de la clase. Es una página **clara, táctil y hecha a mano**, con composición **asimétrica** (texto en el cuaderno, objetos sobre la mesa) y botones que se "aprietan" como cartón. Cada sección es un **separador con pestaña**, como las de un cuaderno.

| | Stand-up | Academias | Música en vivo | Teatro | **Talleres** |
|---|---|---|---|---|---|
| Fondo | negro cálido `#0E0B09` | papel cálido liso `#FBF7F0` | negro frío + papel de afiche + rojo a sangre | azul noche + terciopelo + marfil | **papel de cuaderno frío `#F4F6F1` con cuadrícula azul** + **fichas blancas** + un bloque **pizarra verde `#1F3A30`** |
| Acento | lima + crema | tinta + café serif | rojo de sala | dorado de palco | **azul lápiz pasta `#2547C5`** (notas, flechas, checks, subrayados) + **destacador amarillo `#FFE45C`** (solo detrás de texto); lima solo en acciones |
| Titulares | Unbounded + Fraunces cursiva | Unbounded + Fraunces cursiva | Anton mayúsculas | Bodoni Moda redonda | **Bricolage Grotesque 800** (grotesca "de bricolaje", caja baja y alta); énfasis con **destacador** detrás de las palabras, **nunca cursiva ni color** |
| Notas | — | — | mono (setlist) | Prompt espaciada entre filetes | **Caveat (manuscrita) en azul**, solo para notas al margen y flechas; nunca información que no esté también en texto normal |
| Formas | radios 18–28, pill | radios 24–32 | 0 px, talones | arco de proscenio, filetes | **fichas de 6 px** con renglones; **fotos impresas** con borde blanco, giro ±1,5° y clip; **botones de cartón** (borde 2 px + sombra dura desplazada) |
| Fotos | color cálido con overlay | color con sombra cálida | duotono + grano | viñeta de foco | **color natural**, enmarcadas como copia impresa (sin overlay ni filtro) |
| Ritmo | capítulos alternados | comparador y pasos | cortes duros "01 —" | actos centrados | **separadores con pestaña** (`PENDIENTES`, `TU TALLER`, `ANTES`, `EL DÍA`, `DIFUSIÓN`, `DESPUÉS`, `PRECIO`, `ESPACIOS`, `PREGUNTAS`) sobre un cuaderno con margen |
| Firma interactiva | mapa de sala | antes/después del chat | curva de venta + tandas | cartelera + fader | **"Arma tu taller"**: ficha con formato, cupos y precio que arma en vivo la página de inscripción (con los rótulos reales) + **pasar lista** en la pizarra + **lista de pendientes que se tacha** |

```css
[data-theme="talleres"] {
  --tl-papel: #F4F6F1;            /* fondo principal: papel de cuaderno, levemente frío */
  --tl-papel-2: #ECEFE8;          /* secciones alternas */
  --tl-cuadro: rgba(37, 71, 197, 0.075); /* líneas de la cuadrícula */
  --tl-margen: rgba(214, 92, 100, 0.45); /* línea de margen del cuaderno (decorativa) */
  --tl-ficha: #FFFFFF;            /* fichas y cards */
  --tl-ficha-renglon: rgba(37, 71, 197, 0.14);
  --tl-ficha-borde: #D65C64;      /* línea superior de la ficha (2 px, decorativa) */
  --tl-grafito: #1F2329;          /* texto principal y borde de botones */
  --tl-grafito-2: #424852;
  --tl-grafito-3: #5A616C;        /* meta y eyebrows (≈ 6:1 sobre papel) */
  --tl-line: rgba(31, 35, 41, 0.12);
  --tl-line-strong: rgba(31, 35, 41, 0.22);
  --tl-tinta: #2547C5;            /* azul lápiz pasta (≈ 7:1 sobre papel; ≥ 4,5:1 sobre ficha) */
  --tl-destacador: #FFE45C;       /* solo como fondo detrás de texto grafito */
  --tl-pizarra: #1F3A30;          /* bloque "El día del taller" */
  --tl-pizarra-2: #284A3D;        /* filas y cards sobre la pizarra */
  --tl-tiza: #EEF2EC;             /* texto sobre pizarra (≈ 11:1) */
  --tl-tiza-2: #B9C7BE;           /* meta sobre pizarra (≈ 6:1) */
  --tl-sombra-papel: 0 1px 0 rgba(31,35,41,.05), 0 14px 28px -14px rgba(31,35,41,.28);
  --tl-display: "Bricolage Grotesque", "Bricolage Fallback", "Arial", sans-serif;
  --tl-mano: "Caveat", "Prompt", sans-serif;
  --brand-lime: (lima de marca);
  /* puente a los tokens que leen LandingFaq, LandingMobileBar, SoonBadge (como en academias, música y teatro) */
  --surface-0: var(--tl-papel); --surface-1: var(--tl-ficha); --surface-2: var(--tl-papel-2);
  --text-1: var(--tl-grafito); --text-2: var(--tl-grafito-2); --text-3: var(--tl-grafito-3);
  --border: var(--tl-line); --border-strong: var(--tl-line-strong);
}
```

**Reglas de color**
- **Destacador** (`--tl-destacador`): solo como fondo detrás de palabras en grafito (la segunda parte de cada titular, cifras clave, la pestaña de la sección activa, el sticker de cupos). Nunca como color de texto ni de bloques grandes.
- **Azul lápiz pasta** (`--tl-tinta`): notas al margen, flechas, círculos y subrayados dibujados, checks de "presente", links de texto. En texto, solo ≥ 16 px.
- **Pizarra**: solo en §4.5 (El día del taller). Texto tiza; acciones en lima; notas en Caveat tiza (no azul).
- **Lima**: botones primarios, `✓ Presente` / `Válida`, el monto "Tú recibes". Nunca lima pegado al destacador (se separan con blanco o con borde grafito).
- La línea roja de margen y el borde superior de las fichas son decorativos (`aria-hidden`), nunca transmiten estado.

**Tipografía**
- **Bricolage Grotesque** (Google Fonts, OFL; `@fontsource/bricolage-grotesque` 700 y 800, o `@fontsource-variable/bricolage-grotesque` con ejes `wght`/`opsz`; elegir la opción de menor peso total, objetivo < 70 KB, solo `latin`, `font-display: swap`). Precarga con el slot `head-extra` de `Layout.astro` (ya existe). Fallback con métricas ajustadas: `@font-face { font-family: "Bricolage Fallback"; src: local("Arial"); size-adjust: …; ascent-override: …; }`.
- Titulares en Bricolage 800, caja baja y alta, tracking −0,02em; H3 en 700. Énfasis: la segunda parte del titular lleva el **destacador** detrás (`<mark class="tl-mark">`, ver Recursos). **Prohibido** `font-style: italic` en toda la página, letra calada y versalitas.
- **Caveat 600** (`@fontsource/caveat`, solo `latin`, sin preload, `font-display: optional`): notas al margen, flechas con texto, la cifra escrita a mano de la calculadora, los checks del pase de lista. Siempre ≥ 20 px, siempre en `--tl-tinta` (o tiza en la pizarra). Si no carga, cae a Prompt sin mover el layout (las notas tienen ancho fijo). **Nunca** lleva información que no esté también en texto normal o en el `aria-label`.
- Cuerpo: Prompt (la sans actual) 400/500. Eyebrows: Prompt 600, 13 px, mayúsculas, tracking .14em, `--tl-grafito-3`.
- Cifras (contadores, montos, cupos): Bricolage 700 con `font-variant-numeric: tabular-nums`.
- **Escala desktop:** H1 88/90, H2 56/60, H3 28/34, cuerpo 18/29, notas Caveat 26/28. **Mobile:** H1 44/46, H2 34/38, H3 22/28, cuerpo 16/25, notas Caveat 22/24.

**Recursos gráficos**
- **Cuadrícula**: `background-image: linear-gradient(var(--tl-cuadro) 1px, transparent 1px), linear-gradient(90deg, var(--tl-cuadro) 1px, transparent 1px); background-size: 28px 28px;` (22 px en mobile) sobre `--tl-papel`. CSS puro.
- **Margen**: en desktop, línea vertical de 1 px `--tl-margen` a 72 px del borde izquierdo del contenedor; las notas al margen viven a su izquierda o colgadas de los mockups. En mobile no hay margen.
- **Destacador** (`.tl-mark`): pseudo-elemento detrás del texto, `inset: 0.08em -0.18em 0.02em`, `background: var(--tl-destacador)`, `border-radius: 0.2em 0.5em 0.3em 0.6em / 0.6em 0.3em 0.5em 0.2em` (borde irregular), `transform: skewX(-6deg)`. Se revela con `transform: scaleX(0 → 1)` desde la izquierda (TL3). En titulares de dos líneas, `box-decoration-break: clone`.
- **Anotaciones**: texto Caveat + SVG inline de 1 trazo (flecha curva, círculo, subrayado doble) en `--tl-tinta`, `stroke-width: 2.25`, `stroke-linecap: round`. Se revelan con `clip-path: inset(0 100% 0 0) → inset(0)` (TL4). `aria-hidden` (el texto equivalente está en el contenido).
- **Ficha** (`IndexCard.astro`): fondo blanco, radio 6 px, renglones horizontales `--tl-ficha-renglon` cada 28 px (gradiente), línea superior de 2 px `--tl-ficha-borde` a 40 px del borde, sombra `--tl-sombra-papel`. Encabezado en Prompt 600 12 px mayúsculas (`FICHA DE INSCRIPCIÓN · EJEMPLO`).
- **Foto impresa** (`PrintedPhoto.astro`): `<picture>` con borde blanco de 10 px (12 px abajo), radio 2 px, `--tl-sombra-papel`, giro `--tilt` (−1,5° a 1,5°), un **clip** dibujado en SVG inline arriba a la izquierda y, opcional, un pie en Caveat. Sin overlays ni filtros.
- **Botón de cartón** (`.tl-btn`): radio 10 px, borde 2 px `--tl-grafito`, sombra dura `4px 4px 0 var(--tl-grafito)`; primario con fondo lima y texto grafito, secundario con fondo ficha. Al apretar: `transform: translate(4px, 4px)` y sombra 0 (TL15). Altura ≥ 48 px.
- **Casillas de cupo**: fila de cuadraditos de 14 px con borde grafito; los ocupados llevan un check azul dibujado. Representan cupos de un formulario, no asientos (no se llenan solos al hacer scroll: cambian con la interacción).
- **Sticker de cupos**: círculo de 96 px con fondo destacador, borde grafito 2 px, texto Bricolage 700 `Quedan 3 cupos`, girado −6°. Decorativo en el hero; el dato real está en la ficha.
- **Pestaña de sección** (`SectionTab.astro`): rectángulo 36 px de alto con esquinas superiores de 8 px, Prompt 600 12 px mayúsculas, sobre el borde superior de la sección; inactiva en ficha con borde `--tl-line-strong`, activa (sección en viewport) con fondo destacador.
- Iconos: los del sitio (lucide), trazo 1.75. Nada de logos de Instagram, WhatsApp, Google ni de talleres reales; nada de clip-art de herramientas.

---

## 2. Estructura

| # | Sección | Pestaña | Fondo | Ancla |
|---|---|---|---|---|
| 1 | Hero (cuaderno + foto impresa + ficha de inscripción) | — | papel con cuadrícula | |
| 2 | Tu lista de pendientes, tachada | `PENDIENTES` | papel | `#pendientes` |
| 3 | Arma tu taller (firma) + fichero de formatos | `TU TALLER` | papel-2 | `#arma` |
| 4 | Antes del taller: que nadie llegue perdido | `ANTES` | papel | `#antes` |
| 5 | El día del taller: pasar lista | `EL DÍA` | **pizarra** | `#el-dia` |
| 6 | Para llenar los últimos cupos | `DIFUSIÓN` | papel | `#difusion` |
| 7 | Después: del taller de prueba al nivel 2 | `DESPUÉS` | papel-2 | `#despues` |
| 8 | Precio: la cuenta del cuaderno | `PRECIO` | papel con cuadrícula | `#precio` |
| 9 | Para espacios que programan talleres | `ESPACIOS` | papel-2 | `#espacios` |
| 10 | Testimonio (solo si es real) | — | papel | |
| 11 | Preguntas frecuentes | `PREGUNTAS` | papel | |
| 12 | Cierre con foto impresa | — | papel con cuadrícula | |
| 13 | Footer (`AppFooter tone="paper"`) | — | papel | |

---

## 3. Header y progreso

- `WorkshopHeader.vue` (patrón de `TheatreHeader.vue` / `MusicHeader.vue`): `position: fixed`, transparente sobre el hero; tras 40 px de scroll, `rgba(244,246,241,.9)` + `backdrop-filter: blur(12px)` + borde inferior `--tl-line`.
- Logo · links `Tu taller` (`#arma`) · `El día` (`#el-dia`) · `Precio` (`#precio`) · `Espacios` (`#espacios`) · `Ingresar` · botón de cartón lima `Abrir inscripciones` (alto 40 px en el header, sombra 3 px).
- **Barra de progreso de lectura**: `ReadingProgress` con `color="var(--tl-tinta)"`, 2 px.
- Mobile: logo + botón de menú 44×44 de cartón (ficha, borde grafito). `LandingMobileBar variant="pill"` con `title="Gratis si tu taller es gratis"`, `subtitle="0% de comisión si cobras"`, `ctaLabel="Abrir inscripciones"`; aparece después del hero y se oculta en el cierre (comportamiento existente).

---

## 4. Secciones (copy es-CL completo)

### 4.1 Hero
- Alto `min(100svh, 860px)` desktop, fondo papel con cuadrícula y margen. Grid `minmax(0,6fr) minmax(0,5fr)`, gap 64.
- **Izquierda (texto, a la derecha del margen):**
  - Eyebrow: `PARA TALLERISTAS Y ESPACIOS QUE DICTAN TALLERES`
  - H1 (Bricolage 800): **Abre inscripciones con un link.** / **El día del taller,** `<mark>`**solo enseña.**`</mark>`
  - Bajada (armada con constantes): *Cupos por fecha que se cierran solos, inscripción gratis o pagada con Webpay, la entrada con QR al correo de cada persona y un recordatorio el día antes. Sin DM preguntando si queda cupo, sin pantallazos de transferencias, sin planillas. 0% de comisión para ti.*
  - CTAs: botón de cartón lima `Abrir inscripciones →` (`landing.cta.label`, `publishUrl("talleres_hero")`, `data-hero-cta`) · botón de cartón ficha `Ver un taller de ejemplo` (`landing.demo.url`; ver Pregunta abierta 9).
  - Microcopy (Prompt 14, `--tl-grafito-3`): `Gratis si tu taller es gratis · Sin mensualidad · {SERVICE_FEE_NOTE} lo paga quien se inscribe`.
- **Derecha (objetos sobre la mesa):**
  - Foto impresa `aitk-taller-clase` (taller de cerámica, la tallerista ayudando, la cordillera por la ventana) en 3:2, ancho 100%, giro 1,5°, clip arriba a la izquierda.
  - **Ficha de inscripción** encima, abajo a la izquierda de la foto, 300 px, giro −2°: `FICHA DE INSCRIPCIÓN · EJEMPLO` / Bricolage 24 `Torno para principiantes` / `con Javiera M. · Taller ejemplo, Ñuñoa` / `Sáb 14 nov · 10:00 a 13:00` / fila de 10 casillas (7 con check azul) / `7 de 10 cupos` / rótulo real `Últimas entradas` (lo que dice `cardLabel` para 3 de 10 pagados) / precio `{formatCLP(priceQuote(28000).buyerPays)}` con *Cargo por servicio incluido* (13 px) / botón de cartón lima pequeño `Comprar entrada` (no navega; `tabindex="-1"`, `aria-hidden` en el botón).
  - **Sticker** `Quedan 3 cupos` sobre la esquina superior derecha de la foto.
  - **Nota al margen** (Caveat, azul) con flecha curva hacia la ficha: `así le llega a quien se inscribe`.
  - Valores de verificación: $28.000 → $30.666 (computeFeeSplit).
- **Franja "Hecho para"** (debajo del hero, ancho completo, sobre la cuadrícula): eyebrow `HECHO PARA` + chips de ficha (no clickeables, Prompt 14, borde `--tl-line-strong`): `Cerámica` · `Cocina` · `Fotografía` · `Escritura` · `Ilustración y acuarela` · `Bordado y textil` · `Carpintería` · `Huerto y plantas` · `Yoga y bienestar` · `Talleres para niños` · `Cursos cortos`. Al final, link de texto azul: `¿Academia con muestra de fin de año? Mira la página para muestras →` (`/academias`).
- **Mobile:** texto arriba (H1 44 px), CTAs a ancho completo apilados; debajo, la foto impresa a ancho completo (giro 1°) con la ficha superpuesta abajo a la derecha (240 px, sin giro) y sin sticker ni nota; chips en scroll horizontal con `scroll-snap`.

### 4.2 Tu lista de pendientes, tachada (ancla `#pendientes`)
- Pestaña `PENDIENTES`. Eyebrow `ANTES DE CADA TALLER`; H2 **Todo lo que hoy haces a mano,** `<mark>`**tachado.**`</mark>`
- Una **hoja de cuaderno con renglones** (ficha grande, ancho 860 px, centrada a la derecha del margen) con 6 pendientes. Cada fila: casilla + pendiente (Prompt 20, grafito) que **se tacha** con una línea azul dibujada; debajo, en la misma fila, la respuesta (Prompt 16 `--tl-grafito-2`) con una flechita azul `→`. En desktop, la respuesta se alinea a la derecha de la fila (grid `1fr 1fr`).

| Pendiente (se tacha) | Con AI Tickets |
|---|---|
| Responder por DM si todavía queda cupo | La página muestra los cupos que quedan y se cierra sola cuando se llena. |
| Revisar transferencias y pedir el pantallazo | Pagan con Webpay y cada inscripción aparece al instante en tu panel. |
| Anotar en una planilla quién pagó y para qué fecha | Tu lista de inscritos se arma sola en tu panel y la descargas cuando quieras. *(Implementación: sin "por fecha": el CSV de `orders-csv.ts` es por evento y no trae la fecha de la función.)* |
| Mandar la dirección y la hora, uno por uno | La entrada llega al correo con fecha, hora y lugar, y el día antes, un recordatorio. |
| Contar quién llegó con una lista en papel | Pasas lista escaneando el QR o buscando el nombre en tu celular. |
| Cobrar en efectivo el mismo día | Cobras antes del taller. Lo de cada fecha queda disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina.* |

- Nota al pie: `*` + `TERMS_NOTE`.
- **Comportamiento:** al entrar la hoja al 30% de visibilidad, los pendientes se tachan uno a uno (stagger 380 ms), la casilla recibe el check y aparece la respuesta. Sin JS o con reduce-motion: todo ya tachado y visible. La línea es decorativa: el texto tachado lleva `<s>` con `aria-label` en la fila: *"Antes: responder por DM si queda cupo. Ahora: la página muestra los cupos que quedan…"*.
- **Mobile:** pendiente arriba, respuesta debajo; la hoja a ancho completo con margen interno de 16 px.

### 4.3 Arma tu taller (firma, ancla `#arma`)
- Pestaña `TU TALLER`. Eyebrow `PRUÉBALO AQUÍ`; H2 **Arma tu taller** `<mark>`**y mira cómo se inscriben.**`</mark>`; bajada: *Elige qué enseñas, cómo es el taller, cuántos cupos tiene y si cobras. A la derecha ves la página de inscripción tal como la ve tu gente, con los mismos avisos que muestra AI Tickets.*
- **Layout desktop:** grid `minmax(0,5fr) minmax(0,6fr)`, gap 56. Izquierda: **ficha del taller** (controles). Derecha: **teléfono** con la página y, debajo, **lo que AI Tickets hace por ti**. Una sola isla `WorkshopBuilder.vue` (`client:visible`).

**Ficha del taller** (`IndexCard`, encabezado `TU TALLER · EJEMPLO`), cinco controles, cada uno con su etiqueta Prompt 600 15 px:
1. **¿Qué enseñas?** — chips de cartón (radio 8 px, nunca pill; borde grafito; seleccionado con fondo destacador): `Cerámica` · `Cocina` · `Fotografía` · `Escritura`. Cambian el ejemplo (`WORKSHOP_PRESETS` en `talleresLanding.js`, todos ficticios):

| Preset | Taller | Con | Lugar | Precio por fecha | Curso de 4 sesiones | Cupos | Día y hora |
|---|---|---|---|---|---|---|---|
| Cerámica | Torno para principiantes | Javiera M. | Taller ejemplo · Ñuñoa | $28.000 | $95.000 | 10 | Sábado 10:00 a 13:00 |
| Cocina | Pastas frescas en casa | Tomás R. | Cocina ejemplo · Providencia | $25.000 | $85.000 | 12 | Jueves 19:00 a 22:00 |
| Fotografía | Fotografía con tu celular | Antonia P. | Estudio ejemplo · Valparaíso | $20.000 | $68.000 | 15 | Sábado 11:00 a 13:30 |
| Escritura | Escritura de crónica | Diego S. | Biblioteca ejemplo · Concepción | Gratis | Gratis | 20 | Miércoles 19:00 a 21:00 |

2. **¿Cómo es?** — segmented de cartón con 3 opciones: `Un día` · `Curso de 4 sesiones` · `Todas las semanas`.
3. **Cupos por fecha** — stepper `−` `{n}` `+` (botones de 44×44), de 4 a 40; debajo, la fila de casillas (hasta 20 visibles; con más, `+{n−20}`).
4. **¿Cobras?** — switch `Gratis` / `Con pago`; con pago, slider `Valor` de $5.000 a $120.000, paso $1.000 (el valor inicial es el del preset y formato). Debajo, en 14 px: `Quien se inscribe paga {formatCLP(priceQuote(v).buyerPays)}` · link `¿y si lo absorbo yo? →` (ancla `#precio`).
5. **Inscritos hasta ahora** — slider de 0 a `cupos` (inicial: `cupos − 3`), con la nota Caveat `muévelo y mira qué pasa →`. Las casillas se marcan con check azul según el valor.

**Teléfono** (marco 300×620, radio 36, borde grafito 2 px, sombra dura 6 px; etiqueta `Página de tu taller · ejemplo` arriba): reproduce la card de acción real (§4.4b de la spec de evento) con la piel del tema:
- Portada tipográfica (sin foto): bloque de 140 px con cuadrícula, el nombre del taller en Bricolage 26 y `con {tallerista}`.
- Fila de datos: fecha y hora, lugar.
- **Rótulo de estado**: el texto **exacto** de `cardLabel(fakeEvent, cardState(fakeEvent))` (se importa de `eventView.js` con un evento sintético armado en `talleresLanding.js`: `tickets[{price, remaining, total_quantity}]`, `sale_state`), en mayúsculas por CSS como la card real; tono `warning` en destacador, `neutral` en papel-2.
- Según formato:
  - **Un día**: precio final (o `Gratis`) + botón `Comprar entrada` / `Confirmar asistencia`.
  - **Curso de 4 sesiones**: lista de las 4 fechas (`Sáb 14, 21 y 28 nov y sáb 5 dic · 10:00`) + una entrada `Curso completo · 4 sesiones` con su precio final + botón `Comprar entrada`.
  - **Todas las semanas**: lista de 4 fechas próximas con su estado por función (la primera con el estado del slider; las otras `Disponible` con menos inscritos) + `Ver las 8 fechas` + botón `Elegir entradas`.
- **Lleno**: con inscritos = cupos, el rótulo pasa a `Gratis · Cupos llenos` / `Agotado`, el botón se reemplaza por un campo de correo deshabilitado y `Avísame si se libera un cupo` (como `RsvpForm` modo `full` / `NotifyForm`).
- Región `aria-live="polite"` con `useDelayedAnnouncement`: *"La página muestra: Gratis · Quedan 3 cupos."*

**Lo que AI Tickets hace por ti** (debajo del teléfono, lista de 4 a 5 ítems con check azul dibujado; se arma con `builderNotes(preset, formato, cobro, inscritos, cupos)` en `talleresLanding.js`):
- Siempre: **Cada inscripción llega con su QR al correo.** · **El día antes, un recordatorio con fecha, hora y lugar.**
- Gratis: **Nadie paga cargo: la inscripción gratis no cuesta nada, ni a ti ni a tu gente.**
- Con pago: **Pagan con Webpay. Tú no revisas transferencias.** · Un día / Todas las semanas: **Lo de cada fecha queda disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina.\***
- Curso de 4 sesiones: **Una sola inscripción para las 4 sesiones.** · Con pago: **Lo del curso queda disponible `{PAYOUT_RELEASE_HOURS}` h después de la última sesión.\*** · **Antes de cada sesión, un recordatorio extra que programas desde tu asistente de IA.** · **Pasar lista en cada sesión del curso** `Pronto` (nota 13 px: *hoy el QR se valida en la primera sesión*).
- Todas las semanas: **Cada fecha con sus propios cupos: tu gente elige la suya.** · **¿El próximo mes? Duplicas el taller y agregas las fechas nuevas.** · **Repetir "todos los sábados" en un paso** `Pronto`.
- Lleno: **Se llenó: la página lo dice y anota a quien quiere cupo.** · **Ver esa lista y avisarles cuando se libere un cupo** `Pronto`. *(Implementación: en "Todas las semanas" solo se llena la primera fecha, que queda `Agotada` y el teléfono no muestra el aviso; ahí la nota dice **Esa fecha se llenó: la página la marca Agotada y tu gente elige otra.** y se mantiene el `Pronto` de la lista.)*
- Al pie: `*` + `TERMS_NOTE`.

**Comportamiento:** al entrar en viewport (35%), el slider de inscritos sube solo de 0 al valor inicial (900 ms) **una vez**, con las casillas marcándose; si la persona toca algo antes, no hay movimiento automático. Los cambios del teléfono: crossfade + `translateY 8px` (220 ms); la lista de notas con stagger 60 ms.
- Sin JS: se muestra el estado inicial del preset Cerámica, formato `Un día`, con pago, 7 de 10 (rótulo `Últimas entradas`), y la lista de notas de ese estado; los controles se ocultan (`html:not(.lp-motion)` no basta: usar `<noscript>` con la versión estática renderizada en SSR, como `SeasonBoard`).
- Accesibilidad: controles nativos (`<fieldset>` + `<input type="radio">` para chips y segmented, `<input type="range">`, botones del stepper con `aria-label="Quitar un cupo"`/`"Agregar un cupo"`); el teléfono es una región con `aria-label="Vista previa de la página de inscripción"`; los botones dentro del teléfono son `aria-hidden` y no enfocables.
- **Mobile:** ficha arriba (controles apilados; chips en scroll horizontal), teléfono a ancho completo debajo (sin marco de teléfono: solo la card, radio 12, borde grafito) y la lista de notas debajo. Objetivos táctiles ≥ 44 px.

**Fichero de formatos** (debajo del armador, ancho completo; tres fichas en fila, giro −1°, 0°, 1°; en mobile, carrusel con `scroll-snap`). H3 **Un día, un curso o todas las semanas.** Cada ficha: título Bricolage 22, "Cómo se arma" (Prompt 16) y una nota al margen.

| Ficha | Cómo se arma | Nota (Caveat) |
|---|---|---|
| **Taller de un día** | Una fecha, un tipo de entrada con su cupo. Si es gratis, la gente solo confirma con su nombre y correo. | `el más simple: 10 minutos` |
| **Curso de varias sesiones** | Un evento por curso, con todas sus fechas y una entrada "para todas las funciones" con el cupo del curso. ¿También clases sueltas? Suma entradas amarradas a cada fecha. | `un evento por grupo = cobras al terminar ese curso` |
| **Taller que se repite** | Un evento con las próximas fechas (hasta `{MAX_EVENT_FUNCTIONS}`) y una entrada amarrada a cada una, con su cupo. Para el mes siguiente, lo duplicas y cambias las fechas. | `cada sábado con su cupo` |

### 4.4 Antes del taller: que nadie llegue perdido (ancla `#antes`)
- Pestaña `ANTES`. Grid desktop `minmax(0,5fr) minmax(0,6fr)`: izquierda foto, derecha texto.
- **Izquierda:** foto impresa `aitk-taller-tallerista` (tallerista preparando materiales) 4:5, giro −1,5°, clip; pie Caveat `la mesa lista desde el viernes`. Encima, abajo a la derecha, **correo de recordatorio** (ficha 280 px, giro 2°): `RECORDATORIO · EJEMPLO` / `Mañana: Torno para principiantes` / `Sáb 14 nov · 10:00 · Taller ejemplo, Ñuñoa` / botón de cartón pequeño `Ver mi entrada` / link azul `Agregar a mi calendario`.
- **Derecha:** eyebrow `ANTES DEL TALLER`; H2 **Que nadie llegue** `<mark>`**sin saber qué traer.**`</mark>`
- Cinco ítems (casilla con check azul + título Prompt 600 + texto):
  1. **Su entrada, con todo.** Cada persona recibe su QR por correo, con la fecha, la hora y la dirección. Desde su entrada abre el mapa y lo agrega a su calendario.
  2. **Un recordatorio el día antes, automático.** Tú no mandas nada. ¿Quieres otro el mismo día, con "traigan delantal y ropa que se pueda manchar"? Lo programas con tu texto desde tu asistente de IA conectado.
  3. **Las dudas, respondidas en la página.** "¿Incluye materiales?", "¿Sirve si nunca he hecho cerámica?": la página de tu taller tiene un asistente que responde con lo que tú escribiste, y las preguntas frecuentes las armas con IA desde el panel.
  4. **Cierra las inscripciones cuando necesitas.** Si compras los materiales el jueves, las inscripciones se cierran el miércoles en la noche. Hoy se configura desde tu asistente de IA.
  5. **Preguntas al inscribirse** (nivel, alergias, talla) `Pronto`. — *Hoy cada inscripción guarda el nombre y el correo de quien se inscribe.*
- Burbujas del asistente (debajo de los ítems, ancho 420 px): persona `¿Tengo que llevar algo?` → respuesta `No, los materiales están incluidos. Solo trae ropa que se pueda manchar. ¿Te ayudo con tu inscripción? · ejemplo`. Burbujas genéricas, sin marcas.
- **Mobile:** foto a ancho completo con el correo abajo sin giro; ítems y burbujas debajo.

### 4.5 El día del taller: pasar lista (pizarra, ancla `#el-dia`)
- Pestaña `EL DÍA` (sobre la pizarra, en tiza). Fondo `--tl-pizarra` con un borde superior de 10 px en "marco de madera" (`#8A6A48`, decorativo) y un gradiente muy sutil de tiza borrada (radial al 4%, CSS). Texto tiza.
- Eyebrow `EL DÍA DEL TALLER` (`--tl-tiza-2`); H2 **Pasa lista** `<mark>`**con el celular.**`</mark>` (el destacador también va sobre pizarra: texto grafito sobre amarillo).
- **Layout desktop:** grid `minmax(0,6fr) minmax(0,5fr)`. Izquierda: **lista de curso** (firma secundaria). Derecha: ítems.

**Lista de curso** (`ClassRoll.vue`, isla `client:visible`; card `--tl-pizarra-2`, radio 6, renglones tiza al 10%; etiqueta `Sáb 14 nov · 10:00 · ejemplo`):
- Encabezado: contador Bricolage 56 `{n}` + `de 10 presentes`; campo `Buscar por nombre` (decorativo en la demo, con lupa).
- 10 filas (nombre + inicial, ficticios: `Camila R.`, `Ignacio T.`, `Fernanda L.`, `Matías O.`, `Josefa A.`, `Benjamín C.`, `Valentina S.`, `Tomás G.`, `Antonia V.`, `Martín P.`) con la entrada (`General` / `Cortesía`) y, al validarse, un check lima dibujado + la hora (`10:02`) en Caveat tiza.
- Demo: mientras se ve, cada 900 ms se valida una fila (como si escanearan su QR); la sexta se valida **buscando el nombre** (el campo muestra `vale`, la fila de Valentina se resalta, `✓ Presente · buscada por nombre`); la octava muestra un intento repetido: `Entrada ya validada · 10:04` en tiza al 70% (estado real). Llega a 9 de 10 y se detiene; botón `↻ Repetir` para volver a empezar. Con reduce-motion: estado final estático (9 de 10, con los dos casos especiales visibles).
- `role="img"` no: es una `<table>` con `<caption class="lp-sr-only">Lista de ejemplo, 9 de 10 presentes</caption>`; el contador es `aria-live="off"` (no anunciar cada tick).

**Ítems** (derecha, punto lima + título + texto, tiza):
1. **Escanea en la puerta o en la mesa.** Tú, tu ayudante o quien recibe: con el rol Puerta o con un link temporal que vence solo (lo creas desde tu asistente de IA). No necesitan tu cuenta.
2. **Aunque el taller no tenga señal.** La lista se descarga antes y se sincroniza cuando vuelve la conexión. Una entrada usada no vuelve a entrar.
3. **¿Se le borró el correo?** Lo buscas por nombre y se lo reenvías en un toque.
4. **Becas y ayudantes, con su QR.** Les mandas una cortesía sin costo desde el panel: no cuenta como venta y entra igual.
- Nota (Prompt 14, tiza-2, con `SoonBadge dark`): *En un curso de varias sesiones con una sola entrada, el QR se valida en la primera sesión.* **Pasar lista en cada sesión** `Pronto`.
- Link `Guía: check-in con QR →` (`/guias/como-hacer-check-in-con-qr`).
- **Mobile:** lista arriba a ancho completo (6 filas visibles + `y 4 más`), ítems debajo.

### 4.6 Para llenar los últimos cupos (ancla `#difusion`)
- Pestaña `DIFUSIÓN`. Eyebrow `DIFUSIÓN`; H2 **¿Te quedan cupos?** `<mark>`**Que se enteren.**`</mark>`; bajada: *Un taller de 10 cupos se llena con las personas correctas, no con miles de visitas. Estas tres cosas ayudan.*
- Tres fichas (grid de 3 en desktop; apiladas en mobile), cada una con eyebrow, H3 Bricolage 24, texto y un mockup chico:
  1. **Tu Instagram, solo.** *Conectas tu cuenta y apruebas la serie con una vista previa. Con la imagen y los datos de tu taller armamos historias que cuentan hacia la próxima fecha, todos los días la última semana, y le mandamos el link por DM a quien responde `{DEFAULT_KEYWORD}`.* Mockup: historia 150×300 (marco grafito radio 22, portada tipográfica con cuadrícula, `Este sábado · 10:00`, sticker destacador `Quedan 3 entradas`, sticker lima `Responde {DEFAULT_KEYWORD}`). Chips: `● Instagram` (borde lima) · `Facebook` `Pronto` · `TikTok` `Pronto` · `Reels` `Pronto`.
  2. **Un link para cada comunidad.** *Uno para tu newsletter, otro para la tienda de materiales que te recomienda, otro para tus ex alumnos. En las métricas ves cuántas inscripciones trajo cada uno.* Mockup: mini tabla `Ventas por link · ejemplo` con 3 filas (`Newsletter 5`, `Tienda ejemplo 3`, `Instagram 2`) y barras azules.
  3. **Un código para quienes ya vinieron.** *Crea un descuento para ex alumnos o socios desde tu panel: porcentaje o monto, cuántos usos y hasta cuándo.* Mockup: ficha con `EXALUMNOS15 · 15% · 20 usos · hasta 30 nov · ejemplo`.
- Línea final (Prompt 16, centrada): *¿Necesitas un empujón? Lanza un anuncio en Instagram y Facebook desde tu panel para tu ciudad: tú defines cuánto y por cuántos días, y Meta cobra el gasto directo en tu cuenta publicitaria.* (sin demo de anuncios: es la firma de stand-up y música).

### 4.7 Después: del taller de prueba al nivel 2 (ancla `#despues`)
- Pestaña `DESPUÉS`. Eyebrow `DESPUÉS DEL TALLER`; H2 **Quien vino una vez** `<mark>`**vuelve al nivel 2.**`</mark>`
- Grid desktop `minmax(0,5fr) minmax(0,6fr)`. Izquierda: tres pasos numerados a mano (Caveat 40 azul `1`, `2`, `3`) con título y texto. Derecha: **demo de invitación** (`InviteNextLevel.vue`, isla `client:visible`).
- Pasos:
  1. **Te cuentan cómo les fue.** Entre `{REVIEW_REQUEST_DELAY_HOURS}` y `{REVIEW_REQUEST_WINDOW_HOURS}` horas después, les llega un correo para calificar con estrellas, comentar y subir hasta `{MAX_PHOTOS_PER_PERSON}` fotos de lo que hicieron. Si quieres, premias a quien califica con un código para tu próximo taller.
  2. **Los invitas al siguiente.** Con un correo desde el panel, a todos, a quienes llegaron o a quienes calificaron con 4 o 5 estrellas (`INVITE_AUDIENCE_TEXT`, mismo helper que teatro). No llega a quienes se dieron de baja ni a quienes ya tienen entrada.
  3. **El próximo mes, en minutos.** Duplicas el taller con su descripción, imagen, lugar, entradas y preguntas, y agregas las fechas nuevas.
- **Demo de invitación** (ficha grande, encabezado `INVITACIÓN · EJEMPLO`): `De: Torno para principiantes` → `A: Torno nivel 2 · desde el sáb 12 dic`; segmented de cartón con las audiencias de `INVITE_AUDIENCES` (textos tal cual: `Todos los asistentes` · `Solo quienes ingresaron (check-in)` · `Solo quienes calificaron con 4 o 5 estrellas`; se omite `Solo quienes calificaron` para que quepa); contador grande `{n} personas` (ejemplo: 36 · 33 · 21); vista previa del correo: *"¡Gracias por acompañarnos en Torno para principiantes! Nos encantaría verte en Torno nivel 2."* (es el texto por defecto de `invitationCopy`, `invitations.ts`) + botón `Ver el taller`; debajo, `★ 4,9 · 18 reseñas · ejemplo`. Botón de cartón `Enviar invitación` que en la demo muestra `✓ Invitación programada · ejemplo` (no envía nada).
- Nota (14 px) con `SoonBadge`: **Mostrar las reseñas en la página mientras el taller sigue con fechas** `Pronto` — *hoy se muestran cuando termina.*
- **Mobile:** pasos arriba, demo debajo a ancho completo; segmented en dos líneas.

### 4.8 Precio: la cuenta del cuaderno (ancla `#precio`)
- Pestaña `PRECIO`. Fondo papel con cuadrícula. Eyebrow `PRECIO`; H2 **Para ti, 0% de comisión.** `<mark>`**Haz la cuenta.**`</mark>`
- Texto (armado como el `priceLead` de las otras landings, con constantes): *Crear tu cuenta y publicar es gratis, sin mensualidad. Si tu taller es gratis, nadie paga nada. Si cobras, quien se inscribe paga un cargo por servicio de `{SERVICE_FEE_PERCENT_LABEL}` más IVA (`{IVA_PERCENT_LABEL}`) sobre ese cargo, y tú recibes el 100% de tu precio. Si prefieres un precio redondo, lo absorbes tú, por taller. `{ABSORB_FEE_ACTIVATION}`*
- **La cuenta** (`NotebookSum.vue`, isla `client:visible`; usa `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement`). Una ficha ancha (desktop 760 px) con dos columnas:
  - **Izquierda, controles:** switch `Gratis` / `Con pago`; slider `Valor del taller` $5.000–$120.000, paso $1.000, inicial **$25.000**; stepper `Cupos` 4–40, inicial **12**; segmented de cartón `Paga quien se inscribe` / `Lo absorbo yo`.
  - **Derecha, la suma escrita en el cuaderno** (Bricolage 700 tabular, alineado a la derecha, sobre renglones):
    - `Valor del taller ········ {price}`
    - `+ {SERVICE_FEE_LABEL} ········ {fee}`
    - `+ {SERVICE_FEE_TAX_LABEL} ········ {iva}`
    - raya horizontal grafito 2 px (dibujada)
    - `Quien se inscribe paga ········ {buyerPays}` (Bricolage 32)
    - `Tú recibes por inscripción ········ {perTicket}` en bloque lima (Bricolage 32, texto grafito)
    - abajo, el total **escrito a mano**: `× {cupos} cupos = {total}` en Caveat 40 azul, con **doble subrayado** dibujado y la nota `con el taller lleno` (el mismo número en texto normal en el `aria-live`).
  - Gratis: la suma se reemplaza por `$0 para todos` (Bricolage 56) y la nota Caveat `y la entrada con QR igual`.
  - Verificación (computeFeeSplit): **$25.000 → paga $27.380 / recibes $25.000 × 12 = $300.000; absorbido → paga $25.000 / recibes $22.620 × 12 = $271.440.** $10.000 → $10.952 / $10.000; absorbido → $9.048.
- Garantías (Prompt 14, en una línea con checks azules): `Sin mensualidad ✓ Sin permanencia ✓ {PAYOUT_SHORT_TEXT}*`. Nota: `TERMS_NOTE` → `/terminos-productores`. *(Implementación: en vez de `PAYOUT_SHORT_TEXT`, que dice "después de cada show", va `payoutGuaranteeText` de `talleresLanding.js`, armado con `PAYOUT_RELEASE_HOURS`: `Lo tuyo, disponible {PAYOUT_RELEASE_HOURS} h después de cada fecha (o de la última sesión del curso)`, que calza con `ledger.ts` y con el armador.)*
- **Mobile:** controles arriba, suma debajo; montos Bricolage 24; la cifra a mano en Caveat 32.

### 4.9 Para espacios que programan talleres (ancla `#espacios`)
- Pestaña `ESPACIOS`. Eyebrow `PARA ESPACIOS`; H2 **¿Tienes un espacio con varios talleres?** `<mark>`**Toda tu programación, en tu web.**`</mark>`
- Desktop: grid `1fr 1fr`. Izquierda: **mockup de web** (`SpaceSchedule.astro`): marco de navegador mínimo de cartón con `aitickets.cl/o/espacio-ejemplo` y una grilla de 4 talleres como fichas con pestañas de color (portadas tipográficas, sin fotos): `Torno para principiantes · sábados` · `Pastas frescas · jueves` · `Acuarela botánica · domingos` · `Huerto en balcón · 1 sáb al mes`, cada una con su rótulo (`Últimas entradas`, `Gratis · Quedan 4 cupos`…). Etiqueta `ejemplo`.
- Derecha, cuatro ítems con casilla azul:
  1. **Tu web gratis, con todos tus talleres.** Una página en `aitickets.cl/o/tu-espacio` con tu programación inscribiendo, con plantillas y, si quieres, tu dominio.
  2. **Cada taller, con sus fechas y sus cupos.** Cada tallerista que programas es un evento con su precio, su cupo y su lista.
  3. **Cada tallerista ve lo suyo.** Le das acceso de Solo lectura limitado a su taller para que siga sus inscripciones. Hoy se asigna desde tu asistente de IA.
  4. **Para rendirle a cada tallerista.** Descargas los inscritos de cada taller en CSV, con nombre, correo, entradas y montos.
- CTA secundario de cartón: `Arma la web de tu espacio →` (`/web-gratis`).
- **Mobile:** ítems arriba, mockup debajo con las fichas en carrusel horizontal (`scroll-snap`).

### 4.10 Testimonio (solo si es real)
- Solo si `WORKSHOP_TESTIMONIAL` no es `null`. Formato "nota pegada": ficha con renglones, giro −1°, clip; cita en Bricolage 600 28/38 (22/30 mobile) con la frase clave en destacador; debajo, foto impresa cuadrada de 72 px con borde blanco (no circular), nombre (Prompt 600) y `taller o espacio · ciudad` (Prompt 14 `--tl-grafito-3`).
- Si es `null`, no se renderiza nada (ni el contenedor).

### 4.11 Preguntas frecuentes
`src/data/talleresFaq.ts`, mismo patrón que `teatroFaq.ts` (`pick` con error si falta, `reword`). Orden:

| # | Fuente | Pregunta |
|---|---|---|
| 1 | `PRODUCER_FAQ` | ¿Cuánto cuesta usar AI Tickets? |
| 2 | landings.ts (talleres, se conserva) | ¿Cuánto cuesta un taller gratuito? |
| 3 | `PRODUCER_FAQ` | ¿Cuándo recibo el dinero de mis ventas? (`terms`) |
| 4 | nueva (`terms`) | ¿Y si vendo un curso de varias sesiones? — *Si lo vendes con una sola entrada para todas las sesiones, lo del curso queda disponible `{PAYOUT_RELEASE_HOURS}` h después de la última sesión. Si vendes cada sesión por separado, lo de cada una queda disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina. Por eso te recomendamos un evento por curso o por grupo.* (texto armado con `PAYOUT_RELEASE_HOURS`; regla de `ledger.ts`) |
| 5 | `PRODUCER_FAQ` | ¿Puedo absorber el cargo por servicio? |
| 6 | nueva | ¿Cada fecha puede tener sus propios cupos? — *Sí. Creas un tipo de entrada amarrado a cada fecha, con su cupo; cuando se llena, la página deja de venderlo y tu gente elige otra fecha. Una entrada "para todas las funciones" comparte el cupo entre todas las fechas: sirve para un curso completo.* |
| 7 | `PRODUCER_FAQ` | ¿Puedo publicar varias funciones de una misma obra o show? → `reword` **¿Puedo publicar todas las fechas de mi taller juntas?** |
| 8 | nueva | ¿Qué pasa cuando se llenan los cupos? — *La página muestra que se llenó y ofrece anotarse para que le avisen. Hoy esa lista no se ve en el panel; si se libera un cupo (por ejemplo, porque alguien te pidió la devolución), la página vuelve a inscribir sola.* (verificar al implementar que una devolución libera el cupo; si no, quitar la última frase) |
| 9 | landings.ts (talleres, se conserva) | ¿Puedo pedir datos adicionales al inscribirse? |
| 10 | nueva | ¿Puedo limitar a una inscripción por persona? — *Sí. Cada tipo de entrada tiene un máximo por compra (`{DEFAULT_MAX_PER_PURCHASE}` si no lo cambias); para un taller individual lo dejamos en 1 desde tu asistente de IA conectado o por WhatsApp.* |
| 11 | nueva | ¿Puedo cerrar las inscripciones antes del taller? — *Sí. Cada tipo de entrada puede tener un fin de venta, por ejemplo el día antes para comprar los materiales. Hoy se configura desde tu asistente de IA conectado o escribiéndonos por WhatsApp.* |
| 12 | landings.ts (talleres, se conserva) | ¿Puedo escribirle a los inscritos? |
| 13 | nueva | ¿Mis alumnos tienen que descargar una app? — *No. Se inscriben desde el navegador del celular y reciben su entrada con QR por correo.* |
| 14 | nueva | ¿Pueden pagar por transferencia o en efectivo? — *No. El pago se hace en la página con Webpay, así la inscripción queda confirmada al instante y tú no tienes que revisar nada.* |
| 15 | nueva | ¿Sirve para talleres de niños? — *Sí. Se inscribe el papá, la mamá o quien esté a cargo, con su correo, y recibe la entrada. Hoy la inscripción guarda los datos de quien compra, no los de cada niño o niña.* |
| 16 | `ORGANIZADORES_FAQ` | ¿Cómo funciona la publicación automática en redes? |
| 17 | `ORGANIZADORES_FAQ` | ¿Cómo funcionan las reseñas? → `reword` con extra: *En la página del taller se muestran cuando termina su última fecha.* |
| 18 | nueva | ¿Puedo invitar a quienes vinieron a mi próximo taller? — *Sí. Desde el panel les mandas un correo a `{INVITE_AUDIENCE_TEXT}`. No llega a quienes se dieron de baja ni a quienes ya tienen entrada.* |
| 19 | `PRODUCER_FAQ` | ¿Qué pasa si tengo que cambiar o cancelar una función? → `reword` **¿Y si no llego al mínimo y tengo que suspender?** (`terms`) |
| 20 | `PRODUCER_FAQ` | ¿Me ayudan a publicar mi primer evento? → `reword` **¿Me ayudan a publicar mi primer taller?** |

- La FAQ "¿Cuánto paga el público?" no existe en la entrada actual: nada que eliminar. Las tres de `landings.ts` se conservan en esa entrada y `talleresFaq.ts` las toma con `pick`.
- Estilo: `LandingFaq` con los tokens puente; pregunta en Bricolage 700 20 px; cada ítem como renglón de cuaderno con separador `--tl-line`; el `+` en azul (el giro de 45° ya lo hace `LandingFaq`).

### 4.12 Cierre
- Fondo papel con cuadrícula. Desktop: grid `minmax(0,5fr) minmax(0,6fr)`. Izquierda: foto impresa `aitk-taller` (taller de escritura con luz de tarde) 4:5, giro −2°, clip; pie Caveat `el sábado, solo esto`. Derecha:
  - H2 Bricolage 72 (40 mobile): **¿Cuándo abres** `<mark>`**las inscripciones?**`</mark>`
  - Bajada: *Publica tu taller hoy. Crear tu cuenta es gratis y no hay costos fijos. Si quieres, lo armamos contigo.*
  - CTAs (`data-final-cta`): cartón lima `Abrir inscripciones →` (`publishUrl("talleres_closing")`) · cartón ficha `Hablar por WhatsApp` (`whatsappUrl("Hola, quiero abrir inscripciones para mi taller con AI Tickets")`) · link azul `Agenda una demo de 15 min` (`DEMO_CALL_URL`).
  - Nota al margen con flecha hacia el CTA: `10 minutos, de verdad`.
- **Mobile:** foto arriba a ancho completo (giro 1°), texto y CTAs debajo.

### 4.13 Footer
`AppFooter tone="paper"` (ya existe, lo usa academias; sin cambios en `AppFooter.vue`).

---

## 5. Mobile

- Ancho base 390; gutter 16 px; secciones con 72 px de padding vertical (desktop 128). Sin línea de margen; las notas al margen pasan debajo de su objeto o se ocultan si son solo decorativas (`aria-hidden`).
- Orden igual al desktop. Cambios: hero con texto arriba y foto + ficha debajo (§4.1); pendientes con respuesta debajo (§4.2); armador con ficha arriba y card del teléfono sin marco (§4.3); fichero de formatos en carrusel; pase de lista con 6 filas + `y 4 más` (§4.5); fichas de difusión apiladas; demo de invitación a ancho completo; cuenta del cuaderno apilada; espacios con carrusel; cierre con foto arriba.
- Giros: máximo ±1° en mobile (los giros mayores cortan bordes en pantallas chicas). Sombra dura de los botones a 3 px.
- Objetivos táctiles ≥ 44×44 (stepper, chips, segmented, sliders con thumb de 28 px y área de 44). Nada de hover como única forma de ver información.
- `LandingMobileBar` en píldora aparece después del hero y se oculta al llegar al cierre. Sin scroll horizontal (verificar los giros y los stickers con `overflow-x: clip` en cada sección).

---

## 6. Animaciones (todas con `prefers-reduced-motion`)

Solo `transform`, `opacity` y `clip-path`. Con `prefers-reduced-motion: reduce` todo queda en su estado final, sin loops ni movimientos automáticos: destacadores ya pintados, anotaciones dibujadas, pendientes tachados, slider de inscritos en su valor inicial sin moverse solo, pase de lista en 9 de 10. Usar `LandingMotion` (`data-lp-reveal` / `data-lp-step`) para los reveal genéricos; los loops corren solo en viewport (`data-tl-play` → `.is-playing`, mismo patrón que música y teatro).

| # | Elemento | Animación |
|---|---|---|
| TL1 | Foto impresa del hero | Cae sobre la mesa: `translateY(-16px) rotate(4deg) → translateY(0) rotate(1.5deg)` con un leve rebote (700 ms, desde 200 ms) |
| TL2 | H1 | Cada línea sube 20 px con fade, stagger 140 ms, desde 300 ms |
| TL3 | Destacador | `scaleX(0 → 1)` desde la izquierda, 600 ms, `cubic-bezier(.6,0,.2,1)`, después de su línea (en el hero, a los 800 ms; en los H2, al revelarse) |
| TL4 | Anotaciones (flechas, círculos, subrayados) | `clip-path: inset(0 100% 0 0) → inset(0)` 600 ms; el texto Caveat con fade 300 ms después |
| TL5 | Ficha del hero | Se desliza desde abajo `translateY(24px) rotate(-6deg) → rotate(-2deg)` (600 ms, 1,0 s); las casillas se marcan con stagger 70 ms |
| TL6 | Sticker de cupos | Pop `scale(.6) rotate(-20deg) → scale(1) rotate(-6deg)` (450 ms, 1,4 s) |
| TL7 | Pestañas de sección | Al entrar la sección (25%): la pestaña sube 4 px y cambia a destacador (fondo con `opacity`, 250 ms); la anterior vuelve |
| TL8 | Pendientes | La línea de tachado `scaleX(0 → 1)` (320 ms) + check de la casilla (`clip-path`) + respuesta con fade y `translateY 6px`; stagger 380 ms |
| TL9 | Armador: subida automática | Slider de inscritos de 0 al valor inicial (900 ms) una vez; casillas con stagger 50 ms |
| TL10 | Armador: cambios | Teléfono crossfade + `translateY 8px` (220 ms); rótulo con pop `scale .96 → 1`; notas con stagger 60 ms |
| TL11 | Fichero de formatos | Las tres fichas entran como un abanico: desde `rotate(0) translateX(±40px)` a su giro final, stagger 90 ms |
| TL12 | Correo de recordatorio | Entra deslizando `translateX(24px) rotate(6deg) → rotate(2deg)` al 40% de visibilidad |
| TL13 | Pase de lista | Una fila cada 900 ms solo en viewport: check lima `clip-path`, hora con fade, contador interpola (200 ms); la búsqueda escribe `vale` (opacidad por letra, 60 ms) |
| TL14 | Historia de ejemplo | Barra de progreso de 5 s en loop solo mientras está visible |
| TL15 | Botones de cartón | `:active` → `translate(4px, 4px)` + sombra 0 (80 ms); hover → `translate(-1px,-1px)` + sombra 5 px |
| TL16 | Demo de invitación | Contador interpola entre audiencias (300 ms); `Enviar invitación` → pop del check |
| TL17 | La cuenta del cuaderno | Montos interpolan 250 ms; la raya y el doble subrayado se redibujan (`clip-path`) cuando cambia el total |
| TL18 | Fotos impresas | Hover (solo puntero fino): `rotate(0)` + `translateY(-4px)`, 250 ms |
| TL19 | Barra de lectura | `scaleX` según scroll (azul) |

---

## 7. Rendimiento

- **LCP**: en desktop compite el H1 con la foto del hero (`aitk-taller-clase`). La foto: AVIF/WebP a 640 y 1024 (sharp, como las otras), `fetchpriority="high"`, sin `loading="lazy"`, `sizes="(min-width: 1024px) 42vw, 100vw"`. La referencia mide 1024 px; la real debe venir a 2400 px (y entonces se agregan 1344 y 2048).
- El giro y el borde de la foto impresa son CSS sobre el `<picture>`: no retrasan el pintado. El destacador del H1 es un pseudo-elemento: el texto se ve desde el primer frame aunque el destacador todavía no se haya pintado.
- **Fuentes:** Bricolage Grotesque, 1 o 2 archivos `latin` (< 70 KB), `preload` solo en esta página, fallback con `size-adjust` (CLS < 0,05). Caveat 600 `latin` (~30 KB) **sin preload**, `font-display: optional` (si no llega a tiempo, las notas quedan en Prompt). Prompt ya está cargada.
- Cuadrícula, margen, renglones, destacador, clips, flechas y casillas: CSS y SVG inline (< 2 KB en total), sin imágenes.
- Islas Vue con `client:visible` (`WorkshopBuilder`, `ClassRoll`, `InviteNextLevel`, `NotebookSum`) y `client:idle` (`WorkshopHeader`, `LandingMobileBar`). Pendientes, antes, difusión, espacios, cierre: Astro estático + script chico. La página se lee completa sin JS.
- `WorkshopBuilder` importa `cardLabel`/`cardState`/`formatCLP` de `eventView.js` (sin dependencias de servidor; solo `buyer-name.mjs`) y `priceQuote` de `producerLanding.js`: verificar que el chunk de la isla quede < 25 KB gzip.
- Resto de fotos `loading="lazy"`, `srcset` y `aspect-ratio` reservado. Lighthouse móvil ≥ 90 en performance y accesibilidad.

---

## 8. Fotos

**Se reutilizan** (todas en `public/landing/`; generar AVIF/WebP de las tres, hoy no tienen variantes):

| Uso | Archivo | Tratamiento | Variantes |
|---|---|---|---|
| Hero | `aitk-taller-clase.jpg` (3:2, 1024×688) — taller de cerámica, la tallerista ayudando, la cordillera por la ventana | foto impresa, giro 1,5° | 640/1024 (crear) |
| Antes del taller | `aitk-taller-tallerista.jpg` (4:5, 896×1120) — tallerista preparando materiales | foto impresa, giro −1,5° | 480/896 (crear) |
| Cierre | `aitk-taller.jpg` (4:5, 896×1152) — taller de escritura con luz de tarde | foto impresa, giro −2° | 480/896 (crear) |

- No se usan `aitk-puerta-qr.jpg` (stand-up y música), `aitk-publico.jpg` (stand-up y `/organizadores`), las `aitk-acad-*` (academias) ni `aitk-seminario-*` (reservadas para seminarios): cada landing con sus fotos. La puerta aquí es el mockup del pase de lista.
- Mockups sin foto: ficha de inscripción, armador y teléfono (portada tipográfica), correo de recordatorio, pase de lista, historia de Instagram, tabla de links, código de descuento, invitación, la cuenta, web del espacio.
- Alt: *Tallerista ayudando a una alumna en el torno durante un taller de cerámica, con otras personas trabajando en la mesa*; *Tallerista con delantal ordenando herramientas y piezas de arcilla sobre la mesa antes de la clase*; *Grupo conversando alrededor de una mesa con cuadernos durante un taller de escritura*.

**Fotos reales que harían falta** (con autorización escrita de quien dicta el taller y de quienes aparecen; de los apoderados si hay menores):
1. Hero: un taller en plena clase con la tallerista ayudando a alguien y las manos trabajando en primer plano, horizontal, ≥ 2400 px, con aire a la izquierda o arriba para no competir con la ficha.
2. La mesa preparada antes de empezar (materiales, delantales, nombres), vertical 4:5.
3. Alguien mostrando su QR al llegar, o la tallerista revisando la lista en el celular (si se quiere reemplazar en algún momento el mockup del pase de lista).
4. Lo que se llevaron: piezas terminadas, el grupo al final con lo que hizo, vertical 4:5 (para el cierre o para "Después").
5. Un espacio con varios talleres (fachada, pizarra con la programación), para §4.9.
6. Testimonio: retrato de quien da la cita en su taller.

---

## 9. SEO

- **Title** (`landings.ts`): *Inscripciones para talleres en Chile: cupos, Webpay y QR · 0% de comisión | AI Tickets*
- **Description:** *Abre inscripciones para tus talleres y cursos cortos: cupos por fecha, gratis o con pago por Webpay, entrada con QR, recordatorio el día antes y lista de asistentes en el celular. 0% de comisión.*
- **H1 visible sin JS** (el del hero: "Abre inscripciones con un link. El día del taller, solo enseña."). Actualizar en `landings.ts`: `card` (`{ title: "Talleres y cursos", text: "Cupos por fecha, inscripciones gratis o pagadas y recordatorio el día antes." }` — se quita "charlas" para no pisar la futura landing de seminarios, Pregunta abierta 8), `eyebrow` (`Para talleristas y espacios que dictan talleres`), `h1`, `intro`, `highlights` (`Gratis si tu taller es gratis`, `Cupos por fecha`, `Recordatorio por correo el día antes`: el actual "antes de cada sesión" no es cierto para un curso vendido con una sola entrada) y `cta.label` (`Abrir inscripciones`). `sections: []` (como música y teatro).
- **Palabras clave a cubrir en el texto, sin forzar** (búsquedas en Chile): inscripciones para talleres, plataforma de inscripción para talleres, formulario de inscripción para taller, cobrar talleres online, vender cupos de un taller, inscripción con pago Webpay, inscripción gratis con QR, talleres presenciales, cursos cortos, talleres de cerámica en Santiago, taller de cocina, taller de fotografía, taller de escritura, talleres para adultos, talleres para niños en vacaciones de invierno, talleres de verano, lista de espera para un taller, cupos limitados, talleres en Ñuñoa / Providencia / Valparaíso / Concepción, centro cultural talleres, programación de talleres.
- **JSON-LD:** `BreadcrumbList` (AI Tickets → Para organizadores → Talleres y cursos), `SoftwareApplication` con `Offer` armada con constantes (como teatro) y `FAQPage` con `TALLERES_FAQ`.
- Imagen OG: el hero (`image={WORKSHOP_PHOTOS.hero.src}` en `Layout`).
- Links internos: `/organizadores`, `/academias`, `/ticketera-teatro`, `/entradas-con-qr`, `/ventas-por-promotor`, `/web-gratis`, `/guias/como-hacer-check-in-con-qr`, `/guias/como-vender-entradas-online`, `landing.demo.url`. Cuando exista la de seminarios, enlazarla desde la franja "Hecho para" (`¿Charlas o seminarios? →`).
- `tests/e2e/marketing.spec.ts` espera hoy `h1: /talleres/i` para esta URL: actualizarlo al H1 nuevo (`/taller/i`).

---

## 10. Analítica

Prefijo `tl_`, mismo mecanismo que `TheatreTracking.astro` (atributos `data-tl-*` + `CtaTracking`):
- `tl_view`, `tl_cta_click {position}` (`hero`, `closing`, `header`, `mobile_bar`, `espacios`), `tl_demo_click {position}`, `tl_whatsapp_click`, `tl_faq_open {question}`, `tl_section_view {section}`.
- Propios: `tl_builder_change {control, value}` (con debounce 600 ms; `control` ∈ `preset`, `format`, `seats`, `paid`, `price`, `enrolled`), `tl_builder_full` (una vez, cuando la persona llena el taller en la demo), `tl_roll_replay`, `tl_invite_audience {audience}`, `tl_calc_change {price, seats, payer, free}` (debounce), `tl_web_click` (espacios → `/web-gratis`).

---

## 11. Componentes

Carpeta `src/components/landing/talleres/`; datos y cálculos sin Node en `talleresLanding.js` (como `teatroLanding.js`): `WORKSHOP_PHOTOS`, `WORKSHOP_PRESETS`, `FORMATS`, `fakeEvent(preset, format, paid, price, seats, enrolled)` (evento sintético para `cardLabel`), `builderNotes(...)`, `PENDIENTES`, `ROLL_DEMO`, `INVITE_DEMO`, `courseReleaseText` (con `PAYOUT_RELEASE_HOURS` y el comentario que cita `ledger.ts`).

| Componente | Tipo | Notas |
|---|---|---|
| `WorkshopHeader.vue` | isla `client:idle` | patrón de `TheatreHeader` |
| `WorkshopHero.astro` | estático + CSS | H1 con destacador, foto impresa, ficha, sticker, nota, franja "Hecho para" |
| `PrintedPhoto.astro` | estático | `<picture>` con borde, clip, giro (`tilt`), pie opcional en Caveat |
| `IndexCard.astro` | estático | ficha con renglones y encabezado (prop `label`, `tilt`) |
| `Highlight.astro` | estático | `<mark class="tl-mark">` con el destacador |
| `MarginNote.astro` | estático | nota Caveat + flecha SVG (prop `arrow: "left" \| "right" \| "down" \| "curve"`), `aria-hidden` |
| `SectionTab.astro` | estático + script chico | pestaña de sección; el script marca la activa con `IntersectionObserver` |
| `PendingList.astro` | estático + script chico | hoja con los pendientes que se tachan |
| `WorkshopBuilder.vue` | isla `client:visible` | firma; usa `cardLabel`, `cardState`, `formatCLP` (`eventView.js`) y `priceQuote`; SSR con el estado inicial + `<noscript>` |
| `FormatCards.astro` | estático | fichero de formatos |
| `BeforeWorkshop.astro` | estático | foto, correo de recordatorio, ítems, burbujas |
| `ClassRoll.vue` | isla `client:visible` | pase de lista sobre la pizarra |
| `WorkshopDiffusion.astro` | estático | tres fichas (historia, links, código) |
| `InviteNextLevel.vue` | isla `client:visible` | audiencias de `INVITE_AUDIENCES`, texto de `invitationCopy` (importar la función pura si no arrastra código de servidor; si arrastra, replicar el texto por defecto con un test que compare) |
| `NotebookSum.vue` | isla `client:visible` | `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement`; cupos como multiplicador |
| `SpaceSchedule.astro` | estático | web de ejemplo del espacio + ítems |
| `WorkshopQuote.astro` | estático | no renderiza sin `WORKSHOP_TESTIMONIAL` |
| `WorkshopClosing.astro` | estático | cierre |
| `WorkshopTracking.astro` | script | eventos `tl_*` |

Compartidos sin cambios: `LandingFaq`, `LandingMobileBar` (`variant="pill"` con textos), `LandingMotion`, `CtaTracking`, `ReadingProgress` (prop `color`), `SoonBadge`, `AppFooter tone="paper"`. Cambios aditivos (anotar en el PR): `WORKSHOP_TESTIMONIAL` en `producerSocialProof.ts`; dependencias `@fontsource/bricolage-grotesque` (o `-variable`) y `@fontsource/caveat`.

Datos: `landings.ts` (entrada `ticketera-talleres` con `dedicated: true`, `sections: []`, title/description/card/eyebrow/h1/intro/highlights/cta de §9; las tres FAQ actuales se conservan), `src/data/talleresFaq.ts` (exporta `TALLERES_FAQ`; reutiliza `INVITE_AUDIENCE_TEXT` de `teatroFaq.ts` moviéndolo a un helper compartido si conviene, sin cambiar su texto).

Tests (como teatro): unitario de `talleresLanding.js` (rótulos del armador contra `cardLabel` para gratis/pagado, pocos/llenos; montos del armador y de la cuenta contra `computeFeeSplit`, incluido el multiplicador por cupos; `courseReleaseText` usa `PAYOUT_RELEASE_HOURS`) y e2e de la página (H1 visible sin JS, FAQ con JSON-LD, cuenta $25.000 × 12 → $27.380 / $25.000 / $300.000 y absorbido $22.620 / $271.440, el armador lleno muestra `Cupos llenos`/`Agotado` y el `Pronto` de la lista de espera, curso de 4 sesiones muestra el `Pronto` de pasar lista, `Pronto` presente en lo de §0.6 que se muestra, sin testimonio cuando es `null`, sin scroll horizontal en mobile, `prefers-reduced-motion` deja los pendientes tachados y el pase de lista en 9 de 10). Actualizar `tests/e2e/marketing.spec.ts` (H1 nuevo).

---

## 12. Fases (commits dentro del PR único)

1. **Página y tema:** tema `talleres`, Bricolage con fallback (y Caveat sin preload), hero estático, pendientes ya tachados, armador en su estado inicial (SSR), fichero de formatos, antes del taller, pizarra con la lista final, difusión, después, cuenta en su estado inicial, espacios, FAQ, cierre, footer; `landings.ts` con `dedicated: true`; fotos de referencia en AVIF/WebP. Criterio: `npm run check` sin errores; Lighthouse móvil ≥ 90.
2. **Interacción:** armador completo (presets, formatos, cupos, cobro, inscritos, notas), pase de lista, demo de invitación, cuenta del cuaderno, pestañas activas.
3. **Movimiento:** TL1–TL19 y `prefers-reduced-motion`; analítica `tl_*`; tests.
4. **Contenido real:** fotos reales autorizadas (§8), testimonio, taller de ejemplo real o demo (Pregunta abierta 9), nombres de ejemplo revisados.

---

## 13. Preguntas abiertas

1. **Cursos de varias sesiones (la fricción más grande del nicho):** con una sola entrada para todo el curso, el QR se valida una vez, el recordatorio automático solo sale antes de la primera sesión y el dinero se libera con la última función del evento. ¿Entran al roadmap la **asistencia por sesión** (una entrada que se valida una vez por función) y el **recordatorio de cada sesión** para entradas de todas las funciones? Mientras no, la página recomienda "un evento por curso" y marca `Pronto` en pasar lista por sesión.
2. **Liberación y pase de lista:** `ledger.ts` libera cada función con ≥ 30% de check-ins o con la acreditación del productor (abonos: acreditación del evento). ¿Se explica en la página que escanear los QR también deja registrado que el taller se hizo? Hoy la página solo dice `PAYOUT_SCHEDULE_TEXT` + `TERMS_NOTE`.
3. **Preguntas al inscribirse** (nivel, edad, alergias, talla, nombre de cada participante): es lo que más piden talleres y talleres de niños. ¿Se hace? Va como `Pronto` en §4.4; si no está en el plan, quitar el ítem y dejar solo la FAQ 9.
4. **Lista de espera:** la página guarda los correos (`aitickets_event_waitlist`) pero nadie los ve. ¿Se muestra en el panel (y se exporta) aunque el aviso automático tarde más? Es barato y en talleres de 10 cupos es la mitad del valor.
5. **Umbral de "Últimas entradas":** `stockSummary` marca "pocas" con ≤ 10 o ≤ 15%: un taller pagado de 8 a 10 cupos muestra "Últimas entradas" desde la primera inscripción, y en pagados dice "entradas", no "cupos". ¿Se usa "Quedan N cupos" también en eventos pagados chicos (umbral relativo)? El armador muestra lo que hay hoy (usa `cardLabel`).
6. **"Entradas" vs "cupos":** el sticker de la serie de Instagram dice "Quedan N entradas" (`socialSeriesRender.ts`). ¿Se adapta el vocabulario a "cupos" para eventos gratis o marcados como taller? Hasta entonces, el mockup de §4.6 dice "entradas".
7. **Reseñas mientras hay fechas futuras:** en un taller semanal de varios meses no se ven nunca hasta la última fecha. Mismo tema que la Pregunta abierta 2 de teatro.
8. **Talleres vs seminarios:** la tarjeta actual dice "Talleres y charlas". Con la landing de seminarios en camino, ¿las charlas van allá? Esta spec ya quita "charlas" de la tarjeta y del SEO; revisar la tabla de identidades de §1 cuando existan las specs de clubs, fiestas y seminarios para que ninguna repita paleta (cuadrícula azul, destacador, pizarra), tipografía de acento (Bricolage, Caveat), forma (fichas, fotos impresas, botones de cartón) ni firma (armador, pase de lista, pendientes tachados).
9. **Taller de ejemplo:** no hay un evento demo de taller (`demoEvent.mjs` tiene stand-up, concierto, feria, gratis, gira y teatro). Mientras no exista, "Ver un taller de ejemplo" lleva a `/eventos/evento-demo-gratis` con el texto actual `Ver una inscripción gratuita de ejemplo`. ¿Se crea `evento-demo-taller` (migración como la de teatro: pagado, 4 sábados, 10 cupos por fecha, una entrada "Curso completo" y una "Clase suelta")? Solo con el visto bueno del dueño.
10. **Nombres de ejemplo:** "Torno para principiantes", "Javiera M.", "Taller ejemplo", "Pastas frescas en casa", "Tomás R.", "Antonia P.", "Diego S.", "Torno nivel 2", "EXALUMNOS15", "espacio-ejemplo" y la lista del pase de lista: revisar que no existan talleres o espacios chilenos con esos nombres antes de publicar.
11. **Tipografías:** confirmar con el dueño Bricolage Grotesque (alternativas: Familjen Grotesk, Schibsted Grotesk) y el uso acotado de Caveat (alternativa: sin manuscrita, notas en Prompt 600 azul). Debe quedar distinta de Unbounded/Fraunces, Anton y Bodoni Moda, y no usarse en cursiva.
12. **Lo que no se muestra:** certificados de asistencia, pago en cuotas, transferencia/efectivo, reparto automático espacio/tallerista, cupo mínimo que cancela solo, clases online con link de videollamada. ¿Alguno entra al roadmap? Si entra, se agrega como `Pronto` en la sección que corresponda (certificados en "Después", reparto en "Espacios").
13. **Fotos reales y testimonio:** ¿qué tallerista o espacio que use AI Tickets puede aportar fotos de clase, de la mesa preparada y de lo que se llevaron, y la primera cita? (§8)

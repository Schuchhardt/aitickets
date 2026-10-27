# AI Tickets — Landing especializada para teatro

**Para:** Claude Code (implementación)
**Ruta:** `/ticketera-teatro` (ya existe como landing genérica en `src/data/landings.ts`, generada por `[landing].astro`). **Se mantiene la URL**: la entrada de `landings.ts` pasa a `dedicated: true` y la página propia vive en `src/pages/ticketera-teatro.astro`, igual que `/ticketera-stand-up` y `/ticketera-musica-en-vivo`. La tarjeta, el sitemap, las relacionadas y "Según lo que produces" de `/organizadores` siguen leyendo de `landings.ts`; el footer ya enlaza `Teatro` a esta URL (`AppFooter.vue`).
**Público:** compañías de teatro independiente y salas (black box, centros culturales, salas de barrio), y las productoras que las representan. Su realidad: **temporadas** de 8 a 30 funciones (jueves a domingo durante semanas), estreno con prensa e invitados, precios por función (estreno, estudiante, adulto mayor, jueves popular), funciones para colegios, reposiciones, giras cortas y salas que programan a varias compañías.
**Promesa:** *Que suba el telón. La boletería de tu obra ya está lista.* Una obra con todas sus funciones, cada una con su aforo; cortesías de prensa con QR; la puerta de cada noche ordenada; y lo de cada función disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina, para pagar sala, técnica y elenco mientras la obra sigue en cartelera.
**Métrica:** visitas → cuentas creadas → primera obra publicada **con 2 o más funciones**, comparada con `/organizadores` y con la landing genérica anterior (mismo slug, antes y después).
**Prototipo:** no hay artboard. Esta spec define layout, copy y comportamiento; si después se dibuja un prototipo y difiere, manda este documento.
**Reutiliza** de `SPEC_landing_productores_aitickets.md`: fórmula de precio (§5.3), header sticky (§4), accesibilidad (§9), analítica base (§11). De la implementación de stand-up, academias y música (en el repo): `LandingFaq`, `LandingMobileBar`, `LandingMotion` (`data-lp-reveal` / `data-lp-step`, clase `html.lp-motion`), `CtaTracking`, `ReadingProgress` (prop `color`), `priceQuote` y `formatCLP` (`producerLanding.js`), `usePayerToggle`, `useDelayedAnnouncement`, `SoonBadge`, el patrón `photo()` de `musicaLanding.js` y el de FAQ con `pick`/`reword` de `musicaFaq.ts`. **No reutiliza** su lenguaje visual: nada de serif cursiva (stand-up, academias), nada de Anton, mono, duotono, sellos ni talones perforados (música), nada de mapa de asientos (stand-up), nada de comparador antes/después (academias).

---

## 0. Antes de empezar (Claude Code)

1. **Tema propio** `[data-theme="teatro"]` en `src/styles/landing-teatro.css`, con scope y prefijo `te-`, sin tocar los tokens globales. Debe verse distinto de las otras tres landings: ver la tabla de §1.
2. **Dinero y plazos salen del código**, nunca escritos a mano: `SERVICE_FEE_PERCENT_LABEL`, `IVA_PERCENT_LABEL`, `SERVICE_FEE_LABEL`, `SERVICE_FEE_TAX_LABEL`, `SERVICE_FEE_NOTE`, `computeFeeSplit` (netlify/lib/fees.mjs, vía `priceQuote`); `PAYOUT_RELEASE_HOURS`, `PAYOUT_BUSINESS_DAYS`, `PAYOUT_SCHEDULE_TEXT`, `PAYOUT_SHORT_TEXT` (netlify/lib/legal.mjs); `ABSORB_FEE_ACTIVATION`, `MAX_EVENT_FUNCTIONS`, `TERMS_NOTE` y `PRODUCER_FAQ` (src/data/producerFaq.ts); `DEFAULT_MAX_PER_PURCHASE` (Reservation/pricing.js); `REVIEW_REQUEST_DELAY_HOURS`, `REVIEW_REQUEST_WINDOW_HOURS`, `MAX_PHOTOS_PER_PERSON`, `INVITE_AUDIENCES` (netlify/lib/reviews.mjs); `DEFAULT_CADENCE`, `DEFAULT_KEYWORD` (src/lib/socialSeriesCadence.ts). En esta spec los montos aparecen como `{…}` o con su valor actual solo para verificar.
3. **Hallazgo que hay que resolver antes de publicar (dinero):** `netlify/lib/event-risk.mjs` calcula el aforo de un evento como la **suma de los cupos de todas sus entradas** (`ticketCapacity = Σ total_quantity`). Una temporada de 16 funciones con 80 cupos cada una suma 1.280 > `LARGE_CAPACITY` (1.000): el evento recibe la señal `large_capacity` (pide documentos y, con nivel medio o alto, deja entre `RESERVE_BY_LEVEL.medium`% y `RESERVE_BY_LEVEL.high`% de lo vendido como reserva hasta `RESERVE_HOLD_DAYS` días). Eso contradice en la práctica la promesa central de esta página ("cobras cada función"). **No se cambia el código en este paso**: la página usa `PAYOUT_SCHEDULE_TEXT` + `TERMS_NOTE` (lo que dice el código), y se deja como Pregunta abierta 1 (propuesta: medir el aforo como el máximo por función, no la suma). Anotarlo en el PR.
4. **"Pronto"**: todo lo de §0.6 que se muestre lleva `SoonBadge` (`dark` sobre fondos oscuros). Nunca se dibuja como si funcionara.
5. **Verificado en el código (se puede prometer):**
   - **Varias funciones en una obra**: hasta `MAX_EVENT_FUNCTIONS` (60) funciones, cada una con fecha, hora y lugar (`schedule.ts`, `EditEventForm.vue`). Si cambias fecha u horario de un evento publicado, se avisa por correo a quienes compraron (`PRODUCER_FAQ`).
   - **Aforo por función**: un tipo de entrada amarrado a una función (`event_tickets.event_date_id`) tiene su propio cupo; una entrada "Todas las funciones" comparte su cupo entre todas las fechas (texto del propio formulario, `EditEventForm.vue` paso 3). Precio propio por función (estreno, jueves popular) con el mismo mecanismo.
   - **Lo que ve el público** (`eventView.js` `functionListModel` / `checkoutFunctions` / `ticketRowsFor`, `EventSections.vue`): lista de funciones agrupada por mes cuando son más de 8, estados `Disponible` / `Últimas` / `Agotada`, "Desde $X" si esa función tiene otro precio, `Ver las N funciones`, y en el checkout se elige función y luego entradas (solo aparecen las de esa función y las válidas para todas). Precio mostrado con cargo incluido.
   - **Cortesías** desde el panel (`CourtesyTicketsForm.vue`, `src/lib/courtesy.ts`): nombre, correo, tipo de entrada (que puede ser de una función) y cantidad hasta `MAX_COURTESY_PER_REQUEST` (50). Llevan su propio QR, **no cuentan como venta** y **pueden superar el cupo** a propósito ("las decide el productor").
   - **Lista de invitados** con acompañantes y envío del link por correo o armado de links de WhatsApp (`tools/guests.ts`): **hoy solo desde el asistente de IA conectado** (no hay pantalla en el panel).
   - **Vista previa privada** de la página antes de publicar, con link que vence (1 h a 1 año) o de un solo uso (`/api/events/preview-links`, `eventPreview.ts`), desde el panel.
   - **Links con seguimiento** por persona, medio o campaña y ventas por canal en las métricas (`TrackingLinkBuilder.vue`, `eventAnalytics.ts`); la venta se asocia si compra en la misma visita (`PRODUCER_FAQ`). Reporte semanal por correo (`weekly-report-send.mjs`).
   - **Recordatorio automático** por correo el día antes de cada función a quienes tienen entrada **para esa función** (y a los de "todas las funciones" solo antes de la primera próxima) (`send-event-reminders`).
   - **Check-in** con QR desde el celular, sin señal con sincronización, entrada usada no vuelve a entrar, contador de validadas, búsqueda por nombre y reenvío (`ValidateQR.vue`, `/api/orders/resend`). **Aviso "Esta entrada es para otra función"** con opción de validarla igual (`ValidateQR.vue`, R1). Rol Puerta (`permissions.ts`); link de puerta sin cuenta que vence solo (`/puerta/<token>`, hoy desde el asistente de IA, `tools/access.ts`).
   - **Equipo**: roles Administrador, Finanzas, Marketing, Puerta, Solo lectura (`ROLE_LABELS`). Limitar a un miembro a ciertos eventos (`assign_event_staff`): **hoy solo desde el asistente de IA** (el panel de equipo no lo tiene).
   - **Instagram automático** (`socialSeries.ts`): la serie cuenta hacia la **próxima función** y, cuando una pasa, se reprograma hacia la siguiente (`reconcileSeries`, `anchor_starts_at`); con funciones cada semana, la próxima siempre está a menos de `daily_from_days` días, así que la historia sale **diaria** durante la temporada; posts de feed diarios de D-`feed_posts_from_days` a D-`feed_posts_to_days` si se activan; DM con el link a quien responde `DEFAULT_KEYWORD`; termina sola después de la última función.
   - **Anuncios** en Instagram y Facebook vía Zernio con la cuenta publicitaria de Meta del productor (`zernio-ads.mjs`, `ORGANIZADORES_FAQ`).
   - **Video de portada** de la página (`eventVideo.ts`) y **asistente de la página del evento** que responde horarios, lugar, edad mínima, etc. con lo que cargó el productor (`EventAssistant.vue`, `netlify/functions/ai-assistant`); preguntas frecuentes del evento generadas con IA desde el panel (`/api/events/ai`, `event_faqs`).
   - **Reseñas**: correo entre `REVIEW_REQUEST_DELAY_HOURS` y `REVIEW_REQUEST_WINDOW_HOURS` h **después de cada función**, estrellas, comentario y hasta `MAX_PHOTOS_PER_PERSON` fotos; el productor las ve en el panel (`EventReviewsManager.vue`) y puede premiar con un código `GRACIAS-` para sus próximos eventos. **En la página pública se muestran cuando el evento terminó** o a quien llega con el link del correo (`EventDetail.vue`, `showReviews`): **no** mientras la obra sigue en cartelera.
   - **Invitar al público a la próxima obra** con un correo, a `INVITE_AUDIENCES` (todos, quienes entraron, quienes calificaron, quienes calificaron con 4 o 5) (`invitations.ts`, `reviews.mjs`), desde el panel.
   - **Duplicar** la obra para una reposición: copia datos, lugares, tipos de entrada y preguntas; **no** copia las funciones (`eventDuplicate.ts`).
   - **Descuentos**: % o monto, usos máximos, límite por comprador, inicio y término; aplican al subtotal del evento entero o a todos los de la productora (`discounts.mjs`). **No** se pueden limitar a una función ni a un tipo de entrada.
   - **Máximo por compra** `DEFAULT_MAX_PER_PURCHASE` (10) por tipo de entrada; se sube hasta 50 desde el asistente de IA (`tools/tickets.ts`, `max_per_order`) o por WhatsApp.
   - **CSV de órdenes** por evento desde el panel (`/api/events/orders-csv`: fecha, entradas, montos, cortesía, ref/UTM).
   - **Web gratis** de la compañía o sala con su cartelera en `aitickets.cl/o/<slug>` y plantillas `clasico`, `nocturno`, `minimal`, `festival` (`sites.ts`, `/web-gratis`).
   - **Funciones gratis** (ensayo abierto, función a beneficio sin cobro): inscripción con QR, sin cargo (`RsvpForm.vue`).
6. **No existe (no prometer; `Pronto` si se muestra):** generar funciones repetidas ("jueves a domingo por 4 semanas") en un paso; copiar un tipo de entrada a cada función en un paso; **reseñas visibles en la página mientras la obra sigue en cartelera**; vista de ocupación por función en el panel (hoy se ve "emitidas / cupo" por tipo de entrada); **borderó por función** para liquidar con la sala (porcentaje sala/compañía); Facebook, TikTok y reels en la serie automática; aviso automático a la lista de espera (no se muestra); descuentos por función (se resuelve con un tipo de entrada más barato amarrado a esas funciones); **butacas numeradas** (no se muestra como Pronto: se dice que no hay); venta en efectivo en boletería; pago "a la gorra".
7. **Fotos:** las de `public/landing/` son de referencia generadas con IA. En producción van fotos reales de funciones de compañías o salas que usen AI Tickets, con autorización escrita (elenco, sala y, si se reconoce, público). Mientras no existan, se usan las de referencia con el mismo bloqueo de publicación que stand-up y música (anotarlo en el PR). Lista en §8. **No se generan imágenes nuevas.**
8. **Testimonio:** solo una cita real (nombre, compañía o sala, ciudad, foto autorizada). Si no hay (`THEATRE_TESTIMONIAL = null` en `producerSocialProof.ts`), la sección no se renderiza.
9. **Nombres de ejemplo** (obra, compañía, sala, personas): ficticios, y cada card con datos dice `ejemplo`. Antes de publicar, buscar que no coincidan con obras, compañías o salas chilenas reales (Pregunta abierta 9).
10. Las fases (§12) son commits dentro del PR único del rediseño (ver `README.md`): `rediseno(teatro): landing especializada`.

---

## 1. Sistema visual propio: "programa de mano y luz de sala"

La referencia es la noche de estreno en una sala independiente: la sala a oscuras en azul noche, **un solo foco cálido** sobre el escenario, el **telón de terciopelo**, el **programa de mano** impreso en marfil con su reparto de líneas de puntos, los dorados viejos del palco y las **tres llamadas** antes de empezar. Composición **simétrica y centrada**, como un escenario a la italiana; la página se ordena en **actos**.

| | Stand-up | Academias | Música en vivo | **Teatro** |
|---|---|---|---|---|
| Fondo | negro cálido `#0E0B09` | papel cálido `#FBF7F0` | negro frío `#0A0A0D` + papel de afiche + rojo a sangre | **azul noche de sala `#0C1220`** + un bloque de **terciopelo burdeo** (entreacto) + **marfil de programa** (precio) |
| Acento | lima + crema | tinta + café serif | rojo de sala `#FF3B30` | **dorado de palco `#D4AF6A`** (ornamentos, números romanos, estrellas, líneas) y **luz de foco** (gradiente, nunca texto); lima solo en acciones |
| Titulares | Unbounded + Fraunces cursiva | Unbounded + Fraunces cursiva | Anton condensada, mayúsculas | **Bodoni Moda redonda (Didone de alto contraste), en caja baja y alta**; énfasis con **dorado** o con **versalitas espaciadas**, **nunca cursiva** |
| Metadatos | sans | sans | mono del sistema | **Prompt en mayúsculas espaciadas (.24em)** entre filetes dorados; numerales Bodoni para fechas y cifras |
| Radios / formas | 18–28 px, pill | 24–32 px | 0 px, talones perforados | **arco de proscenio** (fotos y marcos con arco solo arriba), **doble filete dorado**; cards 10 px; botones 999 px solo el CTA lima, el resto rectos de 8 px |
| Fotos | color cálido con overlay | color con sombra cálida | duotono rojo + grano | **color con viñeta de foco** (el centro iluminado, los bordes se funden al azul noche), `saturate(.85)` |
| Ritmo | capítulos foto/texto alternados | comparador y pasos | cortes duros con numeración "01 —" | **actos**: Obertura → Reparto → Acto I → Acto II → Entreacto → Acto III → Programa → Telón; cada acto se abre con un foco que se enciende sobre el título |
| Firma interactiva | mapa de sala que se llena | antes/después del chat | curva de venta + tandas con sello | **"La temporada": cartelera de 16 funciones que avanza con un fader de consola de luces** + **las tres llamadas** |

```css
[data-theme="teatro"] {
  --te-sala: #0C1220;            /* fondo principal (azul noche de sala) */
  --te-sala-2: #131B2D;          /* secciones alternas, cards */
  --te-sala-3: #1C2740;          /* inputs, chips, filas */
  --te-sala-off: #070A12;        /* "se apaga la sala" (Acto III) */
  --te-line: rgba(240, 232, 216, 0.12);
  --te-line-strong: rgba(240, 232, 216, 0.22);
  --te-text-1: #F0E8D8;          /* marfil */
  --te-text-2: #C9C1B1;
  --te-text-3: #A49D8E;          /* meta, eyebrows (≈ 6,8:1 sobre sala) */
  --te-oro: #D4AF6A;             /* dorado de palco (≈ 9:1 sobre sala) */
  --te-oro-ink: #7A5A1E;         /* dorado para texto sobre marfil (AA) */
  --te-velvet: #5A1426;          /* terciopelo (entreacto, telón) */
  --te-velvet-2: #3E0C1A;        /* pliegue oscuro del terciopelo */
  --te-programa: #F4EEE2;        /* marfil del programa de mano */
  --te-programa-2: #E8E0D0;      /* controles sobre marfil */
  --te-ink: #161A24;             /* texto sobre marfil */
  --te-ink-2: #444A57;
  --te-ink-3: #5E6370;           /* meta sobre marfil (≥ 5:1) */
  --te-foco: rgba(255, 233, 184, 0.22); /* luz de foco (solo en gradientes) */
  --te-display: "Bodoni Moda", "Bodoni Moda Fallback", "Bodoni 72", Didot, "Bodoni MT", Georgia, serif;
  --brand-lime: (lima de marca);
  /* puente a los tokens que leen LandingFaq, LandingMobileBar, SoonBadge (como en academias y música) */
  --surface-0: var(--te-sala); --surface-1: var(--te-sala-2); --surface-2: var(--te-sala-3);
  --text-1: var(--te-text-1); --text-2: var(--te-text-2); --text-3: var(--te-text-3);
  --border: var(--te-line); --border-strong: var(--te-line-strong);
}
```

**Reglas de color**
- **Dorado** (`--te-oro`): números de acto (`ACTO I`), filetes y ornamentos, líneas de puntos del reparto, la segunda parte de los titulares, estrellas de reseñas, el cabezal del fader. Sobre marfil se usa `--te-oro-ink`.
- **Luz de foco**: solo como gradiente radial (`radial-gradient(ellipse 60% 70% at 50% 0%, var(--te-foco), transparent 70%)`) sobre la parte alta de cada acto y del hero. Nunca como color de texto ni de fondo plano.
- **Terciopelo**: solo en el Entreacto (§4.6), en las piernas del telón del hero y del cierre, y en el chip `Agotada` de la cartelera. Texto marfil encima (≈ 10:1).
- **Lima**: botones primarios, `✓ Válida`, `Lista para retirar`, el monto "La compañía recibe". Nunca lima junto a dorado en piezas de menos de 24 px (se separan con marfil o con espacio).

**Tipografía**
- **Bodoni Moda** (Google Fonts, OFL; `@fontsource/bodoni-moda` 500 y 700 o `@fontsource-variable/bodoni-moda` eje `wght`; elegir la opción de menor peso total, objetivo < 60 KB, solo `latin`, `font-display: swap`). La página la precarga con el slot `head-extra` de `Layout.astro` (ya existe, lo agregó música). Fallback con métricas ajustadas, igual que Anton en música: `@font-face { font-family: "Bodoni Moda Fallback"; src: local("Bodoni 72"), local("Didot"), local("Georgia"); size-adjust: …; ascent-override: …; }`.
- Titulares en Bodoni Moda 500, caja baja y alta, tracking −0,01em; el H1 en 700. La segunda parte del titular va en `--te-oro` (misma fuente, redonda). Énfasis alternativo: **versalitas falsas** (Bodoni 500 en mayúsculas al 72% con tracking .12em) para palabras sueltas, p. ej. `ACTO II`.
- **Prohibido**: `font-style: italic` en toda la página (es la firma de stand-up y academias) y letra calada (música).
- Cuerpo: Prompt (la sans actual) 400/500. Eyebrows: Prompt 600, 13 px, mayúsculas, tracking .24em, `--te-oro`, centrados entre dos filetes dorados de 40 px con un rombo de 5 px al medio (`—— ◆ ACTO I ◆ ——`, el rombo es CSS, `aria-hidden`).
- Cifras (contadores, fechas grandes, precios del programa): Bodoni Moda con `font-variant-numeric: lining-nums tabular-nums`.
- **Escala desktop:** H1 104/104 (segunda línea 72/80), H2 64/68, H3 32/38, cuerpo 18/29. **Mobile:** H1 48/50 (segunda línea 34/40), H2 36/40, H3 24/30, cuerpo 16/25. Bodoni nunca bajo 20 px (los filetes finos desaparecen).

**Recursos gráficos**
- **Arco de proscenio**: fotos y marcos con `border-radius: 50% 50% 0 0 / 22% 22% 0 0` (arco solo arriba) y, adentro, un doble filete dorado (pseudo-elemento `inset: 10px`, borde 1 px `--te-oro` al 60%, mismo radio). En mobile el arco baja a `/ 14%`.
- **Viñeta de foco** sobre las fotos: `radial-gradient(ellipse at 50% 35%, transparent 35%, var(--te-sala) 95%)` encima del `<picture>` + `filter: saturate(.85)`. Sin procesar archivos.
- **Telón de terciopelo**: piernas laterales y bambalina (franja de 48 px arriba) con CSS puro: `repeating-linear-gradient(90deg, var(--te-velvet-2) 0 14px, var(--te-velvet) 14px 30px, var(--te-velvet-2) 30px 44px)` + un gradiente vertical de sombra. Sin imágenes. Decorativo (`aria-hidden`).
- **Líneas de puntos de reparto** (programa de mano): `Rol ········· Quién`, con `border-bottom: 2px dotted` dorado en un `flex: 1` entre los dos textos, alineado a la línea base.
- **Ornamento**: rombo de 5 px y filetes de 1 px. Iconos: los del sitio (lucide), trazo 1.5. Nada de máscaras de teatro (comedia/tragedia) ni clip-art; nada de logos de Instagram, Facebook ni de salas reales.
- **Numeración de actos**: `OBERTURA`, `REPARTO`, `ACTO I`, `ACTO II`, `ENTREACTO`, `ACTO III`, `PROGRAMA`, `TELÓN` como eyebrow de cada sección; las escenas internas como `ESCENA 1`, `ESCENA 2`.

---

## 2. Estructura

| # | Sección | Fondo | Ancla |
|---|---|---|---|
| 1 | Obertura (hero con foto, telón y cartelera de ejemplo) | foto + viñeta + telón | |
| 2 | Reparto (quién hace qué, como programa de mano) | sala | `#reparto` |
| 3 | Acto I · Antes del estreno (funciones, entradas, prensa, elenco) | sala-2 | `#obra` |
| 4 | Acto II · La temporada (firma: fader) | sala | `#temporada` |
| 5 | Entreacto · Tu obra no descansa (difusión) | **terciopelo** | `#difusion` |
| 6 | Acto III · La noche de la función (tres llamadas, puerta) | sala → sala-off | `#puerta` |
| 7 | Programa · Precio (calculadora en programa de mano) | **marfil** | `#precio` |
| 8 | Para salas (cartelera web, compañías) | sala-2 | `#salas` |
| 9 | La crítica (testimonio, solo si es real) | sala | |
| 10 | Preguntas frecuentes | sala | |
| 11 | Telón (cierre con foto en arco) | sala + telón | |
| 12 | Footer (`AppFooter tone="sala"`, ver §11) | sala | |

---

## 3. Header y progreso

- `TheatreHeader.vue` (patrón de `MusicHeader.vue` / `StandupHeader.vue`): `position: fixed`, transparente sobre el hero; tras 40 px de scroll, `rgba(12,18,32,.86)` + `backdrop-filter: blur(14px)` + filete inferior dorado al 25%.
- Logo · links `La obra` (`#obra`) · `Temporada` (`#temporada`) · `Puerta` (`#puerta`) · `Precio` (`#precio`) · `Ingresar` · botón lima pill `Publicar mi obra`.
- **Barra de progreso de lectura**: `ReadingProgress` con `color="var(--te-oro)"`, 2 px.
- Mobile: logo + botón de menú circular 44×44 con borde dorado. `LandingMobileBar variant="pill"` con `title="Gratis para publicar"`, `subtitle="0% de comisión para la compañía"`, `ctaLabel="Publicar obra"`; aparece después del hero y se oculta en el cierre (comportamiento existente).

---

## 4. Secciones (copy es-CL completo)

### 4.1 Obertura (hero)
- Altura `min(100svh, 940px)` desktop. Foto `aitk-teatro-funcion` (black box, un foco, público de espaldas) a sangre, `object-position: 50% 30%`, viñeta de foco. Encima, **telón**: bambalina de 48 px arriba y dos piernas laterales de terciopelo (9vw cada una en desktop, ocultas en mobile).
- Contenido **centrado** en el tercio inferior, sobre gradiente `--te-sala` (de 0 a 92% hacia abajo):
  - Eyebrow: `—— ◆ PARA COMPAÑÍAS DE TEATRO Y SALAS ◆ ——`
  - H1 (Bodoni 700): **Que suba el telón.** / segunda línea en `--te-oro`, 72 px: **La boletería de tu obra ya está lista.**
  - Bajada (armada con constantes): *Publica la obra una vez con todas sus funciones, deja que tu público elija la suya, manda las cortesías de prensa con su QR y cobra cada función `{PAYOUT_RELEASE_HOURS}` horas después de que termina. 0% de comisión para la compañía.*
  - CTAs centrados: lima pill `Publicar mi obra →` (`landing.cta.label`, `publishUrl("teatro_hero")`, `data-hero-cta`) · botón recto con filete dorado `Ver una obra de ejemplo` (`landing.demo.url` = `/eventos/evento-demo-teatro`).
  - Microcopy (Prompt 13, `--te-text-3`): `Sin mensualidad · Sin permanencia · {SERVICE_FEE_NOTE} lo paga el público`.
- **Marquesina de funciones** (debajo de los CTAs, ancho máx. 880 px, `--te-sala-2` al 88% con blur, filete dorado arriba y abajo, etiqueta `Temporada de ejemplo` a la izquierda): cuatro funciones en fila, con los mismos estados que la página real:
  - `JUE 5 NOV · 20:30` — `Estreno` — chip terciopelo `Agotada` (texto tachado)
  - `VIE 6 NOV · 20:30` — chip dorado contorno `Últimas`
  - `SÁB 7 NOV · 20:30` — `Disponible`
  - `DOM 8 NOV · 19:00` — `Disponible`
  - Al final: `y 12 funciones más →` (ancla a `#temporada`).
  - Fechas en Bodoni 22 px; estados en Prompt 13. Obra de ejemplo arriba, centrado: `Marea baja · Compañía La Grieta · Sala ejemplo, Santiago` (Pregunta abierta 9).
- **Mobile:** foto 4:5 recortada (`object-position: 52% 30%`) a 62svh con viñeta, sin piernas de telón (solo la bambalina de 28 px); texto debajo sobre `--te-sala`, centrado; CTAs a ancho completo; la marquesina pasa a una lista vertical de 3 funciones (sin la del domingo) + `y 13 funciones más →`.

### 4.2 Reparto (ancla `#reparto`)
- Eyebrow `—— ◆ REPARTO ◆ ——`; H2 centrado **Cada uno en su papel.** / en oro **La boletería, en el nuestro.**
- **Programa de mano** centrado (ancho 720 px, Bodoni 26 px para los roles, Prompt 18 px para quién), con líneas de puntos doradas. Cada fila es un link a su escena:

| Rol (Bodoni) | ······ | Quién (Prompt) | Lleva a |
|---|---|---|---|
| La boletería | | AI Tickets, las 24 horas | `#obra` |
| Las funciones | | Hasta `{MAX_EVENT_FUNCTIONS}`, cada una con su aforo | `#obra` |
| La prensa | | Cortesías con su QR | `#prensa` |
| La difusión | | Tu Instagram, todos los días de la temporada | `#difusion` |
| La puerta | | Tu equipo, con el celular | `#puerta` |
| La plata | | Tu cuenta, función por función* | `#precio` |
| El público | | Invitado a tu próxima obra | `#temporada` |

- Nota al pie: `*` + `TERMS_NOTE`.
- Debajo, en una línea de chips con filete dorado (no clickeables): `Teatro independiente · Salas · Microteatro · Teatro familiar · Funciones para colegios · Festivales · Giras`. Link aparte: `¿Escuela o academia de teatro? Mira la página para muestras →` (`/academias`).
- **Microinteracción:** al pasar el mouse o enfocar una fila, la fila "se ilumina" (fondo con `--te-foco` en elipse detrás, rol a `--te-oro`) y sus puntos se recorren de izquierda a derecha (`background-position` en el patrón punteado, 600 ms). En táctil, el foco queda en la fila tocada antes de navegar.
- Es una tabla semántica (`<dl>` con `<dt>`/`<dd>`), legible sin JS.
- **Mobile:** roles en Bodoni 22 px, quién debajo en Prompt 15 px (sin línea de puntos, con filete dorado corto entre filas); chips en scroll horizontal.

### 4.3 Acto I · Antes del estreno (ancla `#obra`)
- Eyebrow `—— ◆ ACTO I ◆ ——`; H2 **Una obra.** / en oro **Todas sus funciones.**; bajada centrada: *Publicas la temporada una sola vez. Tu público elige su función en la misma página y recibe su entrada para esa fecha.*

**Escena 1 · La temporada en una tarde** (grid desktop `5fr 6fr`: texto a la izquierda, mockup a la derecha)
- Eyebrow `ESCENA 1`; H3 **Cada función con su aforo, cada entrada con su precio.**
- Texto: *Agrega hasta `{MAX_EVENT_FUNCTIONS}` funciones, cada una con su fecha, su hora y, si sales de gira, su sala. Para que cada función tenga su propio aforo, creas sus entradas amarradas a esa función; una entrada "para todas las funciones" comparte el cupo entre todas. Así el estreno puede tener su precio y los jueves, uno popular.*
- Chips (filete dorado): `Aforo por función` · `Precio de estreno` · `Estudiante y adulto mayor` · `Jueves popular` · `Si cambias un horario, avisamos a quienes compraron` · `Repetir funciones de jueves a domingo` + `Pronto` · `Copiar las entradas a cada función` + `Pronto`.
- **Mockup "Así lo ve tu público"** (`FunctionPicker.vue`, card `--te-sala-3`, radio 10, etiqueta `Página de tu obra · ejemplo`). Reproduce la sección "Funciones" real (§4.9b de la spec de evento) con la piel del tema:
  - Encabezado `Noviembre`; filas: `Jue 5 nov · 20:30` `Agotada` (atenuada, tachada, sin botón) · `Vie 6 nov · 20:30` `Últimas` `Elegir` · `Sáb 7 nov · 20:30` `Disponible` `Elegir` · `Dom 8 nov · 19:00` `Disponible` `Elegir` · `Jue 12 nov · 20:30` `Desde {formatCLP(priceQuote(6000).buyer)}` `Disponible` `Elegir` · botón `Ver las 16 funciones`.
  - Al tocar `Elegir`, la card se desliza (crossfade + `translateX 24px`) al paso "Entradas" de esa función, con el precio final con cargo (`priceQuote`, como el checkout real): `General · {final(10000)}`, `Estudiante y adulto mayor · {final(7000)}`; si la función es jueves, además `Jueves popular · {final(6000)}`; si es el estreno (no elegible porque está agotado), no aplica. Debajo, en 13 px: *Precio final con cargo por servicio incluido.* Botón `← Funciones` para volver. Es una demo: no hay compra.
  - Valores de verificación (computeFeeSplit): $10.000 → $10.952; $7.000 → $7.666; $6.000 → $6.571.
  - Accesible: lista de botones con `aria-label="Elegir función del viernes 6 de noviembre a las 20:30, últimas entradas"`; el paso de entradas es una región `aria-live="polite"`.
- Nota bajo el mockup (13 px): *No hay butacas numeradas: si separas platea y galería, cada una es un tipo de entrada con su cupo.*

**Escena 2 · Prensa e invitados** (ancla `#prensa`; grid `6fr 5fr`: foto a la izquierda, texto a la derecha)
- Foto `aitk-teatro-ensayo` (ensayo con la directora dando notas) en arco de proscenio 4:5, viñeta de foco. Encima, abajo a la derecha, **pase de prensa** (card marfil 260 px, rotada −2°, texto tinta, cordón dibujado con dos líneas finas desde arriba):
  - `PASE DE PRENSA · EJEMPLO` (Prompt 600 11 px, `--te-oro-ink`)
  - Bodoni 26: `Marea baja`
  - `Vie 6 nov · 20:30 · 2 entradas`
  - `Cortesía · no cuenta como venta`
  - Cuadrito tipo QR decorativo **que no es un QR válido** (`aria-hidden`).
- Eyebrow `ESCENA 2`; H3 **La prensa entra con su QR.** / en oro **Y tú sabes quién vino.**
- Ítems (rombo dorado + título Prompt 600 + texto):
  1. **Cortesías en un minuto.** Nombre, correo y cuántas entradas: la crítica y su acompañante. Si eliges la entrada de una función, la cortesía es para esa noche. No cuentan como venta y salen aunque la función esté llena: eso lo decides tú.
  2. **Lista de invitados con acompañantes.** Arma la lista del estreno y mándales el link por correo o por WhatsApp. Hoy se hace desde tu asistente de IA conectado.
  3. **La página, antes que nadie.** Comparte una vista previa privada con la sala o con la prensa antes de abrir la venta, con un link que vence solo.
- **Mobile:** foto 4:5 a ancho completo con el pase abajo, sin rotación; ítems debajo.

**Escena 3 · El elenco también vende** (franja compacta, centrada, sin foto)
- Eyebrow `ESCENA 3`; H3 **Un link para cada integrante del elenco.**
- Texto: *Y otro para la sala, para el medio que te entrevistó o para tu campaña. En las métricas de la obra ves cuántas entradas trajo cada uno, comparado con la venta directa. La venta se asocia al link cuando la persona compra en la misma visita.*
- Mini tabla `Ventas por link · ejemplo` (4 filas con barra dorada horizontal; la mayor en `--te-text-1`): `Elenco · Catalina` 46 · `Sala ejemplo` 31 · `Radio ejemplo · entrevista` 12 · `Directo / sin seguimiento` 64 (etiqueta `DIRECT_CHANNEL` de `eventAnalytics.ts`). Link `Guía: cómo medir ventas por promotor →` (`/guias/como-medir-ventas-por-promotor`).

### 4.4 Acto II · La temporada (firma, ancla `#temporada`)
- Fondo `--te-sala` con foco que se enciende sobre el título. Eyebrow `—— ◆ ACTO II ◆ ——`; H2 **Una temporada se vende** / en oro **función a función.**; bajada: *El estreno se llena con prensa e invitados. La segunda semana, con lo que el público cuenta. Los jueves cuestan. Y las últimas funciones se agotan solas. Mueve la consola y mira qué hace AI Tickets en cada momento.*
- **Layout desktop:** grid `minmax(0,1.25fr) minmax(0,1fr)`. Izquierda: **cartelera**. Derecha: **lo que pasa en esta semana**. Abajo, a ancho completo: **fader**.

**Cartelera** (`SeasonBoard.vue`, etiqueta `Temporada de ejemplo` arriba a la derecha): grilla de 4 filas (semanas) × 4 columnas (`JUE` `VIE` `SÁB` `DOM`), 16 funciones del 5 al 29 de noviembre (jueves a sábado 20:30, domingo 19:00). Cada celda (88×88 desktop):
- Fecha en Bodoni 24 (`5`, `6`, …) + día en Prompt 11; barra de ocupación inferior de 4 px (dorada); estado en 12 px.
- Estados (los mismos de la página real más dos del panel): `Disponible` (marfil), `Últimas` (contorno dorado), `Agotada` (fondo terciopelo, tachado), `Realizada` (atenuada al 45%, con un `✓` dorado) y `Lista para retirar` (pequeño punto lima: lo de esa función ya está disponible, `{PAYOUT_RELEASE_HOURS}` h después).
- Encima de la grilla, tres contadores en Bodoni 40 con etiqueta Prompt 12: `Funciones realizadas {n} de 16` · `Entradas vendidas {x}` · `Reseñas ★ {promedio} · {k}`. Todos "ejemplo".

**Fader** (`LightFader.vue`): un `<input type="range" min="0" max="4" step="1">` nativo, estilizado como fader de consola de luces: riel horizontal de 6 px con muescas, perilla rectangular 28×44 px con línea dorada, 5 etiquetas debajo (Prompt 12, mayúsculas): `ESTRENO` · `SEMANA 2` · `SEMANA 3` · `ÚLTIMAS FUNCIONES` · `BAJÓ EL TELÓN`. Teclado nativo (flechas). `aria-valuetext` con la etiqueta. A la izquierda del riel, un ícono de foco cuya intensidad sube con el valor (opacidad).

**Lo que pasa esta semana** (panel derecho, `--te-sala-2`, radio 10, filete dorado arriba; título Bodoni 28 con el nombre del momento; 3 ítems con ícono lucide y, cuando corresponde, `SoonBadge dark`). Contenido por paso (los números de la cartelera salen de `SEASON_DEMO` en `teatroLanding.js`):

| Paso | Cartelera | Ítems (título · texto) |
|---|---|---|
| 0 · Estreno | Semana 1 en venta: jueves `Agotada` (estreno), viernes `Últimas`; resto `Disponible` con barras bajas. Realizadas 0. | **Estreno lleno, prensa adentro.** · Las cortesías entran con su QR y no se cuentan como venta. — **Cada compra, al instante en tu panel.** · Con el link que la trajo. — **Recordatorio el día antes.** · Cada persona recibe un correo con su entrada para su función. |
| 1 · Semana 2 | Semana 1 `Realizada` + `Lista para retirar`; semana 2 sube. Reseñas ★ 4,8 · 37. | **El público opina.** · `{REVIEW_REQUEST_DELAY_HOURS}` h después de cada función les llega un correo para calificar con estrellas, comentar y subir fotos. Tú lo ves en el panel. — **Lo de la semana 1, disponible.** · `{PAYOUT_SHORT_TEXT}`.* — **Mostrar las reseñas en la página mientras la obra sigue en cartelera** · `Pronto`. |
| 2 · Semana 3 | Semana 3: jueves con barra baja (amarillo no: marfil al 40%); sábado `Últimas`. | **¿El jueves se afloja?** · Una entrada "Jueves popular" amarrada a esas funciones, con su precio y su cupo, o un código con fecha de término para toda la obra. — **Tu Instagram, todos los días.** · Una historia diaria con la próxima función y el link por DM a quien responde `{DEFAULT_KEYWORD}`. — **Ves qué canal vende.** · Ventas por link, ciudades y horas; cada domingo, un reporte con la semana. |
| 3 · Últimas funciones | Semana 4: viernes, sábado y domingo `Agotada`; jueves `Últimas`. | **Agotada, sin que nadie te escriba.** · La función aparece agotada y tu público elige otra. — **Cambio de horario, todos avisados.** · Si mueves una función, avisamos por correo a quienes compraron. — **Ocupación de cada función en una vista** · `Pronto` (hoy ves emitidas y cupo de cada tipo de entrada). |
| 4 · Bajó el telón | Todo `Realizada`; las últimas con `Lista para retirar`. Contadores finales. | **Invita a tu público a la próxima obra.** · Un correo a todos, a quienes entraron o a quienes calificaron con 4 o 5 estrellas (`INVITE_AUDIENCES`). — **La reposición, en minutos.** · Duplicas la obra con su descripción, imagen, lugar, entradas y preguntas, y agregas las nuevas funciones. — **Las reseñas, en la página.** · Ahora que terminó, la página muestra las calificaciones, comentarios y fotos del público. |

  \* Al pie de la sección: `TERMS_NOTE`.
- **Comportamiento:** al entrar en viewport (al 35%), el fader se mueve solo de 0 a 1 (900 ms) **una vez**, como invitación; después lo controla la persona. Si la persona toca el fader antes, no hay movimiento automático. Al cambiar de paso: las celdas cambian de estado con stagger de 30 ms (en orden de calendario), los contadores interpolan (400 ms) y el panel derecho hace crossfade + `translateY ±10px` (260 ms).
- Sin JS: se muestra el paso 4 (`Bajó el telón`) y debajo una lista `<ol>` con los cinco momentos y sus ítems (todo legible).
- **Mobile:** contadores en fila de 3 (Bodoni 28); cartelera de 4 × 4 con celdas de 64 px (solo número + punto de estado; leyenda de estados debajo); fader a ancho completo con las etiquetas abreviadas (`Estreno · S2 · S3 · Últimas · Telón`); panel de la semana debajo. Objetivos táctiles ≥ 44 px (la perilla mide 44×44).
- Accesibilidad: la cartelera es una `<table>` con `<caption class="lp-sr-only">Temporada de ejemplo, 16 funciones</caption>`, cabeceras de día y cada celda con texto completo para lector (`Jueves 5 de noviembre, 20:30, agotada`). La región del panel es `aria-live="polite"` (con `useDelayedAnnouncement`).

### 4.5 Entreacto · Tu obra no descansa (fondo terciopelo, ancla `#difusion`)
- Fondo `--te-velvet` con el pliegue de terciopelo al 35% de opacidad (CSS) y un foco arriba. Texto marfil. Composición centrada.
- Eyebrow `—— ◆ ENTREACTO ◆ ——` (dorado); H2 **Mientras ensayas,** / en oro **tu obra sigue en cartelera.**
- Bajada: *Conectas tu Instagram una vez y apruebas la serie con una vista previa de cada pieza. Con el afiche y los datos de tu obra armamos historias que cuentan hacia la próxima función, y cuando una pasa, siguen con la siguiente. Si se agota, cambias una fecha o cancelas, la serie se ajusta o se detiene sola.* (consistente con `ORGANIZADORES_FAQ`).
- **Tres columnas** (desktop; separadas por filetes dorados verticales; cada una con eyebrow de 12 px, H3 Bodoni 28 y texto):
  1. **Tu Instagram, en piloto automático.** Mockup de historia (`CurtainStory.astro`, 200×400, marco negro radio 28 — el único radio grande, porque es un teléfono): fondo `aitk-teatro` con viñeta; arriba 3 barras de progreso (la segunda se llena en 5 s, en loop solo mientras se ve); avatar circular + `compania.ejemplo · programada 19:30`; Bodoni 40 marfil `Esta noche` / `20:30`; sticker marfil rotado −3° `Marea baja · Sala ejemplo`; sticker lima `Responde {DEFAULT_KEYWORD} y te llega el link`. Mockup genérico: sin interfaz ni logos de Instagram. Debajo, chips: `● Instagram` (borde lima) · `Facebook` + Pronto · `TikTok` + Pronto · `Reels` + Pronto.
  2. **El teaser, de portada.** *Sube un video corto de la obra y reemplaza la imagen arriba de la página: se reproduce solo, sin sonido.* Mockup: marco 16:9 en arco de proscenio con el póster de `aitk-teatro-funcion` y un botón ▶ dibujado (no reproduce nada).
  3. **Alguien responde por ti.** *La página de tu obra tiene un asistente que contesta duración, edad recomendada, accesos y horarios con la información que cargaste. Y las preguntas frecuentes las armas con IA desde el panel.* Mockup de dos burbujas: público `¿Es apta para niños?` → respuesta `Es para mayores de 14 años y dura 80 minutos. ¿Te ayudo con tus entradas? · ejemplo`.
- Línea final centrada (Prompt 16): *¿La última semana viene lenta? Lanza un anuncio en Instagram y Facebook desde tu panel: tú defines cuánto y por cuántos días, y Meta cobra el gasto directo en tu cuenta publicitaria.* (sin demo de anuncios: esa es la firma de stand-up y música).
- **Mobile:** columnas apiladas, separadas por filete dorado horizontal; historia de 160×320 centrada.

### 4.6 Acto III · La noche de la función (ancla `#puerta`)
- Eyebrow `—— ◆ ACTO III ◆ ——`; H2 **Primera llamada, segunda llamada,** / en oro **tercera llamada.**; bajada: *Así llega tu público a la sala, sin listas de papel ni filas que no avanzan.*
- **Tres llamadas** en una línea de tiempo vertical centrada (desktop: alternando izquierda/derecha del eje; mobile: todo a la izquierda del eje). En el eje, tres **campanas** (círculos de 20 px con filete dorado) que se encienden (relleno dorado + halo de foco) cuando su llamada entra en viewport. Cada llamada: número romano Bodoni 56 dorado (`I`, `II`, `III`), H3, texto y un mockup chico:

| Llamada | H3 | Texto | Mockup |
|---|---|---|---|
| **I · El día antes** | **Todos saben a qué hora y dónde.** | El día antes de cada función, quienes tienen entrada para esa función reciben un recordatorio por correo con su QR. Tú no mandas nada. | Correo mínimo: `Mañana: Marea baja · Vie 6 nov · 20:30 · Sala ejemplo` + botón `Ver mi entrada` (ejemplo). |
| **II · En la puerta** | **Tu equipo escanea con el celular.** | Aunque la sala no tenga señal: la lista se descarga antes y se sincroniza cuando vuelve la conexión. Una entrada usada no vuelve a entrar. Si alguien llega con la entrada de otra noche, el escáner te lo dice y tú decides si pasa. | **Escáner** (`DoorScanner.vue`, teléfono 240×480): alterna cada 2,6 s (solo mientras se ve) entre dos estados reales de `ValidateQR.vue`: (a) card lima `✓ Válida · General · Vie 6 nov · 20:30 · Catalina R.`; (b) card marfil con borde dorado `Esta entrada es para otra función: Jue 5 nov · 20:30` + botones `Validar igual` / `No validar`. Botón `↻` para cambiar a mano; con reduce-motion queda fijo en (b) con el botón. |
| **III · Comenzamos** | **Sala llena, y lo ves en vivo.** | El escáner cuenta las entradas validadas sobre el total. ¿Alguien llegó sin la entrada en el celular? Se busca por nombre y se le reenvía al correo. Las cortesías entran con su propio QR. | Contador Bodoni 64 `78 de 80` + `validadas · Vie 6 nov · ejemplo`. |

- Debajo de la tercera llamada, dos líneas con rombo dorado:
  - **El equipo de puerta no necesita tu cuenta.** Le das el rol Puerta, o un link temporal que vence solo (lo creas desde tu asistente de IA).
  - **¿Ensayo abierto o función a beneficio gratis?** Inscripción con QR para cada persona, sin cargo.
- Link `Guía: check-in con QR →` (`/guias/como-hacer-check-in-con-qr`).
- **"Se apaga la sala":** cuando la tercera llamada llega al 50% del viewport, una capa `--te-sala-off` sobre el fondo de la sección pasa de `opacity 0 → .7` (900 ms) y los textos de las llamadas I y II bajan a `--te-text-3`: solo queda iluminada la III. Al salir de la sección, vuelve. Con reduce-motion: sin cambio de luz.

### 4.7 Programa · Precio (fondo marfil, ancla `#precio`)
- Fondo `--te-programa`, texto `--te-ink`, filetes `--te-oro-ink`. Composición de **programa de mano**: una hoja centrada (ancho 760 px) con doble filete dorado en todo el borde (`inset 16px`), ornamento arriba.
- Eyebrow `—— ◆ PROGRAMA ◆ ——` en `--te-oro-ink`; H2 en tinta **La compañía cobra** / en `--te-oro-ink` **el 100% de cada entrada.**
- Texto (armado como el `priceLead` de stand-up/música, con constantes): *Para la compañía, 0% de comisión. Tu público paga un cargo por servicio de `{SERVICE_FEE_PERCENT_LABEL}` más IVA (`{IVA_PERCENT_LABEL}`) sobre ese cargo. Si prefieres un precio final redondo, lo absorbes tú, por obra. `{ABSORB_FEE_ACTIVATION}` Las funciones gratis no pagan nada.*
- **Ficha de la entrada** (`ProgramCalculator.vue`, usa `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement`):
  - Arriba, `Valor de la entrada` en Bodoni 64 `{price}` y slider $2.000–$40.000, paso $500, default **$10.000**.
  - Segmented recto (8 px, tinta sobre `--te-programa-2`): `Paga el público` / `Lo absorbe la compañía`.
  - **Reparto del precio** con líneas de puntos (Bodoni 22 para el rol, Prompt 18 tabular para el monto):
    - `Entrada ······ {price}`
    - `{SERVICE_FEE_LABEL} ······ {fee}`
    - `{SERVICE_FEE_TAX_LABEL} ······ {iva}`
    - filete
    - `Tu público paga ······ {buyer}` (Bodoni 30)
    - `La compañía recibe ······ {net}` en bloque lima (Bodoni 36, texto tinta)
  - Verificación (computeFeeSplit): **$10.000 → público $10.952 / compañía $10.000; absorbido → $10.000 / $9.048.** $7.000 → $7.666 / $7.000; absorbido → $7.000 / $6.334.
  - Región `aria-live` con `useDelayedAnnouncement`.
- Garantías centradas, Prompt 14 con rombos: `Sin mensualidad ◆ Sin permanencia ◆ {PAYOUT_SHORT_TEXT}*`.
- Nota: `TERMS_NOTE` → `/terminos-productores`.
- **Mobile:** la hoja a ancho completo con filete a 10 px; montos en Bodoni 28; segmented visible.

### 4.8 Para salas (fondo sala-2, ancla `#salas`)
- Eyebrow `—— ◆ PARA SALAS ◆ ——`; H2 **¿Tienes una sala?** / en oro **Toda tu cartelera, en tu propia web.**
- Desktop: grid `1fr 1fr`. Izquierda: **mockup de cartelera web** (`VenueBill.astro`): marco de navegador mínimo con `aitickets.cl/o/sala-ejemplo` y tres obras en columnas, cada una en un arco de proscenio sin foto (fondo `--te-sala-3` con un foco dibujado en CSS y el título en Bodoni): `Marea baja · Jue a dom · hasta 29 nov`, `El último tren · Vie y sáb · desde 4 dic`, `Cuentos de la orilla · Familiar · domingos 12:00`. Etiqueta `ejemplo`.
- Derecha, cuatro ítems con rombo dorado:
  1. **Tu web gratis, con tu cartelera.** Una página en `aitickets.cl/o/tu-sala` con todas tus obras vendiendo entradas, con plantillas y, si quieres, tu dominio.
  2. **Cada obra, con sus funciones.** Cada compañía que programas es una obra con su aforo, sus precios y su puerta.
  3. **Cada compañía ve lo suyo.** Le das acceso de Solo lectura limitado a su obra, para que siga sus ventas sin ver las demás. Hoy se asigna desde tu asistente de IA.
  4. **Para liquidar con cada compañía.** Descargas las órdenes de cada obra en CSV, con fecha, entradas y montos. `Borderó por función` + `Pronto`.
- CTA secundario: `Arma la web de tu sala →` (`/web-gratis`).
- **Mobile:** ítems arriba, mockup debajo con las tres obras en carrusel horizontal (`scroll-snap`).

### 4.9 La crítica (testimonio, solo si es real)
- Solo si `THEATRE_TESTIMONIAL` no es `null`. Formato "crítica": eyebrow `LA CRÍTICA` dorado, cita en **Bodoni 500 redonda** 36/48 (26/36 mobile), entre comillas tipográficas dorada grandes («»), centrada; debajo, foto circular 64 px con viñeta, nombre (Prompt 600) y `compañía o sala · ciudad` (Prompt 14 `--te-text-3`).
- Si es `null`, no se renderiza nada (ni el contenedor).

### 4.10 Preguntas frecuentes
`src/data/teatroFaq.ts`, mismo patrón que `musicaFaq.ts` (`pick` con error si falta, `reword`). Orden:

| # | Fuente | Pregunta |
|---|---|---|
| 1 | `PRODUCER_FAQ` | ¿Cuánto cuesta usar AI Tickets? |
| 2 | `PRODUCER_FAQ` | ¿Cuándo recibo el dinero de mis ventas? (`terms`) |
| 3 | `PRODUCER_FAQ` | ¿Puedo absorber el cargo por servicio? |
| 4 | `PRODUCER_FAQ` | ¿Puedo publicar varias funciones de una misma obra o show? (tal cual) |
| 5 | nueva | ¿Cada función puede tener su propio aforo? — *Sí. Creas un tipo de entrada amarrado a cada función, con su cupo. Una entrada "para todas las funciones" comparte el cupo entre todas las fechas. Cuando a una función le quedan pocas entradas, la página la muestra como "Últimas"; cuando se agota, tu público elige otra.* |
| 6 | landings.ts (teatro, se conserva) | ¿Puedo tener entradas generales y precios distintos por función? |
| 7 | nueva | ¿Tienen butacas numeradas? — *No. AI Tickets no tiene mapa de asientos numerados: las entradas son por función y por tipo. Si separas zonas, como platea y galería, cada una es un tipo de entrada con su propio cupo.* |
| 8 | nueva | ¿Cómo mando las cortesías de prensa? — *Desde el panel de la obra: nombre, correo y cuántas entradas. Si eliges la entrada de una función, la cortesía es para esa noche. Llega por correo con su QR, no cuenta como venta y se valida igual en la puerta. Para una lista de invitados con acompañantes, hoy se arma desde tu asistente de IA conectado.* |
| 9 | nueva | ¿Qué pasa si alguien llega a otra función con su entrada? — *El escáner avisa que la entrada es para otra función y muestra cuál. Tu equipo decide si la valida igual.* |
| 10 | nueva | ¿Puedo vender funciones para colegios o grupos? — *Sí. Creas la función (o un tipo de entrada solo para ese grupo) con su cupo. Cada compra tiene un máximo de `{DEFAULT_MAX_PER_PURCHASE}` entradas si no lo cambias; para un curso completo lo subimos desde tu asistente de IA o por WhatsApp.* |
| 11 | landings.ts (teatro, se conserva) | ¿Funciona si la obra es en una sala que no tiene ticketera propia? |
| 12 | `ORGANIZADORES_FAQ` | ¿Cómo funciona la publicación automática en redes? |
| 13 | `ORGANIZADORES_FAQ` | ¿Puedo poner un video como portada del evento? → `reword` **¿Puedo poner el teaser de la obra como portada?** |
| 14 | `ORGANIZADORES_FAQ` | ¿Cómo funcionan las reseñas? → `reword` con extra: *En la página de la obra se muestran cuando termina la temporada.* |
| 15 | nueva | ¿Puedo invitar a mi público a la próxima obra? — *Sí. Cuando termina la obra, desde el panel les mandas un correo a todos los asistentes, a quienes entraron o a quienes calificaron con 4 o 5 estrellas. No llega a quienes se dieron de baja ni a quienes ya tienen entrada.* |
| 16 | nueva | ¿Puedo descargar las ventas para rendir cuentas? — *Sí. Descargas las órdenes de cada obra en CSV, con fecha, entradas, montos, cortesías y el canal de cada compra, para la sala, tu contador o un fondo.* (ver Pregunta abierta 6) |
| 17 | `PRODUCER_FAQ` | ¿Qué pasa si tengo que cambiar o cancelar una función? (`terms`) |
| 18 | `PRODUCER_FAQ` | ¿Me ayudan a publicar mi primer evento? → `reword` **¿Me ayudan a publicar mi primera obra?** |

- La FAQ "¿Cuánto paga el público?" que tiene hoy la entrada de `landings.ts` queda cubierta por 1 y 3: se elimina de `landings.ts` (para no duplicarla en el JSON-LD si alguien vuelve a usar la lista completa) o se deja y `teatroFaq.ts` no la usa; decidir al implementar.
- Estilo: `LandingFaq` con los tokens puente; pregunta en Bodoni 500 22 px; signo `+` dorado (el giro de 45° ya lo hace `LandingFaq`); separadores con filete dorado al 20%.

### 4.11 Telón (cierre)
- Fondo `--te-sala`. Al centro, foto `aitk-teatro` (dos intérpretes bajo un foco cálido, público de espaldas) en **arco de proscenio** grande (desktop 560×700; mobile 100% × 120vw máx. 520 px), viñeta de foco. A ambos lados del arco, las **piernas de terciopelo** de 12vw y la bambalina arriba.
- H2 Bodoni 88 (44 mobile) centrado debajo del arco: **¿Cuándo es** / en oro **el estreno?**
- Bajada: *Publica tu obra hoy. Crear tu cuenta es gratis y no hay costos fijos. Si quieres, la armamos contigo.*
- CTAs (`data-final-cta`): lima pill `Publicar mi obra →` (`publishUrl("teatro_closing")`) · recto con filete dorado `Hablar por WhatsApp` · link `Agenda una demo de 15 min` (mismos destinos que stand-up y música).

### 4.12 Footer
`AppFooter` con un tono nuevo `tone="sala"` (cambio **aditivo** en `AppFooter.vue`: mismas clases que `dark` con fondo `#0c1220`, títulos `#f0e8d8`, listas `#a49d8e`; anotar en el PR). Si se prefiere no tocarlo, `tone="dark"` funciona (fondo negro cálido bajo una página azul noche: aceptable, menos prolijo).

---

## 5. Mobile

- Ancho base 390; gutter 20 px; secciones con 72 px de padding vertical (desktop 136). Composición centrada también en mobile (titulares, eyebrows, CTAs), salvo los ítems de listas y la FAQ, alineados a la izquierda para leer cómodo.
- Orden igual al desktop. Cambios: hero con foto arriba y texto debajo, sin piernas de telón, marquesina vertical (§4.1); reparto sin líneas de puntos (§4.2); Acto I con mockup de funciones a ancho completo y pase de prensa sin rotación; cartelera de 64 px por celda y fader con etiquetas cortas (§4.4); entreacto en columnas apiladas; tres llamadas a la izquierda del eje; programa a ancho completo; salas con carrusel; telón con arco más alto que ancho.
- Objetivos táctiles ≥ 44×44 (filas del selector de funciones, perilla del fader, chips). Nada de hover como única forma de ver información (el reparto y la cartelera muestran todo al tocar).
- `LandingMobileBar` en píldora oscura aparece después del hero y se oculta al llegar al cierre.

---

## 6. Animaciones (todas con `prefers-reduced-motion`)

Solo `transform`, `opacity` y `clip-path` (y `background-position` en el patrón de puntos del reparto, que es barato). Con `prefers-reduced-motion: reduce` todo queda en su estado final, sin loops ni movimientos automáticos: telón ya abierto, focos encendidos, fader en el paso 4 sin moverse solo, escáner fijo en el aviso de otra función, sin barra animada en la historia, sin "se apaga la sala". Usar `LandingMotion` (`data-lp-reveal` / `data-lp-step`) para los reveal genéricos; los loops corren solo en viewport (`data-te-play` → `.is-playing`, mismo patrón que música).

| # | Elemento | Animación |
|---|---|---|
| T1 | Telón del hero | Las piernas parten en `scaleX(2.4)` desde su borde exterior (cubren ~22vw cada una) y vuelven a `scaleX(1)` (1,4 s, `cubic-bezier(.7,0,.2,1)`); la bambalina sube 12 px. CSS puro bajo `html.lp-motion`: sin JS el telón ya está abierto y el H1 nunca queda tapado (el centro siempre visible) |
| T2 | Luz de sala | Capa oscura sobre la foto del hero de `opacity .55 → .25` (1,6 s) mientras el foco radial sobre el H1 pasa de `opacity 0 → 1`: "se apagan las luces de sala, se enciende el escenario" |
| T3 | H1 | Cada línea entra con `clip-path: inset(0 0 100% 0) → inset(0)` + `translateY 12px`, stagger 180 ms, desde 400 ms |
| T4 | Bajada, CTAs y marquesina | Fade + `translateY 16px`, delays 750 / 850 / 1000 ms; las cuatro funciones de la marquesina con stagger 80 ms |
| T5 | Foco de cada acto | Al revelar la sección, el gradiente de foco sobre el título pasa de `opacity 0 → 1` y `scaleY .6 → 1` desde arriba (700 ms) |
| T6 | Eyebrow con filetes | Los filetes crecen `scaleX 0 → 1` desde el rombo hacia afuera (500 ms) |
| T7 | Reparto | Reveal de filas con stagger 70 ms; hover/foco: fila iluminada (opacity del foco 0 → 1, 200 ms) y puntos recorridos (`background-position`, 600 ms) |
| T8 | Selector de funciones | Filas con stagger 50 ms al entrar; `Elegir` → crossfade + `translateX 24px` (260 ms) al paso de entradas; `Agotada` sin hover |
| T9 | Pase de prensa | Entra colgando: `rotate(-8deg) translateY(-24px) → rotate(-2deg)` con rebote leve (700 ms) al 40% de visibilidad |
| T10 | Barras de links (Escena 3) | `scaleX 0 → valor`, 900 ms, stagger 90 ms |
| T11 | Fader | Movimiento automático 0 → 1 una vez (900 ms); perilla con `transform` 300 ms entre pasos; ícono de foco con `opacity` según el paso |
| T12 | Cartelera | Celdas cambian de estado con stagger 30 ms en orden de calendario (fade + `scale .94 → 1`); `Agotada` entra con un barrido de terciopelo (`clip-path: inset(0 100% 0 0) → inset(0)`, 240 ms); contadores interpolan 400 ms |
| T13 | Historia de ejemplo | Barra de progreso de 5 s en loop solo mientras está visible |
| T14 | Tres llamadas | Cada campana se enciende (`scale .6 → 1` + halo `opacity`) al 50% de visibilidad de su llamada; el número romano sube 16 px con fade |
| T15 | Escáner | Alterna entre "Válida" y "otra función" cada 2,6 s solo en viewport (crossfade + `translateY 8px`) |
| T16 | Se apaga la sala | Capa `--te-sala-off` `opacity 0 → .7` (900 ms) al llegar la tercera llamada; vuelve al salir |
| T17 | Calculadora | Montos interpolan en 250 ms (opcional) |
| T18 | Telón del cierre | Las piernas entran de `scaleX(0)` a `scaleX(1)` desde los bordes (1 s) al 30% de visibilidad: el telón "baja" al final |
| T19 | Barra de lectura | `scaleX` según scroll (dorada) |

---

## 7. Rendimiento

- **LCP = foto del hero** (`aitk-teatro-funcion`): AVIF/WebP a 640 y 1024 (sharp, como stand-up y música), `fetchpriority="high"`, sin `loading="lazy"`. La referencia mide 1024 px: la viñeta y el foco disimulan, pero la foto real debe venir a 2400 px (y entonces se agregan 1344 y 2048).
- El telón y la luz de sala son capas CSS **encima** de la foto, con el centro siempre descubierto: no retrasan el pintado del LCP (el H1 y la foto se pintan desde el primer frame). Verificar en Lighthouse que el LCP no pase a ser un pseudo-elemento.
- Bodoni Moda: uno o dos archivos `latin` (< 60 KB en total), `preload` solo en esta página, fallback con `size-adjust` (CLS < 0,05). Prompt ya está cargada.
- Terciopelo, foco, viñeta, filetes y rombos: CSS puro (gradientes), sin imágenes.
- Cartelera: 16 celdas en DOM liviano; sin sombras por celda.
- Islas Vue con `client:visible` (`FunctionPicker`, `SeasonBoard` + `LightFader` en una sola isla, `DoorScanner`, `ProgramCalculator`) y `client:idle` (`TheatreHeader`, `LandingMobileBar`). Reparto, entreacto, llamadas, salas, telón: Astro estático + script chico. La página se lee completa sin JS.
- Resto de fotos `loading="lazy"`, `srcset` y `aspect-ratio` reservado. Lighthouse móvil ≥ 90 en performance y accesibilidad.

---

## 8. Fotos

**Se reutilizan** (todas en `public/landing/`; generar AVIF/WebP de las que aún no tienen):

| Uso | Archivo | Tratamiento | Variantes |
|---|---|---|---|
| Hero | `aitk-teatro-funcion.jpg` (3:2, 1024 px) | viñeta de foco, `saturate(.85)` | 640/1024 (crear) |
| Acto I · Escena 2 (prensa) | `aitk-teatro-ensayo.jpg` (4:5, 896 px) | arco de proscenio + viñeta | 480/896 (crear) |
| Telón (cierre) e historia de ejemplo del entreacto | `aitk-teatro.jpg` (4:5, 896 px) | arco de proscenio + viñeta | 480/896 (crear) |
| Teaser del entreacto (póster) | `aitk-teatro-funcion.jpg` (recorte 16:9) | arco + viñeta | (las mismas del hero) |

- No se usan `aitk-acad-teatro.jpg` (es de academias), `aitk-puerta-qr.jpg` (stand-up y música; aquí la puerta es un mockup de UI), `aitk-backstage.jpg` (comediantes) ni `aitk-publico.jpg` (risa de stand-up): cada landing con sus fotos.
- Mockups sin foto: selector de funciones, cartelera, escáner, correo de recordatorio, cartelera web de salas, programa de precio.

**Fotos reales que harían falta** (con autorización escrita de la compañía, la sala y del elenco; del público si se reconoce):
1. Hero: función en una sala independiente con un foco y el público de espaldas en primer plano, horizontal, ≥ 2400 px, con zona oscura abajo para el titular.
2. Ensayo general o la directora dando notas desde la platea, vertical 4:5.
3. Cierre: el saludo final del elenco con la luz de escena, vertical 4:5 y horizontal.
4. Póster o primer cuadro del teaser real de una obra vendida con AI Tickets (con permiso de la compañía para mostrar el nombre).
5. Opcional para Acto III: la boletería o el hall de una sala con alguien escaneando entradas (si se quiere reemplazar el mockup por una foto).
6. Testimonio: retrato de quien da la cita.

---

## 9. SEO

- **Title** (`landings.ts`): *Ticketera para teatro en Chile: vende tu temporada · 0% de comisión | AI Tickets*
- **Description:** *Vende las entradas de tu obra: todas las funciones en una página, aforo por función, cortesías de prensa con QR y cobro función por función. 0% de comisión.*
- **H1 visible sin JS** (el del hero: "Que suba el telón. La boletería de tu obra ya está lista."). El `h1`, `intro` y `highlights` de `landings.ts` se actualizan para que la tarjeta y las relacionadas no contradigan la página (highlights: `Todas las funciones en una sola página`, `Cortesías de prensa con QR`, `Cobras función por función*`).
- **Palabras clave a cubrir en el texto, sin forzar** (búsquedas en Chile): ticketera para teatro, venta de entradas para teatro, vender entradas para una obra de teatro, boletería online para teatro, entradas teatro independiente, temporada de teatro, funciones de teatro en Santiago, sala de teatro independiente, compañía de teatro, cortesías de prensa, entradas de estudiante, jueves popular, funciones para colegios, teatro familiar, microteatro, reposición de una obra, teatro en Valparaíso, teatro en Concepción, cartelera de teatro.
- **JSON-LD:** `BreadcrumbList` (AI Tickets → Para organizadores → Teatro independiente), `SoftwareApplication` con `Offer` armada con constantes (como música) y `FAQPage` con `TEATRO_FAQ`.
- Imagen OG: el hero (`image={THEATRE_PHOTOS.hero.src}` en `Layout`).
- Links internos: `/organizadores`, `/ticketera-stand-up`, `/ticketera-musica-en-vivo`, `/academias`, `/entradas-con-qr`, `/ventas-por-promotor`, `/web-gratis`, `/guias/como-hacer-check-in-con-qr`, `/guias/como-medir-ventas-por-promotor`, `/eventos/evento-demo-teatro`.
- Alt de fotos descriptivos: *Dos intérpretes en escena bajo un foco en una sala a oscuras, con el público de espaldas*, *Elenco ensayando con libretos mientras la directora da indicaciones desde la platea*, *Dos intérpretes frente a frente bajo un foco cálido*.

---

## 10. Analítica

Prefijo `te_`, mismo mecanismo que `MusicTracking.astro` (atributos `data-te-*` + `CtaTracking`):
- `te_view`, `te_cta_click {position}` (`hero`, `closing`, `header`, `mobile_bar`, `salas`), `te_demo_click {position}`, `te_whatsapp_click`, `te_faq_open {question}`, `te_section_view {section}`.
- Propios: `te_reparto_click {role}`, `te_function_pick {weekday}` (demo del selector), `te_season_step {step, auto}` (una vez por paso y origen), `te_scanner_toggle`, `te_calc_change {price, payer}` (con debounce), `te_web_click` (salas → `/web-gratis`).

---

## 11. Componentes

Carpeta `src/components/landing/teatro/`; datos y cálculos sin Node en `teatroLanding.js` (como `musicaLanding.js`): `THEATRE_PHOTOS`, `PLAY_DEMO` (obra, compañía, sala), `FUNCTIONS_DEMO`, `SEASON_DEMO` (estados por paso, contadores), `REPARTO`, `LLAMADAS`.

| Componente | Tipo | Notas |
|---|---|---|
| `TheatreHeader.vue` | isla `client:idle` | patrón de `MusicHeader` |
| `TheatreHero.astro` | estático + CSS | foto, telón (`Curtain.astro`), luz de sala, H1, marquesina |
| `Curtain.astro` | estático | piernas + bambalina de terciopelo (prop `variant: "hero" \| "closing"`), `aria-hidden` |
| `ProsceniumPhoto.astro` | estático | `<picture>` en arco con doble filete y viñeta (prop `arch`, `vignette`) |
| `ActEyebrow.astro` | estático | eyebrow con filetes y rombo |
| `Reparto.astro` | estático + script chico | `<dl>` con líneas de puntos y foco en hover |
| `FunctionPicker.vue` | isla `client:visible` | demo del selector de funciones y entradas; precios con `priceQuote` |
| `PressPass.astro` | estático | pase de prensa |
| `LinkSales.astro` | estático | mini tabla de ventas por link |
| `SeasonBoard.vue` | isla `client:visible` | cartelera + `LightFader` + panel de la semana; SSR con el paso 4 y la lista `<ol>` |
| `LightFader.vue` | dentro de `SeasonBoard` | `<input type="range">` estilizado |
| `Intermission.astro` | estático | entreacto: `CurtainStory.astro` (historia), teaser, burbujas del asistente |
| `ThreeCalls.astro` | estático + script chico | llamadas, campanas, "se apaga la sala" |
| `DoorScanner.vue` | isla `client:visible` | escáner con los dos estados reales |
| `ProgramCalculator.vue` | isla `client:visible` | `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement` |
| `VenueBill.astro` | estático | cartelera web de ejemplo para salas |
| `CriticQuote.astro` | estático | no renderiza sin `THEATRE_TESTIMONIAL` |
| `TheatreClosing.astro` | estático | telón final |
| `TheatreTracking.astro` | script | eventos `te_*` |

Compartidos sin cambios: `LandingFaq`, `LandingMobileBar` (`variant="pill"` con textos), `LandingMotion`, `CtaTracking`, `ReadingProgress` (prop `color`), `SoonBadge`. Cambios aditivos (anotar en el PR): `AppFooter` tono `sala`; `THEATRE_TESTIMONIAL` en `producerSocialProof.ts`; dependencia `@fontsource/bodoni-moda` (o `-variable`).

Datos: `landings.ts` (entrada `ticketera-teatro` con `dedicated: true`, `sections: []` como música, title/description/h1/intro/highlights de §9, faq con las dos que usa `teatroFaq.ts`), `src/data/teatroFaq.ts`.

Tests (como música): unitario de `teatroLanding.js` (estados de la cartelera por paso; montos del selector y la calculadora contra `computeFeeSplit`; el texto de cobro sale de `legal.mjs`) y e2e de la página (H1 visible sin JS, FAQ con JSON-LD, calculadora $10.000 → $10.952 / $10.000, fader con teclado cambia el panel, `Pronto` presente en lo de §0.6 que se muestra, sin testimonio cuando es `null`, sin scroll horizontal en mobile, `prefers-reduced-motion` deja el fader en el paso 4 y el escáner fijo). Agregar la URL a `tests/e2e/marketing.spec.ts` si lista las landings.

---

## 12. Fases (commits dentro del PR único)

1. **Página y tema:** tema `teatro`, Bodoni Moda con fallback, hero con telón estático, reparto, Acto I (selector sin interacción, pase, links), Acto II con el paso 4 y la lista, entreacto, tres llamadas estáticas, programa, salas, FAQ, telón, footer; `landings.ts` con `dedicated: true`; fotos de referencia en AVIF/WebP. Criterio: `npm run check` sin errores; Lighthouse móvil ≥ 90.
2. **Interacción:** selector de funciones → entradas, fader y cartelera, escáner, calculadora, hover del reparto.
3. **Movimiento:** T1–T19 y `prefers-reduced-motion`; analítica `te_*`; tests.
4. **Contenido real:** fotos reales autorizadas (§8), testimonio, teaser real, nombres de ejemplo revisados.

---

## 13. Preguntas abiertas

1. **Aforo de una temporada y reserva de fondos (bloqueante para la promesa "cobras cada función"):** `event-risk.mjs` suma los cupos de todas las entradas del evento; una temporada de 80 cupos × 16 funciones (1.280) queda como "aforo mayor a 1.000", pide documentos y puede retener entre el `{RESERVE_BY_LEVEL.medium}`% y el `{RESERVE_BY_LEVEL.high}`% hasta `{RESERVE_HOLD_DAYS}` días. ¿Se cambia a "máximo por función" (o máximo por lugar) para eventos con varias funciones? Mientras no se decida, la página dice solo lo de `PAYOUT_SCHEDULE_TEXT` con `TERMS_NOTE`, y conviene probar el caso con una temporada real antes de lanzar.
2. **Reseñas durante la temporada:** hoy se muestran en la página solo cuando el evento terminó. Para teatro, el boca a boca de la primera semana es lo que vende la segunda. ¿Se habilita mostrarlas mientras hay funciones futuras (con moderación)? Va como `Pronto` en el Acto II.
3. **Funciones repetidas y entradas por función:** armar 16 funciones y 16 tipos de entrada a mano es la fricción más grande del nicho. ¿Entran al roadmap "repetir jueves a domingo por N semanas" y "copiar este tipo de entrada a cada función"? Si no, sacarlos de la página en vez de mostrarlos como `Pronto`.
4. **Borderó por función** (porcentaje sala/compañía, cortesías, recaudación neta) para liquidar con la sala: no existe. ¿Se hace? Si no está en el plan, quitar el `Pronto` de §4.8 y dejar solo el CSV.
5. **Lista de invitados, acceso por obra y link de puerta** existen solo vía asistente de IA. ¿Se agregan al panel? Si se agregan, quitar "hoy desde tu asistente de IA" del copy (mismo criterio que `ABSORB_FEE_ACTIVATION`).
6. **Rendición de fondos (Fondart y similares):** muchas compañías financiadas rinden la recaudación. La FAQ 16 promete solo el CSV real. ¿Hace falta un formato específico (por función, con cortesías separadas)? No se menciona ningún fondo por nombre hasta confirmarlo.
7. **Descuentos por función:** hoy un código aplica a toda la obra; el "jueves popular" se resuelve con un tipo de entrada. ¿Se quiere limitar códigos a funciones o tipos de entrada? La página no lo promete.
8. **Bodoni Moda:** confirmar con el dueño la tipografía de acento (alternativas Didone: Playfair Display, Libre Bodoni). Debe quedar distinta de Unbounded/Fraunces (stand-up, academias) y de Anton (música), y no usarse en cursiva.
9. **Nombres de ejemplo:** "Marea baja", "Compañía La Grieta", "El último tren", "Cuentos de la orilla", "Sala ejemplo", "Catalina R.": revisar que no existan obras, compañías o salas chilenas con esos nombres antes de publicar.
10. **Fotos reales y testimonio:** ¿qué compañía o sala que use AI Tickets puede aportar fotos de función, ensayo y saludo final, el teaser y la primera cita? (§8)
11. **Butacas numeradas:** es una objeción habitual de salas con platea fija. ¿Se responde solo con la FAQ 7 (tipos de entrada por zona) o se evalúa en el roadmap? La página no lo muestra como `Pronto`.
12. **Tabla comparativa de identidades:** al sumar teatro, la de §1 tiene 4 columnas. Mantenerla al agregar clubs, fiestas, seminarios y talleres para que ninguna repita paleta, tipografía de acento, forma ni firma interactiva.

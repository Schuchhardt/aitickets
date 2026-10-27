# AI Tickets — Landing especializada para clubs y discotecas

**Para:** Claude Code (implementación)
**Ruta:** `/ticketera-discotecas` (**nueva**). En Chile la búsqueda dominante es "discoteca/discotecas" ("ticketera para discotecas", "entradas discoteca", "lista free discoteca"); "club" aparece en el title, el H1 y el copy para cubrir "club nocturno" y "clubes de música electrónica". `/ticketera-clubs` y `/ticketera-clubes` redirigen con 301 a `/ticketera-discotecas` (config de redirects de Astro o `netlify.toml`, cambio de configuración mínimo). Si el dueño prefiere "clubs" como URL principal, se invierte el sentido de las redirecciones (Preguntas abiertas 1). Igual que las otras landings dedicadas: entrada **nueva** en `src/data/landings.ts` con `dedicated: true` y página propia `src/pages/ticketera-discotecas.astro`; la tarjeta, el sitemap, las relacionadas y "Según lo que produces" de `/organizadores` leen de `landings.ts`.
**Público:** clubs nocturnos y discotecas con **noches recurrentes** (jueves a sábado, todas las semanas), bares con pista, productoras que arriendan un club para su ciclo (techno, reggaetón, "noche de los 2000") y sus equipos: encargado o gerente, **RRPP / promotores**, puerta y caja. Su realidad: **lista free hasta cierta hora**, **cover**, **mesas y VIP** que hoy se cierran por WhatsApp con pantallazos de transferencia, listas de RRPP en grupos de WhatsApp o planillas, fila larga en la puerta, pantallazos de QR compartidos, y la plata de la noche que se cuadra al amanecer.
**Frontera con otras landings:** la fiesta puntual e itinerante (galpón, universitaria, fiesta temática de una vez) va en la landing de **fiestas**; el concierto con banda en vivo va en `/ticketera-musica-en-vivo`. Esta página es para **el local y sus noches que se repiten**. Las tres se enlazan entre sí.
**Promesa:** *Abre la puerta. Nosotros llevamos la lista.* Lista free con QR por RRPP, cover y mesas pagados antes de llegar, check-in en la puerta aunque no haya señal y lo de cada noche disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina. 0% de comisión para el club.
**Métrica:** visitas → cuentas creadas → primera noche publicada **con al menos un tipo de entrada gratis (lista) y uno pagado**, comparada con `/organizadores`.
**Prototipo:** no hay artboard. Esta spec define layout, copy y comportamiento; si después se dibuja un prototipo y difiere, manda este documento.
**Reutiliza** de `SPEC_landing_productores_aitickets.md`: fórmula de precio (§5.3), header sticky (§4), accesibilidad (§9), analítica base (§11). De lo ya implementado en el repo: `LandingFaq`, `LandingMobileBar`, `LandingMotion`, `CtaTracking`, `AppFooter tone="dark"`, `SoonBadge`, `priceQuote` (producerLanding.js), `usePayerToggle` y `useDelayedAnnouncement` (usePriceCalculator.js), `useAdsDemo`. **No reutiliza** el lenguaje visual de ninguna otra landing (ver §1).

---

## 0. Antes de empezar (Claude Code)

1. **Tema propio** `[data-theme="clubs"]` en `src/styles/landing-clubs.css`, con scope y sin tocar los tokens globales; puente a `--surface-*`, `--text-*`, `--border` como música (para `LandingFaq`, `LandingMobileBar`, `SoonBadge`). Debe verse distinto de stand-up, academias, música, teatro y talleres (tabla de §1) y de las landings de fiestas y seminarios cuando existan (Preguntas abiertas 12).
2. **Dinero y plazos salen del código**, nunca escritos a mano: `SERVICE_FEE_PERCENT_LABEL`, `IVA_PERCENT_LABEL`, `SERVICE_FEE_NOTE`, `SERVICE_FEE_LABEL`, `SERVICE_FEE_TAX_LABEL`, `computeFeeSplit` (netlify/lib/fees.mjs); `PAYOUT_RELEASE_HOURS`, `PAYOUT_BUSINESS_DAYS`, `PAYOUT_SCHEDULE_TEXT`, `PAYOUT_SHORT_TEXT` (netlify/lib/legal.mjs); `ABSORB_FEE_ACTIVATION`, `PRODUCER_FAQ`, `TERMS_NOTE`, `MAX_EVENT_FUNCTIONS` (src/data/producerFaq.ts); `DEFAULT_MAX_PER_PURCHASE` (Reservation/pricing.js); `CHECKIN_RELEASE_THRESHOLD`, `RESERVE_HOLD_DAYS` (src/lib/producer-api/ledger.ts, ya lo importa `musicaFaq.ts`). En esta spec los montos van como `{…}` o con su valor actual solo para verificar.
3. **Redes y anuncios salen del código:** `DEFAULT_CADENCE`, `DEFAULT_KEYWORD` (src/lib/socialSeriesCadence.ts), `AD_LIMITS` (netlify/lib/zernio-ads.mjs: 1 a 30 días, edad mínima por defecto 18, radios de ciudad 17/25/40/80 km). Reseñas: `REVIEW_REQUEST_DELAY_HOURS`, `REVIEW_REQUEST_WINDOW_HOURS`, `INVITE_AUDIENCES` (netlify/lib/reviews.mjs).
4. **"Pronto"**: todo lo de §0.6 que se muestre lleva `SoonBadge` (`dark` sobre fondos oscuros). Nunca se dibuja como si funcionara.
5. **Verificado en el código (se puede prometer):**
   - **Entradas gratis y pagadas en el mismo evento**: cada tipo de entrada tiene precio (puede ser $0), cupo, descripción y función (`EditEventForm.vue`). Las gratis no pagan cargo (fees.mjs). Una "Lista free" es un tipo de entrada de $0 con cupo: cada persona se inscribe con nombre y correo y recibe su QR.
   - **Cierre automático de la lista a una hora**: ventana de venta por tipo de entrada (`init_date`/`end_date`, `isTicketOnSale` en netlify/lib/tickets.mjs). **Hoy se programa desde el asistente de IA** (`tools/tickets.ts`), no desde el formulario del panel: el copy lo dice como `ABSORB_FEE_ACTIVATION`.
   - **Noches recurrentes**: hasta `{MAX_EVENT_FUNCTIONS}` funciones por evento, cada una con su fecha, hora de inicio y de término **aunque cruce la medianoche** (`schedule.ts`: "Puede ser después de medianoche"); entradas para una noche o válidas para todas. **Duplicar evento** desde el panel (`/api/events/duplicate`, `eventDuplicate.ts`): copia descripción, imagen, lugar, tipos de entrada y preguntas frecuentes.
   - **Cobro por noche**: el ledger libera cada orden `{PAYOUT_RELEASE_HOURS}` h después del **término de su función** y entiende que una noche que termina antes de empezar cruzó la medianoche (`ledger.ts`, fin de función). Una entrada válida para **cualquier** noche se libera con la **última** noche del evento: por eso el copy recomienda entradas por noche. Condiciones (términos §8): identidad aprobada, cuenta bancaria verificada, check-ins ≥ `CHECKIN_RELEASE_THRESHOLD` de las entradas pagadas de la función **o** acreditar que se realizó, sin reclamos abiertos; reserva por riesgo para productores nuevos o con señales de riesgo (`event-risk.mjs`, hasta `RESERVE_HOLD_DAYS` días). Todo lo de plazos lleva `*` con `TERMS_NOTE`.
   - **Links por RRPP**: links con seguimiento (`TrackingLinkBuilder.vue`, `ref`/`utm_*`); en las métricas, órdenes, entradas e ingresos por canal (`eventAnalytics.ts`, incluye las inscripciones gratis con ingreso $0) y visitas/conversión por canal (`channelConversion`). La venta se asocia al link si compra en la misma visita. Exportación de órdenes a CSV con su canal (para liquidar a los RRPP).
   - **Códigos de descuento por RRPP**: % o monto fijo, usos máximos, límite por comprador, inicio y término (`discounts.mjs`, panel `/dashboard/descuentos`). Se aplican al subtotal del evento.
   - **Lista de invitados del club** (nombre, correo, teléfono, acompañantes, notas) con envío del link por correo o links de WhatsApp listos para enviar: **solo desde el asistente de IA** (`tools/guests.ts`; AI Tickets no envía WhatsApp, prepara el link). **Cortesías** con su propio QR por correo desde el panel (`CourtesyTicketsForm.vue`, hasta `MAX_COURTESY_PER_REQUEST` por envío), no cuentan como venta.
   - **Máximo por compra** por tipo de entrada (`DEFAULT_MAX_PER_PURCHASE` si no se cambia; se ajusta desde el asistente de IA).
   - **Puerta**: escáner en el celular, offline con sincronización, una entrada usada no vuelve a entrar ("❌ Este ticket ya fue validado": el pantallazo compartido no sirve dos veces), muestra nombre y **tipo de entrada** (Lista, Cover, Mesa, Cortesía), contador de validadas sobre el total, búsqueda por nombre y reenvío al correo (`ValidateQR.vue`, `/api/orders/resend`); rol Puerta (`permissions.ts`) o link de escáner sin cuenta que vence solo (`/puerta/<token>`, **hoy se crea desde el asistente de IA**, `tools/access.ts`).
   - **Aforo en vivo** por tipo de entrada, por noche y llegadas cada 15 minutos de las últimas 3 horas: **desde el asistente de IA** (`get_checkin_stats`, título "Aforo en vivo"). En el panel, el escáner muestra "N / M entradas validadas".
   - **Transferir una entrada** a otra persona con QR nuevo (el anterior deja de servir): desde el asistente de IA, rol con atención a compradores (`transfer_ticket`, `orders.support`).
   - **Asistente en la página del evento** que responde dudas de los compradores con la información cargada (horario, lugar, edad mínima…): `RecurringSection.vue` lo promete en `/organizadores`.
   - **Instagram automático**: historias cada `sparse_every_days` días, diarias desde D-`daily_from_days`, una el día de la noche; post diario D-`feed_posts_from_days` a D-`feed_posts_to_days`; "Quedan N entradas" bajo `scarcity_threshold_pct`%; DM con el link a quien responde `DEFAULT_KEYWORD` (`ORGANIZADORES_FAQ`). En un evento con varias noches la serie apunta a la **próxima** noche (`anchorFor` → `nextFunctionStart`, socialSeries.ts).
   - **Anuncios** en Instagram y Facebook con la cuenta publicitaria de Meta del club: presupuesto diario, días (`AD_LIMITS`), Chile o ciudad con radio, edad (por defecto desde `AD_LIMITS.defaultAgeMin` = 18); Meta cobra el gasto directo.
   - **Después de la noche**: reseñas con fotos entre `REVIEW_REQUEST_DELAY_HOURS` y `REVIEW_REQUEST_WINDOW_HOURS` h, código de premio; **invitar a la próxima noche** a todos, solo a quienes **entraron** (check-in) o a quienes calificaron (`INVITE_AUDIENCES`, máx. `MAX_INVITATIONS_PER_ORG_PER_DAY` envíos al día); muro de asistentes; reporte semanal por correo los domingos (`weekly-report-send.mjs`).
   - **Web gratis del club** con su cartelera en `aitickets.cl/o/<slug>`, plantilla **`nocturno`** y dominio propio (`sites.ts`, `/web-gratis`).
   - **Equipo con su rol**: Dueño, Administrador, Finanzas, Marketing, Puerta, Solo lectura, y limitar qué eventos ve cada uno (`permissions.ts`, `assign_event_staff`).
6. **No existe (no prometer, o `Pronto` si se muestra):**
   - Validar en la puerta **la hora de ingreso** de la lista ("free hasta la 1:00" se controla por hora): hoy solo se cierra la **inscripción** a una hora; el escáner muestra el tipo de entrada y la puerta decide. → `Pronto` en §4.5 y §4.6.
   - **Cuántos de la lista de cada RRPP entraron** (check-ins por canal): las métricas por canal cuentan órdenes, entradas e ingresos, no ingresos a la puerta. → `Pronto` en §4.4 (es lo que se le paga al RRPP "por cabeza").
   - **Acceso propio de cada RRPP** para ver sus números en el celular. → `Pronto` en §4.4. Hoy: CSV o compartir la tabla.
   - **Comisión de RRPP calculada sola** (liquidación automática): no existe; hoy se exporta el CSV con el canal. No se muestra como Pronto (Preguntas abiertas 5).
   - **Mesas con una entrada por invitado**: una mesa es un tipo de entrada; quien la compra recibe **un QR por mesa** (una unidad = un QR, `buildAttendeeRows`). Emitir automáticamente las N entradas de los invitados de la mesa → `Pronto` en §4.7. Hoy se puede: cortesías a nombre de quien reservó (N QR a su correo) o lista de invitados.
   - **Plano de mesas** para elegir mesa: no hay; se dice que no hay (como el mapa de asientos en música), sin `Pronto`.
   - **Verificar la edad** del comprador (+18) o pedir RUT en la compra: no hay preguntas personalizadas en el checkout. Se dice en la FAQ: el club lo indica en la página y revisa el carnet en la puerta. Sin `Pronto`.
   - **Venta en efectivo o con tarjeta en la puerta (POS)**: no existe. Sin `Pronto` (Preguntas abiertas 7).
   - **Vista de aforo en vivo en el panel** (hoy solo por IA y el contador del escáner). → `Pronto` en §4.5.
   - Facebook, TikTok y reels en la serie automática → `Pronto` (como música). Segmentar anuncios por gustos ("música electrónica") → `Pronto`.
   - **Evento recurrente automático** (repetir "todos los viernes" sin cargar las fechas): no existe; se cargan las noches o se duplica. No se muestra como Pronto.
7. **Fotos:** las de `public/landing/aitk-club-*.jpg` son de referencia generadas con IA (fotos-nicho.md). En producción van fotos reales de clubs que usen AI Tickets, con autorización escrita del local y, si se reconocen, de las personas. Mientras no existan, se usan las de referencia con el mismo bloqueo de publicación que stand-up (anotarlo en el PR). Lista de fotos reales necesarias en §8. **No se generan imágenes nuevas.**
8. **Testimonio:** solo una cita real (nombre, club o productora, ciudad, foto autorizada). Si no hay (`CLUB_TESTIMONIAL = null` en `producerSocialProof.ts`, cambio aditivo), la sección no se renderiza.
9. **Nombres de ejemplo** (club, noche, RRPP, cuenta de Instagram): ficticios, y cada card con datos dice `ejemplo`. Antes de publicar, revisar que no coincidan con clubs o personas reales de Chile.
10. **Alcohol:** la foto de mesas muestra botellas. El copy no menciona marcas ni promociona alcohol ("consumo incluido", nunca "botella de…"); las piezas de anuncios de ejemplo no muestran alcohol. Revisar con el dueño la Ley 21.363 (publicidad de alcohol) antes de usar la foto en anuncios pagados (Preguntas abiertas 9).
11. Las fases (§12) son commits dentro del PR único del rediseño (ver `README.md`): agregar `rediseno(clubs): landing especializada` a la lista de commits del README.

---

## 1. Sistema visual propio: "luz negra"

La referencia es **la puerta y la cabina de un club a las 2 de la mañana**: el negro violáceo de la luz negra, el **letrero LED** de puntos sobre la puerta y en la barra, el **timbre de tinta UV** en el dorso de la mano que solo aparece bajo la lámpara, los halos de luz de la pista, el **crossfader** del DJ y, al final, el momento en que **se prenden las luces de servicio** y se cuadra la caja. La página se ordena como **una semana del club que termina en una noche**: cada sección se abre con su hora en LED (`MAR 16:00`, `JUE 20:00`, `VIE 23:30`, `05:00`) y el header lleva un reloj que avanza de 22:00 a 06:00 con el scroll.

| | Stand-up | Academias | Música en vivo | Teatro | Talleres | **Clubs** |
|---|---|---|---|---|---|---|
| Fondo | negro cálido | papel cálido | negro frío + papel de afiche + rojo a sangre | azul noche + terciopelo + marfil | papel de cuaderno con cuadrícula | **negro violáceo de luz negra `#07060B`** con **halos de luz** (violeta y magenta) + un bloque **"luces de servicio"** blanco frío fluorescente `#F2F1F6` (precio) |
| Acento | lima + crema | tinta + café | rojo de sala | dorado de palco | azul lápiz pasta + destacador | **rosa fluor `#FF4FB8`** = LED encendido y tinta UV (cifras, horas, palabras encendidas, timbre) + **violeta UV `#8A5CFF`** solo como luz (halos, bordes que brillan, nunca texto chico); lima solo en acciones |
| Titulares | Unbounded + Fraunces cursiva | Unbounded + Fraunces cursiva | Anton mayúsculas | Bodoni Moda | Bricolage Grotesque | **Doto (matriz de puntos LED)**, mayúsculas; énfasis = **palabras encendidas** (rosa fluor con resplandor) sobre el resto en blanco; detrás, la grilla de **LEDs apagados** |
| Metadatos | sans | sans | mono del sistema (setlist) | Prompt espaciada entre filetes | Caveat manuscrita | **horas en Doto** (≥ 28 px) dentro de una "cápsula LED"; meta chica en Prompt 600 con `tabular-nums` |
| Formas | radios 18–28, pill | radios 24–32 | 0 px, talones perforados | arco de proscenio | fichas, fotos impresas, cartón | **fotos en cápsula** (radio = mitad del ancho, como un tubo de luz); cards 16 px con borde que brilla; botones 12 px (no pill) con resplandor interior |
| Fotos | color cálido | color con sombra | duotono rojo + grano | viñeta de foco | color natural impreso | **color de club**: `saturate(1.08) contrast(1.06)` + **fuga de luz** violeta/magenta en una esquina (`mix-blend-mode: screen`) |
| Ritmo | capítulos alternados | comparador y pasos | cortes duros "01 —" | actos centrados | separadores con pestaña | **hora a hora**: cada sección abre con su hora LED y una **tira LED** (línea punteada fluor); el fondo se oscurece hacia las 02:00 y **se prenden las luces** en el precio |
| Firma interactiva | mapa de sala | antes/después del chat | curva de venta + tandas | cartelera + fader | arma tu taller + pasar lista | **"La noche en vivo"**: un **crossfader** de 22:00 a 05:00 que mueve el letrero LED de la puerta, el aforo, las llegadas cada 15 min y la respuesta del asistente de IA + **la linterna UV** que revela el timbre |

```css
[data-theme="clubs"] {
  --cl-noche: #07060B;          /* fondo principal (negro violáceo) */
  --cl-noche-2: #100E18;        /* secciones alternas */
  --cl-noche-3: #1A1726;        /* cards, inputs, filas */
  --cl-line: rgba(236, 232, 255, 0.12);
  --cl-line-glow: rgba(138, 92, 255, 0.45);   /* borde de card que "brilla" */
  --cl-text-1: #EEEAF8;         /* blanco lavanda */
  --cl-text-2: #C4BED6;
  --cl-text-3: #9C96B0;         /* meta, eyebrows (≈ 7:1 sobre noche) */
  --cl-fluor: #FF4FB8;          /* LED encendido / tinta UV (≈ 6,8:1 sobre noche) */
  --cl-uv: #8A5CFF;             /* luz negra: halos, bordes, resplandor. Nunca texto < 24 px */
  --cl-uv-soft: #B49BFF;        /* violeta para texto ≥ 14 px (≈ 9:1) */
  --cl-servicio: #F2F1F6;       /* "luces de servicio" (precio): blanco frío fluorescente */
  --cl-servicio-2: #E4E2EC;     /* controles y filas sobre servicio */
  --cl-ink: #14121C;            /* texto sobre servicio */
  --cl-fluor-ink: #B0127A;      /* rosa para texto sobre servicio (≈ 5,8:1) */
  --cl-led-off: rgba(236, 232, 255, 0.06);    /* LED apagado (grilla de puntos) */
  --brand-lime: (lima de marca);
  /* puente a los tokens que leen LandingFaq, LandingMobileBar, SoonBadge (como en música) */
  --surface-0: var(--cl-noche); --surface-1: var(--cl-noche-2); --surface-2: var(--cl-noche-3);
  --text-1: var(--cl-text-1); --text-2: var(--cl-text-2); --text-3: var(--cl-text-3);
  --border: var(--cl-line);
}
```

**Reglas de color**
- **Rosa fluor**: palabras encendidas de los titulares, horas LED, cifras grandes (aforo, montos de ejemplo), el timbre UV, la tira LED de cada sección, el reloj del header. En texto, solo ≥ 18 px. Sobre servicio, `--cl-fluor-ink`.
- **Violeta UV**: halos de fondo (gradientes radiales ya difuminados, sin `filter: blur`), borde que brilla de cards activas, la luz de la linterna UV, el resplandor de los titulares. Nunca como color de texto chico.
- **Lima**: botones primarios, "✓ Válida", "Publicado", "Tú recibes". Nunca lima y rosa pegados en piezas chicas.
- **Resplandor** (`text-shadow: 0 0 10px rgba(255,79,184,.55), 0 0 28px rgba(138,92,255,.35)`): solo en palabras encendidas ≥ 40 px. Se quita con `@media (forced-colors: active)` y `@media (prefers-contrast: more)`.

**Tipografía**
- **Doto 800** (`@fontsource/doto`, solo `latin`, `font-display: swap`, preload solo en esta página). Es monoespaciada: sirve también para contadores sin saltos. Fallback con métricas ajustadas: `"Doto", "Doto Fallback", ui-monospace, Menlo, monospace` con `@font-face { font-family: "Doto Fallback"; src: local("Menlo"), local("Consolas"); size-adjust: …; }`. **Antes de implementar, verificar que el subset `latin` traiga Á É Í Ó Ú Ñ ¿ ¡** (si falta alguno, ese titular se escribe sin el carácter o se pide `latin-ext`).
- Doto solo en titulares, horas y cifras, **nunca bajo 28 px** ni en párrafos. Mayúsculas, tracking 0.02em.
- Cuerpo y meta: Prompt (la sans actual). Meta: Prompt 600, 13 px, mayúsculas, tracking .08em, `tabular-nums`.
- **Escala desktop:** H1 104/100, H2 68/70, H3 32/36 (Prompt 700, no Doto), cuerpo 18/29, horas LED 28. **Mobile:** H1 48/50, H2 36/40, H3 24/28, cuerpo 16/25, horas LED 28.

**Recursos gráficos**
- **Grilla LED** (`.cl-led-grid`): `radial-gradient(circle, var(--cl-led-off) 1.2px, transparent 1.6px)` en paso de 8 px detrás de H1, H2 y del letrero LED; con máscara radial para que se desvanezca en los bordes. Una sola capa por titular, `aria-hidden`.
- **Letrero LED** (`LedSign`): caja negra con grilla LED y borde `--cl-line`, texto Doto fluor de una línea. Cambia de mensaje **por pasos** (los puntos se apagan y prenden en 160 ms con `opacity` por columnas), **nunca como marquesina continua**. Texto real en un `<p>` con `aria-live="off"`; el cambio es decorativo.
- **Hora LED** (`NightHour`): cápsula `--cl-noche-3` con la hora en Doto fluor 28 px y una etiqueta Prompt al lado (`VIE 23:30 · ABRE LA PUERTA`), seguida de la **tira LED**: línea punteada fluor de 1 px que cruza la sección.
- **Timbre UV** (`UvStamp`): sello circular SVG con borde dentado y texto curvo `AI TICKETS · VÁLIDA · VIE` y una ✓ al centro, dibujado en `--cl-fluor`. Está al 6% de opacidad hasta que pasa la **linterna UV**: en desktop, una máscara radial de 140 px que sigue al puntero sobre la card (CSS `mask-image` con variables `--x`/`--y` que actualiza un script chico); en mobile y teclado, un barrido automático de izquierda a derecha al entrar en viewport. Con `prefers-reduced-motion`: el timbre se ve completo, sin linterna. Decorativo (`aria-hidden`); lo que dice también está en texto.
- **Halos**: 1–2 gradientes radiales grandes por sección (`--cl-uv` al 22%, `--cl-fluor` al 14%), posiciones distintas en cada sección para dar "luces que se mueven" entre secciones. Opcional: deriva lenta (`transform`, 24 s) solo en el hero y el cierre.
- **Fotos en cápsula** (`CapsulePhoto`): `<picture>` con `border-radius: 999px` en marcos verticales 4:5 o 3:5 (en horizontales, radio 48 px solo en los extremos cortos), borde de 1 px `--cl-line-glow` y **fuga de luz**: capa `radial-gradient` violeta→magenta en una esquina con `mix-blend-mode: screen` al 45%.
- **Crossfader** (`Crossfader`): `<input type="range">` nativo con piel de mezclador de DJ: riel horizontal con marcas de hora en Prompt 600 13 px (Doto no baja de 28 px), perilla rectangular 28×44 con una línea fluor al centro.
- Iconos: los del sitio (lucide). Nada de logos de Instagram, Facebook, WhatsApp ni de clubs o marcas de alcohol.

---

## 2. Estructura

| # | Hora LED | Sección | Fondo | Ancla |
|---|---|---|---|---|
| 1 | — | Hero: foto de pista, H1 LED, card "Esta noche" con letrero LED y timbre UV | foto + halos | |
| 2 | `MAR 16:00` | Armas el mes: noches que se repiten | noche-2 | `#noches` |
| 3 | `MIÉ 19:30` | Tu noche en historias + anuncios | noche | `#difusion` |
| 4 | `JUE 20:00` | La lista de los RRPP | noche-2 | `#lista` |
| 5 | `VIE 23:30 → 05:00` | **La noche en vivo** (firma) | noche, el más oscuro | `#en-vivo` |
| 6 | `VIE 23:30` | La puerta, por dentro | noche-2 + foto | `#puerta` |
| 7 | `01:30` | Mesas y VIP | noche + foto | `#mesas` |
| 8 | `05:00` | **Se prenden las luces**: precio y cobro | **servicio (claro)** | `#precio` |
| 9 | `DOM 12:00` | La próxima noche se llena con esta | noche-2 | |
| 10 | — | Testimonio (solo si es real) | noche | |
| 11 | — | Preguntas frecuentes | noche | |
| 12 | — | Cierre: letrero LED con cuenta regresiva al próximo viernes | noche + halos | |
| 13 | — | Footer (`AppFooter tone="dark"`) | noche | |

Orden pensado como la semana del club: se arma el martes, se difunde el miércoles, los RRPP mueven la lista el jueves, la noche del viernes, las luces de las 05:00 y el domingo.

---

## 3. Header y reloj de la noche

- `ClubHeader.vue` (patrón de `StandupHeader.vue`/`MusicHeader.vue`): `position: fixed`, transparente sobre el hero; tras 40 px de scroll, `rgba(7,6,11,.84)` + `backdrop-filter: blur(14px)` + borde inferior `--cl-line`.
- Logo · links `Noches` (`#noches`) · `La lista` (`#lista`) · `La puerta` (`#puerta`) · `Precio` (`#precio`) · `Ingresar` · botón lima `Publicar mi noche` (radio 12).
- **Reloj de la noche** (en lugar de la barra de progreso de lectura de las otras landings): a la izquierda del botón, cápsula 96×32 con la hora en Doto 18 px (**única excepción** a la regla de 28 px, porque son 4 dígitos sueltos con `aria-hidden`: el progreso no es información). Va de `22:00` (arriba) a `06:00` (final) en pasos de 15 min según el scroll; entre `05:00` y el final, la cápsula pasa a blanco servicio con texto tinta ("se prendieron las luces"). En mobile va dentro de la barra del header, junto al botón de menú. Con `prefers-reduced-motion` igual se actualiza (no es animación, es estado), sin transición.
- Mobile: logo + reloj + botón de menú (44×44, radio 12). `LandingMobileBar variant="pill"` con `title="Gratis para publicar"`, `subtitle="0% de comisión para el club"`, `ctaLabel="Publicar mi noche"`; aparece después del hero y se oculta en el cierre (comportamiento existente).

---

## 4. Secciones (copy es-CL completo)

### 4.1 Hero
- Altura `min(100svh, 900px)` desktop / 780 px mobile. Foto `aitk-club-pista` (pista con DJ, luces ámbar y magenta, la ciudad de noche por la ventana), `object-position: 55% 40%`, fuga de luz violeta arriba a la derecha, overlay `--cl-noche` al 80% abajo a la izquierda. Halo violeta detrás del H1.
- Eyebrow (Prompt 600 meta): `PARA CLUBS, DISCOTECAS Y PRODUCTORAS DE NOCHE`
- H1 (Doto, sobre grilla LED): **ABRE LA PUERTA.** / encendida en fluor: **NOSOTROS LLEVAMOS LA LISTA.**
- Bajada (con constantes): *Lista free con QR para cada RRPP, cover y mesas pagados antes de llegar, check-in en la puerta aunque no haya señal y lo de cada noche disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina\*. 0% de comisión para el club.*
- CTAs: lima `Publicar mi próxima noche →` (`landing.cta.label`, `publishUrl("clubs_hero")`) · botón con borde `Ver un evento de ejemplo` (`landing.demo.url`, ver Preguntas abiertas 3).
- Microcopy meta bajo los CTAs: `SIN MENSUALIDAD · SIN PERMANENCIA · LA LISTA FREE NO PAGA NADA`. Nota `*` → `TERMS_NOTE` al pie del hero, 12 px.
- **Card "Esta noche"** (derecha, 360 px, vidrio oscuro `--cl-noche-3` al 88% + borde `--cl-line-glow`, radio 16):
  - Arriba, **letrero LED** de 1 línea que rota cada 3 s entre: `ABRIMOS 23:30` → `LISTA FREE · INSCRIPCIÓN HASTA 00:30` → `QUEDAN 3 MESAS`.
  - Meta: `VIERNES ULTRAVIOLETA · CLUB EJEMPLO · EJEMPLO` y `VIE 23:30 → 05:00 · PROVIDENCIA`.
  - Tres filas de tipos de entrada (Prompt 15, precio en Prompt 600, estado a la derecha):
    - `Lista free` · `$0` · `Quedan 40`
    - `Cover` · `$10.000` · `+ cargo` (en meta 11 px: `{SERVICE_FEE_NOTE}`)
    - `Mesa VIP · hasta 6 personas` · `$180.000` · `Quedan 3`
  - Abajo a la derecha, el **timbre UV** (96 px) que aparece con la linterna; a la izquierda, texto chico `Pasa el cursor: el timbre aparece con luz negra` (solo desktop con puntero fino; en mobile no se muestra este texto).
- Mobile: H1, bajada, CTAs a ancho completo; la card debajo, sin la frase de la linterna (barrido automático).

### 4.2 Armas el mes (`MAR 16:00`, ancla `#noches`)
- Hora LED `MAR 16:00 · ARMAS EL MES`. H2 **CADA SEMANA ABRES.** / encendida **TÚ LO CARGAS UNA VEZ.**
- Texto: *Jueves, viernes y sábado de todo el mes en una tarde. Cada noche con su hora de apertura y de cierre (aunque termine a las 5 de la mañana), con sus entradas y su cupo, y se cobra por separado. ¿La próxima temporada? Duplicas el evento y solo cambias las fechas.*
- **Mes del club** (`ClubMonth.astro`, derecha en desktop, ilustración con etiqueta `ejemplo`): calendario de 5 semanas × 7 días (L a D). Jueves, viernes y sábado son "noches": cápsula con nombre corto en Prompt (`Jueves Retro`, `Viernes Ultravioleta`, `Sábado Club`) y punto fluor. Las semanas pasadas en gris (`Realizada`), la actual con borde que brilla, las futuras con `Quedan N` en meta. Al pasar el puntero (o tocar) una noche: tooltip con `VIE 23:30 → 05:00 · Lista, Cover, Mesa · se cobra el LUN 05:00` (la hora de cobro = término + `PAYOUT_RELEASE_HOURS`, calculada en `clubsLanding.js`; con `*`).
- **Foto en cápsula** `aitk-club-manager` (encargado revisando el celular en la barra antes de abrir), a la izquierda del calendario en desktop, 280 px de ancho; en mobile, arriba, 3:4 con radio 48 px.
- Tres líneas con punto fluor (Prompt):
  - **Un evento con todas tus noches** — Hasta `{MAX_EVENT_FUNCTIONS}` noches en un evento, cada una con su fecha y horario.
  - **Una entrada por noche, un cobro por noche** — Si la entrada es para una noche específica, lo de esa noche queda disponible `{PAYOUT_RELEASE_HOURS}` h después de que termina\*. Si vendes un pase válido para todas las noches, se cobra con la última.
  - **Duplica la temporada** — Copia descripción, imagen, lugar, tipos de entrada y preguntas frecuentes. Solo agregas las fechas nuevas.
- Link meta `Tu cartelera en tu propia web, gratis →` (`/web-gratis`) con texto chico: *Plantilla nocturna y dominio propio si quieres.*

### 4.3 Tu noche en historias (`MIÉ 19:30`, ancla `#difusion`)
- Hora LED `MIÉ {DEFAULT_CADENCE.default_time} · TU NOCHE EN HISTORIAS` (la hora por defecto de la serie; el texto aclara que se ajusta a la hora pico).
- H2 **TU INSTAGRAM** / encendida **TRABAJA TODA LA SEMANA.**
- Bajada (consistente con `ORGANIZADORES_FAQ`): *Conectas tu Instagram una vez y apruebas la serie con una vista previa de cada pieza. Con el flyer y los datos de tu noche armamos historias con cuenta regresiva y posts para el feed, y se publican solos. A quien responde la historia con la palabra `{DEFAULT_KEYWORD}` le llega el link por DM. Si tu evento tiene varias noches, la serie siempre apunta a la próxima.*
- **Izquierda: historia de ejemplo** (`ClubStoryMockup.astro`, 280×560, marco negro radio 36 — teléfono): fondo `aitk-club-pista` recortado vertical; 3 barras de progreso (la segunda se llena en 5 s, en loop solo visible); avatar redondo + `club.ejemplo · programada {default_time}`; letrero LED grande `HOY 23:30`; sticker blanco girado −3° `Quedan 40 cupos en la lista`; sticker lima `Responde {DEFAULT_KEYWORD} y te llega el link`. Mockup genérico: sin interfaz ni logos de Instagram.
- **Derecha, card 1 · la serie de la semana** (`ClubSeriesWeek.vue`): tira de 7 días hasta el viernes calculada con `DEFAULT_CADENCE` (función pura en `clubsLanding.js`; con una noche semanal, lo normal es estar dentro de la banda diaria: historia diaria + post diario hasta D-`feed_posts_to_days` + historia del día a las `event_day_time`). Cada slot es una cápsula LED (historia = fluor, post = blanco). Chips: `● Instagram` (borde lima) · `Facebook` + Pronto · `TikTok` + Pronto · `Reels` + Pronto. Leyenda: `{h} historias · {p} posts esta semana · hora: la de más visitas de tu evento, o {default_time}`.
- **Derecha, card 2 · anuncios** (`ClubAdsDemo.vue`, `--cl-noche-3`): badge meta `QUEDAN 3 MESAS · FALTAN 2 DÍAS`; H3 (Prompt 700) **¿Viernes flojo? Impúlsalo con anuncios.**; texto: *Lanza un anuncio en Instagram y Facebook desde tu panel, para tu ciudad y para mayores de `{AD_LIMITS.defaultAgeMin}`. Tú defines cuánto invertir por día y por cuántos días, y lo pausas cuando quieras. Meta cobra el gasto directo en tu cuenta publicitaria y ves cuántas entradas vendió cada anuncio.*
  - Demo con `useAdsDemo` (misma lógica que stand-up/música): slider `Presupuesto diario` ($3.000–$50.000, default $5.000), slider `Días` (1–5 en la demo; nota `hasta {AD_LIMITS.maxDays} días`), chips `Santiago · 17 km` · `{defaultAgeMin}–35 años` · `Música electrónica` + Pronto (deshabilitado). Botón lima `Impulsar · {total} en total` → `✓ Anuncio activo · {días} días` + `Pausar`. **Sin alcance ni resultados estimados.** La pieza de anuncio de ejemplo no muestra alcohol.
- Nota chica bajo las cards: *Y la página de tu noche tiene un asistente que responde a tus compradores hasta qué hora es la lista, la edad mínima o el código de vestimenta, con la información que cargaste.*
- Mobile: historia de 160 px a la izquierda y la leyenda de la serie a la derecha; debajo, la tira de 7 días con scroll horizontal; debajo, anuncios con un slider (`Días` fijo en 3).

### 4.4 La lista de los RRPP (`JUE 20:00`, ancla `#lista`)
- Hora LED `JUE 20:00 · LOS RRPP MUEVEN LA LISTA`. H2 **LA LISTA YA NO VIVE** / encendida **EN UN GRUPO DE WHATSAPP.**
- Texto: *La lista free es un tipo de entrada de $0 con su cupo: cada persona se inscribe con su nombre y su correo, y le llega su QR. Cada RRPP comparte su propio link y en las métricas de tu noche ves cuántas visitas trajo, cuántos se inscribieron y cuánto vendió en cover y mesas. Sin capturas de pantalla, sin planillas, sin nombres repetidos a la 1 de la mañana.*
- **Ranking de RRPP** (`RrppBoard.vue`, card `--cl-noche-3` con etiqueta `Lista por RRPP · ejemplo`; filas con barra horizontal, la primera con borde que brilla):

| RRPP (link) | Visitas | Lista free | Cover | Mesas | Ingresos | Entraron |
|---|---|---|---|---|---|---|
| `Cata R.` | 412 | 64 | 38 | 2 | $740.000 | — |
| `Nico V.` | 298 | 51 | 22 | 1 | $400.000 | — |
| `Javi M.` | 190 | 27 | 19 | 0 | $190.000 | — |
| `Bio de Instagram` | 520 | 33 | 41 | 1 | $590.000 | — |
| `Directo / sin link` | — | 11 | 56 | 3 | $1.100.000 | — |

  (Totales del ejemplo: lista 186, como el panel de §4.5 a las 22:00; mesas 7 de 10.)

  - Ingresos = Σ precio de las entradas (lo que recibe el club, sin cargo): se calculan en `clubsLanding.js` a partir de las cantidades y los precios de ejemplo de §4.1, no a mano. "Directo" usa `DIRECT_CHANNEL` de eventAnalytics.ts. La columna **Entraron** muestra `—` con `SoonBadge` en el encabezado (`Entraron` + Pronto): *cuántos de su lista pasaron por la puerta*.
  - Selector arriba de la tabla: `Por inscritos` / `Por ingresos` (reordena con animación FLIP).
  - Al tocar una fila: aparece su link en Prompt 600 `aitickets.cl/eventos/viernes-ultravioleta?ref=cata` con botón `Copiar` (copia el texto de ejemplo; toast `Es un ejemplo: crea los tuyos en el panel`).
- **Cinco ítems** a la izquierda (número Doto fluor 28 + título Prompt 600 + texto):
  1. **Un link por RRPP, en un minuto.** Le pones su nombre y se lo mandas. No necesita cuenta.
  2. **La lista se cierra sola.** La inscripción a la lista free se corta a la hora que elijas, o cuando se llena el cupo. Hoy la hora se programa desde tu asistente de IA conectado o escribiéndonos por WhatsApp.
  3. **Un código para cada RRPP.** Descuento por porcentaje o monto, con usos máximos y fecha de término, para el cover de su gente.
  4. **Liquidas sin discusiones.** Exportas las órdenes a CSV con el link de cada una y calculas la comisión de cada RRPP.
  5. **Invitados del club, aparte.** Tu lista de invitados con sus acompañantes, y les mandas el link por correo o te dejamos los WhatsApp listos para enviar (desde tu asistente de IA). Si son cortesías, les llega su propio QR.
- Debajo del ranking, fila con dos `Pronto`: `Cada RRPP ve sus números en su celular` + Pronto · `Cuántos de cada lista entraron` + Pronto.
- Link meta `Guía: cómo medir ventas por promotor →` (`/guias/como-medir-ventas-por-promotor`) y `Ventas por promotor →` (`/ventas-por-promotor`).
- Mobile: ítems arriba; tabla como lista de cards (nombre + barra + 3 cifras: lista, cover, ingresos); el link se corta con `overflow-wrap: anywhere`.

### 4.5 La noche en vivo (firma, `VIE 23:30 → 05:00`, ancla `#en-vivo`)
- Es la sección más oscura (`--cl-noche` sin halos salvo uno fluor tenue detrás del letrero). Hora LED `VIE 23:30 → 05:00 · LA NOCHE EN VIVO`.
- H2 **MUEVE LA NOCHE.** / encendida **MIRA CÓMO SE LLENA.**; bajada: *Así se ve una noche desde la puerta: quién entra, a qué hora y cuánto queda. Arrastra la hora.*
- **Layout desktop** (`NightLive.vue`): grid `1.25fr 1fr`.
  - **Izquierda, "panel de la noche"** (card grande, borde que brilla, etiqueta `Noche de ejemplo`):
    - **Letrero LED de la puerta** (ancho completo): mensaje según la hora (tabla abajo).
    - **Aforo** en Doto 96 px fluor: `{ingresados}` + Prompt `de 600 · {pct}%`; barra de aforo segmentada en 30 "LED" que se encienden.
    - **Llegadas cada 15 min** (últimas 3 h, como `get_checkin_stats`): 12 barras verticales en violeta con la actual en fluor; etiqueta `Llegadas cada 15 min`.
    - **Por tipo de entrada**: 4 filas `Lista free`, `Cover`, `Mesa VIP`, `Cortesías` con `ingresaron / emitidas` y barra fina.
  - **Derecha, "pregúntale a tu IA"**: burbuja de usuario fija `¿Cuánta gente hay adentro?` y la respuesta (burbuja `--cl-noche-3`) que cambia con la hora, armada en `clubsLanding.js` con los mismos datos: *"Hay 455 personas adentro (76% del aforo). De la lista free entraron 171 de 200; de cover, 251; mesas, 8 de 9; cortesías, 25. En los últimos 15 minutos entraron 38."* Debajo, chips de qué viene de dónde: `Contador en el escáner` · `Aforo por tipo y llegadas: tu asistente de IA` · `Vista de aforo en el panel` + Pronto.
  - **Abajo, a todo el ancho: el crossfader** (`Crossfader`): rango 22:00 → 05:00 en pasos de 15 min (28 posiciones), marcas cada hora en Prompt 600 13 px, valor actual en Doto 28 px fluor sobre la perilla. Teclado nativo (flechas = 15 min, PageUp/PageDown = 1 h, Home/End). `aria-valuetext="01:30, 455 personas adentro"`.
- **Estados clave** (datos en `clubsLanding.js` como fotogramas; entre fotogramas se interpola). Aforo del local 600. Emitidas al final: Lista free 200 + Cover 300 + Mesa VIP 9 (un QR por mesa, por eso el escáner cuenta 9 y no 54 personas) + Cortesías 30 = **539**. A las 01:30: lista 171, cover 251, mesas 8, cortesías 25 = 455. Al final: lista 178, cover 283, mesas 9, cortesías 28 = **498**. **Regla:** las sumas viven en el archivo de datos y un test las cuadra.

| Hora | Letrero LED | Ingresados | Nota en el panel |
|---|---|---|---|
| 22:00 | `ABRIMOS 23:30` | 0 | Lista free `186 / 200 inscritos` · Mesas `7 / 10 vendidas` |
| 23:30 | `LISTA FREE · TRAE TU QR` | 24 | Empieza la fila: barras de llegada suben |
| 00:30 | `LISTA FREE CERRADA · COVER $10.000` | 212 | Fila `Lista free` pasa a `Inscripción cerrada 00:30` + nota `Validar la hora de ingreso de la lista` + Pronto |
| 01:30 | `QUEDA 1 MESA` | 455 (76%) | Pico de llegadas; mesas `9 / 10 vendidas` |
| 03:00 | `AFORO 83%` | 498 | Llegadas bajan |
| 05:00 | `GRACIAS · HASTA EL VIERNES` | 498 | Card final: `Ingresaron 498 de 539 · Lo de esta noche queda disponible el LUN 05:00*` (término SÁB 05:00 + `PAYOUT_RELEASE_HOURS`, calculado) |

- Al entrar en viewport, la noche **corre sola una vez** de 22:00 a 01:30 en 4 s y se detiene; luego manda la persona. Botón chico `↻ Repetir`. Con `prefers-reduced-motion`: arranca quieta en 01:30, sin corrida automática ni botón.
- **Mobile:** letrero LED arriba, aforo grande, crossfader **pegado arriba de la card** (sticky dentro de la sección, `top: 64px`) para no perderlo al hacer scroll; llegadas y tipos en dos filas compactas; la burbuja de IA debajo.
- Accesibilidad: el panel es `role="group"` con `aria-label="Panel de una noche de ejemplo"`; los números cambian en una región `aria-live="polite"` con `useDelayedAnnouncement` (anuncia solo al soltar la perilla). Sin JS: se muestra el estado de 01:30 completo y una tabla `<table>` con los seis estados (caption `sr-only`).

### 4.6 La puerta, por dentro (`VIE 23:30`, ancla `#puerta`)
- Desktop: grid `5fr 6fr`. Izquierda: **foto en cápsula** `aitk-club-puerta` (fila con cordón y staff escaneando, 4:5), fuga de luz magenta abajo. Sobre la foto, card lima pegada abajo a la derecha: `✓ VÁLIDA · COVER · ENTRADA 1 DE 2 · 00:47` (Prompt 600, tinta sobre lima), y al lado el **timbre UV** que aparece con la linterna (o barrido en mobile).
- Derecha: hora LED `VIE 23:30 · ABRE LA PUERTA`; H2 **LA FILA AVANZA.** / encendida **LOS PANTALLAZOS NO PASAN.**
- Seis ítems (número Doto fluor + título Prompt 600 + texto):
  1. **Escaneas con el celular, aunque no haya señal.** La lista se descarga antes y se sincroniza cuando vuelve la conexión.
  2. **Un QR entra una sola vez.** Si alguien comparte el pantallazo de su entrada, el segundo que la muestra no entra.
  3. **La puerta ve qué entrada es.** Lista, cover, mesa o cortesía, con el nombre de quien la compró. `Rechazar la lista después de su hora` + Pronto. (No se promete el aviso "entrada de otra noche" hasta resolver Preguntas abiertas 8.)
  4. **Ves cuántos han entrado.** El escáner cuenta las entradas validadas sobre el total, en vivo.
  5. **Tu equipo de puerta no necesita tu cuenta.** Le das el rol Puerta, o un link de escáner que vence solo (lo creas desde tu asistente de IA).
  6. **¿Llegó sin la entrada en el celular?** Se busca por nombre en la lista y se le reenvía al correo.
- Nota con `*` (texto chico): *Escanear también cuenta para tu pago: los check-ins de la puerta acreditan que la noche se realizó, una de las condiciones para liberar lo de cada noche.* (ledger.ts, condición 3; `TERMS_NOTE`).
- Link meta `Guía: check-in con QR →` (`/guias/como-hacer-check-in-con-qr`) · `Entradas con QR →` (`/entradas-con-qr`).
- Mobile: foto 3:4 con radio 48 px arriba, texto debajo.

### 4.7 Mesas y VIP (`01:30`, ancla `#mesas`)
- Desktop: grid `6fr 5fr` (foto a la derecha, alterna con §4.6). Foto en cápsula `aitk-club-vip` (mesa con grupo riendo), `object-position: 50% 35%`.
- Hora LED `01:30 · MESAS`; H2 **LA MESA SE PAGA** / encendida **ANTES DE LLEGAR.**
- Texto: *Cada mesa es un tipo de entrada con su precio, su cupo y lo que incluye en la descripción: "Mesa VIP · hasta 6 personas · consumo incluido". Se paga online con Webpay; nada de pantallazos de transferencia ni de guardar la mesa "hasta las 12". Cuando se venden todas, aparece agotada.*
- **Ticket de mesa de ejemplo** (`TableTicket.astro`, card vertical con borde que brilla, etiqueta `ejemplo`): `MESA VIP` (Doto 40) · `Viernes Ultravioleta · VIE 23:30` · `Hasta 6 personas · consumo incluido` · `$180.000` + meta `{SERVICE_FEE_NOTE}` · barra `9 de 10 mesas vendidas` · fila `1 QR por mesa`.
- Tres líneas con punto fluor:
  - **Un QR por mesa.** Quien la compra entra con su grupo; la puerta ve "Mesa VIP" al escanear. `Una entrada para cada invitado de la mesa` + Pronto.
  - **¿Mesa para un cumpleaños o una marca?** Le mandas las entradas del grupo como cortesías: a cada persona le llega su QR.
  - **Cupos que se respetan.** Si tienes 10 mesas, se venden 10. No hay plano para elegir mesa: la asignas tú en el local.
- Mobile: foto arriba (3:4, radio 48), texto y ticket debajo.

### 4.8 Se prenden las luces (`05:00`, fondo servicio, ancla `#precio`)
- Corte duro: de `--cl-noche` a `--cl-servicio` sin gradiente, como cuando se prenden las luces de servicio. Arriba, una fila de 6 "tubos fluorescentes" (barras blancas de 4 px con brillo) que **parpadean y se encienden** al entrar (C12). Texto tinta.
- Hora LED en tinta: `05:00 · SE PRENDEN LAS LUCES`. H2 (Doto, tinta; segunda línea `--cl-fluor-ink`) **TÚ RECIBES EL 100%** / **DE CADA ENTRADA.**
- Texto (armado como el `priceLead` de stand-up, con constantes): *Para el club, 0% de comisión. El comprador paga un cargo por servicio de `{SERVICE_FEE_PERCENT_LABEL}` más IVA (`{IVA_PERCENT_LABEL}`) sobre ese cargo. Si prefieres un cover redondo, lo absorbes tú, por evento. `{ABSORB_FEE_ACTIVATION}` La lista free no paga nada.*
- Garantías en meta con `·`: `Sin mensualidad · Sin permanencia · {PAYOUT_SHORT_TEXT}*`.
- **Calculadora "cierre de caja"** (`CashCloseCalculator.vue`, usa `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement`): card blanca con borde `--cl-servicio-2`, radio 16.
  - Presets (segmented, tinta): `Lista free · $0` · `Cover · $10.000` · `Mesa · $180.000`. Al elegir uno, el valor se fija; el slider (`$0–$60.000`, paso $500) mueve el cover; con `Mesa`, un campo numérico (`parseAmount`, tope `CALC_PRICE.inputMax`).
  - Segmented `Paga el público` / `Lo absorbo yo` (oculto con `Lista free`).
  - Desglose: `Entrada`, `SERVICE_FEE_LABEL`, `SERVICE_FEE_TAX_LABEL`; totales `TU PÚBLICO PAGA` (Prompt 700) y bloque lima `TÚ RECIBES` (Doto 56, tinta).
  - Con `Lista free`: *$0 para todos. Cada persona recibe su QR.*
  - Verificación (computeFeeSplit): **$10.000 → público $10.952 / tú $10.000; absorbido → $10.000 / $9.048. $180.000 → $197.136 / $180.000; absorbido → $180.000 / $162.864.**
  - Región `aria-live` con `useDelayedAnnouncement`.
- **Cobro de la noche** (debajo, en una fila con ícono de reloj): `{PAYOUT_SCHEDULE_TEXT}*` + *Si la noche termina a las 05:00, las `{PAYOUT_RELEASE_HOURS}` h cuentan desde las 05:00.*
- Nota: `TERMS_NOTE` → `/terminos-productores`.
- Mobile: presets con scroll horizontal si no caben; totales apilados.

### 4.9 La próxima noche se llena con esta (`DOM 12:00`)
- Hora LED `DOM 12:00 · LA PRÓXIMA NOCHE`. H2 **EL DOMINGO** / encendida **YA ESTÁS VENDIENDO EL VIERNES.**
- Tres cards horizontales (`--cl-noche-3`, borde `--cl-line`, número Doto fluor):
  1. **Fotos y estrellas de tu público.** Entre `{REVIEW_REQUEST_DELAY_HOURS}` y `{REVIEW_REQUEST_WINDOW_HOURS}` h después de la noche les llega un correo para calificar y subir fotos. Si quieres, premias con un código para la próxima.
  2. **Invita solo a los que vinieron.** Con un clic mandas un correo a quienes entraron por la puerta (o a quienes calificaron con 4 o 5 estrellas) con el link de tu próxima noche.
  3. **Tu reporte del domingo.** Cada domingo te llega por correo cómo vendió la semana y qué hacer en la próxima.
- Mobile: carrusel con `scroll-snap` (card al 86%).

### 4.10 Testimonio (solo si es real)
- Solo si `CLUB_TESTIMONIAL` no es `null`. Cita en Prompt 400 30/42 (22/32 mobile), sin cursiva, entre comillas Doto fluor de 96 px; foto **en cápsula** 72×96; nombre (Prompt 600) y `club o productora · ciudad` en meta.
- Si es `null`, no se renderiza nada (ni el contenedor).

### 4.11 Preguntas frecuentes
`src/data/clubsFaq.ts`, mismo patrón que `musicaFaq.ts` (`pick` con error si falta, `reword`). Orden:

| # | Fuente | Pregunta |
|---|---|---|
| 1 | `PRODUCER_FAQ` | ¿Cuánto cuesta usar AI Tickets? |
| 2 | nueva (`terms`) | ¿Cuándo recibo lo de cada noche? — `{PAYOUT_SCHEDULE_TEXT}` + *Si la noche termina pasada la medianoche, se cuenta desde la hora de término. Escanea las entradas en la puerta: los check-ins acreditan que la noche se realizó, una de las condiciones para liberar el pago. Para retirar necesitas registrar una cuenta bancaria, que AI Tickets verifica normalmente en 1 día hábil.* (la última frase, tomada de la respuesta de PRODUCER_FAQ, no reescrita) |
| 3 | `PRODUCER_FAQ` | ¿Puedo absorber el cargo por servicio? |
| 4 | nueva | ¿Cómo armo la lista free? — *Creas un tipo de entrada de $0 llamado, por ejemplo, "Lista free", con su cupo. Cada persona se inscribe con su nombre y correo y le llega su QR. Si quieres que la inscripción se cierre a una hora, hoy se programa desde tu asistente de IA conectado o escribiéndonos por WhatsApp. En la puerta, tu equipo ve que es una entrada de lista al escanearla.* |
| 5 | `PRODUCER_FAQ` reformulada | ¿Puedo saber cuántos trae cada RRPP? (respuesta de "¿Puedo saber cuántas entradas vende cada promotor?") + *Las inscripciones a la lista free también cuentan, con ingreso $0.* |
| 6 | nueva | ¿Cómo vendo mesas? — *Cada mesa es un tipo de entrada con su precio, su cupo y la descripción de lo que incluye. Quien la compra recibe un QR para la mesa. Si quieres que cada invitado tenga su propia entrada, envíaselas como cortesías. No hay plano para elegir mesa.* |
| 7 | `PRODUCER_FAQ` reformulada | ¿Puedo publicar todas las noches del mes? (respuesta de "¿Puedo publicar varias funciones de una misma obra o show?") + *Cada noche puede terminar pasada la medianoche.* |
| 8 | nueva | ¿Puedo pedir que sean mayores de 18? — *Hoy AI Tickets no verifica la edad al comprar. Indícalo en la descripción del evento y en el nombre de la entrada ("+18"): el asistente de la página lo responde a quien pregunte, y tu equipo revisa el carnet en la puerta.* |
| 9 | nueva | ¿Qué pasa si alguien comparte el pantallazo de su QR? — *Cada QR entra una sola vez. Si el pantallazo ya se usó, el escáner lo marca como validado y no pasa. Si una persona no puede ir, tu equipo le transfiere la entrada a otra persona desde tu asistente de IA: el QR anterior deja de servir.* |
| 10 | nueva | ¿Puedo tener lista de invitados y cortesías? — *Sí. Las cortesías se envían desde el panel por correo, cada una con su QR, y no cuentan como venta. La lista de invitados del club, con acompañantes, la manejas desde tu asistente de IA: les manda el link por correo o te deja los WhatsApp listos para enviar.* |
| 11 | nueva | ¿Se puede pagar el cover en la puerta? — *AI Tickets vende online: tu público compra desde el celular en la página de la noche, mientras haya cupo y la venta esté abierta. No hay cobro en efectivo ni con máquina en la puerta.* (validar con el dueño, Preguntas abiertas 7) |
| 12 | `ORGANIZADORES_FAQ` | ¿Cómo funciona la publicación automática en redes? |
| 13 | `ORGANIZADORES_FAQ` | ¿Tengo que pagar anuncios? |
| 14 | `ORGANIZADORES_FAQ` | ¿Puedo poner un video como portada del evento? (el aftermovie de la última noche) |
| 15 | `PRODUCER_FAQ` | ¿Qué pasa si tengo que cambiar o cancelar una función? (`terms`) |
| 16 | `PRODUCER_FAQ` | ¿Me ayudan a publicar mi primer evento? |

- Estilo: `LandingFaq` con los tokens puente; pregunta en Prompt 600; el `+` es un punto LED fluor que se convierte en `–` (3 puntos) al abrir.

### 4.12 Cierre
- Sin foto: fondo `--cl-noche` con dos halos (violeta arriba a la izquierda, fluor abajo a la derecha) que derivan lento.
- **Letrero LED grande** (ancho del contenedor, grilla LED visible): **¿CUÁNDO ABRES** / encendida **LA PRÓXIMA NOCHE?** (es el H2, Doto 96 / 44 mobile).
- Debajo, **cuenta regresiva** en Doto 40 fluor al próximo viernes 23:30 en hora de Chile (`EVENT_TIMEZONE`): `FALTAN 3 D 07 H 12 MIN` (actualiza cada minuto, sin segundos; `aria-hidden`, decorativa). SSR/sin JS: `ESTE VIERNES · 23:30`. Con `prefers-reduced-motion`: misma actualización por minuto, sin transición.
- Bajada: *Publícala hoy. Crear tu cuenta es gratis y no hay costos fijos. Si quieres, la armamos contigo.*
- CTAs: lima `Publicar mi próxima noche →` (`publishUrl("clubs_closing")`) · borde `Hablar por WhatsApp` · link `Agenda una demo de 15 min` (mismos destinos que stand-up).

### 4.13 Footer
`AppFooter tone="dark"`. En "Para quién" se agrega `{ href: "/ticketera-discotecas", label: "Clubs y discotecas" }` después de `Música en vivo` (cambio aditivo en `AppFooter.vue`, anotar en el PR).

---

## 5. Mobile

- Ancho base 390; gutter 20 px; secciones 72 px de padding vertical (desktop 136).
- Orden igual al desktop. Cambios: card del hero debajo de los CTAs; mes del club con la foto arriba y el calendario en 5 filas compactas (solo jue–sáb visibles por semana, con `+` para ver la semana completa); difusión compacta (§4.3); ranking de RRPP como cards; **noche en vivo con el crossfader sticky** dentro de la sección (§4.5); fotos en cápsula pasan a 3:4 con radio 48; precios con presets en scroll horizontal; "la próxima noche" en carrusel.
- Objetivos táctiles ≥ 44×44 (la perilla del crossfader 44×52). Nada de hover como única forma de ver información: el tooltip del mes, el link de cada RRPP y la linterna UV tienen versión al tocar o automática.
- `LandingMobileBar` en píldora oscura aparece después del hero y se oculta al llegar al cierre.

---

## 6. Animaciones (todas con `prefers-reduced-motion`)

Solo `transform`, `opacity`, `clip-path` y `mask-position`. Con `prefers-reduced-motion: reduce` todo queda en su estado final y sin loops: letreros LED fijos en su primer mensaje, timbres UV visibles completos, la noche en vivo quieta en 01:30, halos sin deriva, tubos de servicio encendidos, historia sin barra animada. Reveals genéricos con `LandingMotion` (`data-lp-reveal` / `data-lp-step`).

| # | Elemento | Animación |
|---|---|---|
| C1 | Foto del hero | `scale 1.06→1` (1,8 s) + la fuga de luz entra de `opacity 0→1` (1,2 s), una vez |
| C2 | H1 | "Encendido LED": cada línea aparece por columnas de puntos (`clip-path: inset(0 100% 0 0) → inset(0)` en 8 pasos con `steps(8)`, 560 ms), stagger 180 ms; la línea encendida toma su resplandor al final (`opacity` del `text-shadow` vía pseudo-elemento) |
| C3 | Bajada y CTAs | Fade + `translateY 16px`, delay 700–850 ms |
| C4 | Card "Esta noche" | Entra a 1,0 s (`translateY 20px`, `scale .97→1`); el letrero LED rota cada 3 s con cambio por columnas (160 ms) |
| C5 | Linterna UV | Máscara radial sigue al puntero (`mask-position`, sin transición); en touch/teclado, barrido de 1,2 s al 40% de visibilidad |
| C6 | Horas LED de sección | Los dígitos "se encienden" (`opacity` por dígito, stagger 60 ms) y la tira LED crece `scaleX 0→1` (600 ms) al 30% de visibilidad |
| C7 | Halos | Deriva lenta `translate` ±40 px, 24 s, alternada (solo hero y cierre; pausada fuera de viewport) |
| C8 | Mes del club | Las cápsulas de noche aparecen con stagger 30 ms por día; la semana actual con borde que pulsa una vez |
| C9 | Serie de la semana | Slots con pop `scale .8→1` stagger 50 ms; historia de ejemplo con barra de 5 s en loop solo visible |
| C10 | Ranking de RRPP | Barras `scaleX` 600 ms stagger 80 ms; reordenar con FLIP 320 ms |
| C11 | Noche en vivo | Corrida automática 22:00→01:30 en 4 s, una vez; aforo interpola; LED de aforo se encienden uno a uno; barras de llegada `scaleY` 200 ms; letrero cambia por columnas |
| C12 | Se prenden las luces | Los 6 tubos parpadean (2 parpadeos de `opacity` a 0,3 en 400 ms, desfasados) y quedan encendidos; el fondo ya es claro (sin transición de color de fondo) |
| C13 | Calculadora | Montos interpolan 250 ms (opcional) |
| C14 | Mesas | La barra `9 de 10` crece `scaleX` 800 ms; el ticket entra con `translateY 24px` |
| C15 | Cierre | Letrero grande se enciende como C2; cuenta regresiva sin animación (cambia por minuto) |
| C16 | Reloj del header | Cambia de hora sin transición (estado, no animación) |

---

## 7. Rendimiento

- **LCP = foto del hero** (`aitk-club-pista`): AVIF/WebP a 640 y 1024 (sharp, como las demás; la referencia mide 1024 px: la real debe venir a ≥ 2400 px y entonces se suma 1344/2048), `fetchpriority="high"`, sin `loading="lazy"`.
- Doto: un archivo `latin` 800, `preload` solo en esta página, fallback con `size-adjust` (CLS < 0,05). El H1 tiene que ser legible con el fallback si la fuente tarda.
- Grilla LED, halos y fuga de luz son CSS (gradientes), sin imágenes ni `filter: blur`. Los halos con `will-change: transform` solo mientras están en viewport.
- Linterna UV: un `pointermove` con `requestAnimationFrame` que escribe dos variables CSS; se desconecta fuera de viewport.
- Islas Vue con `client:visible` (`NightLive`, `RrppBoard`, `ClubSeriesWeek`, `ClubAdsDemo`, `CashCloseCalculator`) y `client:idle` (`ClubHeader`, `LandingMobileBar`). La página se lee completa sin JS.
- Resto de fotos `loading="lazy"`, `srcset`, `aspect-ratio` reservado. Lighthouse móvil ≥ 90 en performance y accesibilidad.
- Probar `mix-blend-mode: screen` de la fuga de luz en Safari iOS dentro de contenedores con `transform`; si falla, la capa pasa a `opacity` normal.

---

## 8. Fotos

**Se reutilizan** (todas en `public/landing/`; generar AVIF/WebP de las que aún no tienen):

| Uso | Archivo | Tratamiento | Variantes |
|---|---|---|---|
| Hero e historia de ejemplo | `aitk-club-pista.jpg` (3:2, 1024 px) | color de club + fuga de luz | 640/1024 (crear) |
| Armas el mes | `aitk-club-manager.jpg` (4:5, 896 px) | cápsula | 480/896 (crear) |
| La puerta | `aitk-club-puerta.jpg` (4:5, 896 px) | cápsula + fuga magenta | 480/896 (crear) |
| Mesas y VIP | `aitk-club-vip.jpg` (4:5, 896 px) | cápsula | 480/896 (crear) |

El cierre va sin foto (letrero LED). No se usan `aitk-puerta-qr` ni `aitk-publico` para no repetir fotos de música, stand-up y teatro. No se generan imágenes nuevas.

**Fotos reales que harían falta** (con autorización escrita del club y, si se reconocen, de las personas):
1. Hero: pista llena con DJ y luces, horizontal, ≥ 2400 px, con espacio oscuro abajo a la izquierda para el titular.
2. Puerta: staff escaneando un QR en la puerta de un club, con fila y cordón, vertical.
3. Mesas: grupo en una mesa VIP, vertical, **sin marcas de alcohol visibles** (o desenfocadas).
4. Encargado o gerente del club revisando el celular antes de abrir, vertical.
5. Testimonio: retrato de quien da la cita.
6. Opcional: un RRPP compartiendo su link desde el celular (para §4.4; hoy va sin foto).

---

## 9. SEO

- **Title** (`landings.ts`): *Ticketera para discotecas y clubs en Chile: lista free, cover y mesas · 0% de comisión | AI Tickets*
- **Description:** *Vende entradas para tu discoteca o club: lista free con QR para cada RRPP, cover y mesas VIP con pago online, check-in en la puerta aunque no haya señal y cobro por noche. 0% de comisión para el club.*
- **H1 visible sin JS** (el del hero). El `h1` de `landings.ts`: "Abre la puerta. Nosotros llevamos la lista." Card: `{ title: "Clubs y discotecas", text: "Lista free por RRPP, cover y mesas pagadas antes de llegar, y la puerta con QR." }`. `eyebrow`: "Para clubs, discotecas y productoras de noche". `kind: "vertical"`, `sections: []`, `faq`: las propias de clubs que no vienen de PRODUCER_FAQ/ORGANIZADORES_FAQ (como música y talleres), `cta: { label: "Publicar mi próxima noche", campaign: "vertical_clubs" }`, `related: ["ventas-por-promotor", "entradas-con-qr", "ticketera-musica-en-vivo"]` (+ fiestas cuando exista), `dedicated: true`.
- **Palabras clave a cubrir en el texto, sin forzar** (búsquedas en Chile): ticketera para discotecas, ticketera para clubs, venta de entradas discoteca, lista free discoteca, lista de RRPP, app para RRPP, entradas con QR para discoteca, control de acceso discoteca, reservar mesa VIP discoteca, venta de mesas VIP, cover discoteca, entradas para fiestas en Santiago, club nocturno Santiago, ticketera para productoras de fiestas, lista de invitados.
- **JSON-LD:** `BreadcrumbList` (AI Tickets → Para organizadores → Clubs y discotecas), `SoftwareApplication` con `Offer` armada con constantes (como música) y `FAQPage` con `CLUBS_FAQ`.
- Imagen OG: el hero (`image={CLUB_PHOTOS.hero.src}`).
- Links internos: `/organizadores`, `/ticketera-musica-en-vivo`, `/ticketera-stand-up`, (fiestas), `/ventas-por-promotor`, `/entradas-con-qr`, `/web-gratis`, `/guias/como-medir-ventas-por-promotor`, `/guias/como-hacer-check-in-con-qr`, `/guias/como-hacer-una-preventa`.
- Redirecciones 301: `/ticketera-clubs` y `/ticketera-clubes` → `/ticketera-discotecas`. Sitemap: solo la URL principal (lo arma `landings.ts`).
- Alt de fotos descriptivos: *Pista de baile llena frente a la cabina del DJ con luces magenta*, *Persona del equipo escaneando el QR de una entrada en la puerta de un club, con fila detrás del cordón*, *Grupo de amigos riendo en una mesa VIP*, *Encargado del club revisando las ventas en su celular en la barra antes de abrir*.

---

## 10. Analítica

Prefijo `cl_`, mismo mecanismo que `MusicTracking.astro` (atributos `data-cl-*` + `CtaTracking`):
- `cl_view`, `cl_cta_click {position}` (`hero`, `closing`, `header`, `mobile_bar`), `cl_demo_click {position}`, `cl_whatsapp_click`, `cl_faq_open {question}`, `cl_section_view {section}`.
- Propios: `cl_uv_reveal {where}` (una vez por timbre: `hero`, `door`), `cl_month_night {weekday}`, `cl_rrpp_sort {by}`, `cl_rrpp_select {rrpp}`, `cl_link_copy`, `cl_night_scrub {hour}` (al soltar, con debounce; una vez por hora entera), `cl_night_replay`, `cl_ads_demo {budget, days}`, `cl_calc_preset {preset}`, `cl_calc_change {price, payer}` (debounce).

---

## 11. Componentes

Carpeta `src/components/landing/clubs/`; datos y cálculos sin Node en `clubsLanding.js` (como `musicaLanding.js`): fotos, tipos de entrada de ejemplo, fotogramas de la noche y su interpolación, filas del ranking (ingresos calculados), mes del club con su hora de cobro, serie de la semana con `DEFAULT_CADENCE`, cuenta regresiva al próximo viernes.

| Componente | Tipo | Notas |
|---|---|---|
| `ClubHeader.vue` | isla `client:idle` | patrón de `StandupHeader`, reloj de la noche en vez de barra de lectura |
| `NightClock.vue` | dentro del header | hora según scroll (22:00 → 06:00) |
| `ClubHero.astro` | estático + CSS | foto, H1 LED, card "Esta noche" |
| `LedSign.astro` | estático + script chico | letrero LED que rota mensajes por pasos |
| `LedHeading.astro` | estático | H1/H2 en Doto con grilla LED y palabras encendidas (prop `lit`) |
| `NightHour.astro` | estático | hora LED + etiqueta + tira LED |
| `UvStamp.astro` | estático + script chico | timbre SVG + linterna (máscara) |
| `CapsulePhoto.astro` | estático | `<picture>` en cápsula + fuga de luz (prop `leak: "uv" \| "magenta"`) |
| `ClubMonth.astro` | estático + script chico | calendario del mes con tooltip al tocar |
| `ClubStoryMockup.astro` | estático + CSS | historia de ejemplo |
| `ClubSeriesWeek.vue` | isla `client:visible` | slots calculados con `DEFAULT_CADENCE` |
| `ClubAdsDemo.vue` | isla `client:visible` | piel nueva sobre `useAdsDemo` (sin duplicar la matemática) |
| `RrppBoard.vue` | isla `client:visible` | ranking, orden, link de ejemplo |
| `NightLive.vue` | isla `client:visible` | panel de la noche + crossfader + burbuja de IA; SSR con el estado de 01:30 y tabla |
| `Crossfader.vue` | dentro de `NightLive` | `<input type="range">` con piel de mezclador |
| `ClubDoor.astro` | estático | foto + card "Válida" + ítems |
| `TableTicket.astro` | estático | ticket de mesa de ejemplo |
| `ServiceLights.astro` | estático + CSS | tubos que se encienden |
| `CashCloseCalculator.vue` | isla `client:visible` | presets + `priceQuote` + `usePayerToggle` + `useDelayedAnnouncement` |
| `NextNight.astro` | estático | tres cards de §4.9 |
| `ClubQuote.astro` | estático | no renderiza sin `CLUB_TESTIMONIAL` |
| `ClubClosing.astro` | estático + script chico | letrero + cuenta regresiva |
| `ClubTracking.astro` | script | eventos `cl_*` |

Compartidos sin cambios: `LandingFaq`, `LandingMobileBar` (`variant="pill"` con textos), `LandingMotion`, `CtaTracking`, `AppFooter tone="dark"`, `SoonBadge`. Cambios aditivos (anotar en el PR): entrada nueva en `landings.ts`; `CLUB_TESTIMONIAL` en `producerSocialProof.ts`; link en `AppFooter.vue`; redirecciones `/ticketera-clubs(es)`; dependencia `@fontsource/doto`.

Datos: `landings.ts` (§9), `src/data/clubsFaq.ts` (§4.11).

Tests (como música): unitario de `clubsLanding.js` (fotogramas: ingresados nunca bajan, ninguno supera emitidas ni aforo, sumas por tipo cuadran; hora de cobro = término + `PAYOUT_RELEASE_HOURS` cruzando la medianoche; ingresos del ranking = cantidades × precios; serie con `DEFAULT_CADENCE`; cuenta regresiva en hora de Chile) y e2e de la página (H1 visible sin JS, FAQ con JSON-LD, calculadora $10.000 → $10.952 / $10.000 y mesa $180.000 → $197.136, `Pronto` presente en lo de §0.6 que se muestra, sin testimonio cuando es `null`, con `prefers-reduced-motion` la noche queda en 01:30 y el timbre visible, las redirecciones responden 301). Agregar la URL a `tests/e2e/marketing.spec.ts` si lista las landings.

---

## 12. Fases (commits dentro del PR único)

1. **Página y tema:** tema `clubs`, Doto, hero (sin animación), mes del club, difusión estática, ranking estático, noche en vivo en su estado de 01:30 + tabla, puerta, mesas, precio con calculadora, próxima noche, FAQ, cierre sin cuenta regresiva, footer; `landings.ts`, `clubsFaq.ts`, redirecciones, link del footer; fotos de referencia en AVIF/WebP. Criterio: `npm run check` sin errores; Lighthouse móvil ≥ 90.
2. **Interacción:** crossfader y panel de la noche con la burbuja de IA, ranking ordenable con link, mes con tooltip, serie con `DEFAULT_CADENCE`, demo de anuncios, presets de la calculadora, linterna UV, reloj del header, cuenta regresiva.
3. **Movimiento:** C1–C16 y `prefers-reduced-motion`; analítica `cl_*`; tests.
4. **Contenido real:** fotos reales autorizadas (§8), testimonio, evento de ejemplo de club, nombres de ejemplo revisados.

---

## 13. Preguntas abiertas

1. **URL:** `/ticketera-discotecas` con 301 desde `/ticketera-clubs` y `/ticketera-clubes` es una apuesta por volumen de búsqueda en Chile ("discoteca"). Confirmar con Search Console o Keyword Planner; si el dueño prefiere "clubs", se invierte.
2. **Fotos reales:** ¿qué clubs que usan AI Tickets pueden aportar fotos con autorización? (§8)
3. **Evento de ejemplo:** no hay un evento demo de club en `demoEvent.mjs`. Mientras tanto el CTA secundario apunta a `/eventos/evento-demo-concierto` con el texto "Ver un evento de ejemplo". ¿Se crea `evento-demo-club` (noche con Lista free $0, Cover y Mesa VIP, viernes 23:30 → 05:00)? Requiere una migración de datos como `202610140200_demo_events_free_and_tour.sql`: no se hace sin el visto bueno.
4. **Control de hora de la lista ("free hasta la 1:00"):** hoy solo se cierra la inscripción. ¿Entra al roadmap que el escáner advierta o rechace una entrada de lista escaneada después de su hora? Va con `Pronto`; si no está en el plan, sacarlo.
5. **RRPP:** "cuántos de cada lista entraron" (check-ins por canal) y "acceso del RRPP a sus números" van con `Pronto`. ¿Están en el plan? La comisión automática por RRPP no se muestra: ¿hay interés?
6. **Mesas con una entrada por invitado** (`Pronto`): ¿es prioridad? Alternativa más simple: un tipo de entrada "pack" que emita N QR por unidad.
7. **Cover en la puerta / efectivo:** no existe. Es una objeción frecuente de discotecas. Confirmar la respuesta de la FAQ 11 (y si la venta sigue abierta durante la noche: revisar `end_date`/inicio de la función en el checkout antes de prometer "mientras haya cupo").
8. **Escáner y medianoche:** `getFunctionCheck` (checkin.mjs y `ValidateQR.vue`) compara la **fecha** de la función con el día de hoy en Chile: una entrada de una noche que empieza el viernes 23:30, escaneada el sábado a la 01:00, se marca como "de otra función" y pide confirmación. Es un bug para clubs (no se arregla en esta landing; abrir un issue: comparar contra la ventana inicio–término de la función, como ya hace `ledger.ts` con el cruce de medianoche). Mientras no se arregle, ni §4.6 ni la FAQ mencionan el aviso de "entrada de otra noche".
9. **Alcohol:** confirmar con el dueño el criterio legal (Ley 21.363) para la foto de mesas y el copy "consumo incluido", y que las piezas de anuncios de ejemplo no muestren alcohol.
10. **Edad mínima:** no hay verificación de edad ni preguntas en el checkout. ¿Se agrega un campo "edad mínima" al evento (lo leería el asistente de la página) o una pregunta obligatoria? Hoy la FAQ 8 lo dice tal cual.
11. **Doto:** confirmar con el dueño la tipografía de acento (alternativas LED/neón: Tilt Neon, Bungee). Verificar acentos y Ñ en el subset `latin`.
12. **Fiestas y seminarios:** se están diseñando en paralelo. Mantener la tabla de §1 actualizada para que ninguna repita paleta (aquí: violeta UV + rosa fluor + blanco servicio), tipografía de acento (Doto) ni firma (crossfader de la noche + linterna UV). Si fiestas toma neón o rosa, revisar.
13. **Reserva para clubs nuevos:** un club que recién se registra suma `new_producer` en `event-risk.mjs` (nivel medio → `RESERVE_BY_LEVEL.medium`% retenido hasta `RESERVE_HOLD_DAYS` días). La landing no lo menciona fuera de los términos (`*`). ¿Conviene una FAQ explícita para que no sea sorpresa en la primera noche?
14. **Lista de invitados en el panel:** hoy `aitickets_guests` solo se usa desde el asistente de IA. Si se agrega al panel, quitar "(desde tu asistente de IA)" de §4.4 y la FAQ 10.

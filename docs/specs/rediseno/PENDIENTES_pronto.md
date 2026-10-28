# Pendientes "Pronto": lo que las landings prometen y el producto todavía no hace

Inventario de todas las etiquetas **Pronto** (`src/components/ui/SoonBadge.vue`) que dejó el rediseño (PR #46).
Cada una es una promesa pública. Este documento dice, por cada una, dónde aparece, qué existe hoy en el código, qué
falta construir y qué hay que tocar en las landings cuando esté lista.

Estado al 27-10-2026, rama `rediseno/aitickets`.

## Cómo usar este documento

- Las promesas que se repiten en varios nichos van agrupadas en **una sola capacidad** (por ejemplo, "aviso automático a
  la lista de espera" aparece en música, fiestas, talleres y seminarios). Se construye una vez y se quitan todas las
  etiquetas juntas.
- **Prioridad** (P1 a P3) es una propuesta según cuántas landings la prometen y cuánto pesa en la venta del nicho.
  **Esfuerzo** (S, M o L) es una estimación gruesa, no una medición. Revisar ambas antes de planificar.
- La alternativa a construir algo es **sacar la promesa**. Cada ítem dice qué texto quitar en ese caso.
- Al cerrar cualquier ítem:
  1. Quitar el `SoonBadge` (o el chip `*-soon-chip`) de cada archivo listado.
  2. Reescribir el texto en presente y con el dato real (montos y plazos siempre desde `fees.mjs`, `legal.mjs` o
     `producerFaq.ts`).
  3. Actualizar el comentario de cabecera del componente y de la página (`src/pages/…astro`), que hoy explica por qué va
     con Pronto.
  4. Actualizar la FAQ del nicho si la menciona (`src/data/*Faq.ts`) y los tests que buscan el texto o el
     `data-testid` (por ejemplo `club-rrpp-soon`).
  5. Correr `npm run check`, `npm test` y los e2e de esa landing (sin `E2E_DB=1`).

## Resumen

| # | Capacidad | Nichos que la prometen | Prioridad | Esfuerzo |
|---|---|---|---|---|
| 1 | Publicación automática en Facebook, TikTok y Reels | Todos (organizadores, stand-up, teatro, música, clubs, fiestas, talleres, seminarios) | P2 | L |
| 2 | Segmentar anuncios por intereses o profesión | Stand-up, música, clubs, fiestas, seminarios | P2 | M |
| 3 | ~~Aviso automático a la lista de espera y verla en el panel~~ **Hecho** | Música, fiestas, talleres, seminarios | P1 | M |
| 4 | Abrir sola la siguiente tanda cuando se agota la anterior | Música, fiestas | P1 | M |
| 5 | Que cada promotor o RRPP vea sus números | Clubs, fiestas | P1 | M |
| 6 | Check-ins por canal ("cuántos de cada lista entraron") | Clubs | P2 | S |
| 7 | Aforo en vivo en el panel | Clubs, fiestas, seminarios | P2 | S |
| 8 | Validar la hora de ingreso de la lista | Clubs | P3 | S |
| 9 | Una entrada para cada invitado de la mesa | Clubs | P2 | M |
| 10 | Dirección que solo ven quienes compran | Fiestas | P2 | S |
| 11 | Repetir funciones con un patrón y copiar entradas a cada función | Teatro, talleres | P1 | M |
| 12 | Mostrar reseñas mientras quedan fechas | Teatro, talleres | P2 | S |
| 13 | Ocupación de cada función en una vista | Teatro | P2 | S |
| 14 | Borderó por función | Teatro | P2 | M |
| 15 | Preguntas al inscribirse | Talleres | P2 | M |
| 16 | Validar la misma entrada en varias sesiones o días | Talleres, seminarios | P1 | M |
| 17 | Agenda con expositores y salas | Seminarios | P3 | L |
| 18 | RUT y razón social de la empresa al comprar | Seminarios | P2 | M |
| 19 | Nombre de cada asistente en una compra de varias entradas | Seminarios | P2 | M |
| 20 | Certificados de asistencia | Seminarios | P3 | M |
| 21 | Imprimir credenciales con nombre | Seminarios | P3 | M |
| 22 | Publicar en LinkedIn desde el panel | Seminarios | P3 | M |
| 23 | Lista de asistentes y ventas separadas por función | Academias | P2 | S |

Recomendación de orden: 3, 4, 11 y 16 primero, porque son las que más se repiten y las que un productor nota en su
primera semana. Después 5, 6, 7 y 23, que salen casi de los mismos datos de check-in y ventas por link.

---

## 1. Publicación automática en Facebook, TikTok y Reels

**Dónde se promete**
- `src/components/landing/organizadores/MarketingSection.astro` ("Reel antes de la función", "Facebook y TikTok")
- `src/components/landing/MarketingWeek.vue` (redes no conectadas y switch del reel)
- `src/components/landing/standup/StandupMarketingWeek.vue` (reel)
- `src/components/landing/teatro/Intermission.astro`
- `src/components/landing/musica/SeriesTimeline.vue`
- `src/components/landing/clubs/ClubSeriesWeek.vue`
- `src/components/landing/fiestas/PartyDiffusion.astro`
- `src/components/landing/talleres/WorkshopDiffusion.astro`
- `src/components/landing/seminarios/SeminarDiffusion.astro`

**Qué hay hoy**
- Historias y posts automáticos solo en Instagram (`src/lib/socialSeries.ts`).
- La cadencia está en `src/lib/socialSeriesCadence.ts` (`DEFAULT_CADENCE`): una historia cada pocos días y diaria la
  última semana.
- Anuncios en Meta vía Zernio (`netlify/lib/zernio-ads.mjs`).

**Qué falta**
- Conectar una página de Facebook y publicar la misma serie. Probablemente sale por la misma integración de Meta.
- Conectar TikTok y publicar video. TikTok no acepta imagen sola como video: hay que generar un clip.
- Generar un reel (video vertical corto) desde el póster y los datos del evento, y publicarlo antes de la función.
- En el panel: conectar cada red, activarla o desactivarla por evento, y ver el estado de cada publicación.

**Criterio de aceptación**
Un evento con Facebook, TikTok e Instagram conectados publica la serie en las tres redes con la misma cadencia. Si una
red falla, se ve el error y no bloquea a las demás.

**Si se decide no hacerlo**
Quitar los chips Facebook, TikTok y Reels y la fila "Reel antes de la función" de los 9 archivos. Dejar solo Instagram.

## 2. Segmentar anuncios por intereses o profesión

**Dónde se promete**
Chips deshabilitados en las demos de anuncios:
- `standup/StandupAdsDemo.vue` ("Comedia y stand-up")
- `musica/MusicAdsDemo.vue` ("Gustos musicales")
- `clubs/ClubAdsDemo.vue` ("Música electrónica")
- `fiestas/PartyAdsDemo.vue` ("Reggaetón")
- `seminarios/SeminarAdsDemo.vue` ("Recursos humanos", por profesión)

**Qué hay hoy**
`adTargeting()` en `netlify/lib/zernio-ads.mjs` solo segmenta por ciudad (o todo Chile) y edad. `searchAdCities()` ya
usa `/ads/targeting/search` de Zernio con `dimension: 'geo'`.

**Qué falta**
- Buscar intereses con el mismo endpoint (otra dimensión; confirmar con Zernio qué expone de Meta).
- Guardar los intereses elegidos en la campaña y mandarlos en `adTargeting()`.
- Agregar el selector en el armado del anuncio, en el panel y en la herramienta de IA.
- Profesión o cargo (seminarios) en Meta es limitado; validar qué se puede antes de prometerlo.

**Criterio de aceptación**
Un anuncio creado con 1 a 3 intereses llega a Meta con esa segmentación, y se ve en el Ads Manager de la productora.

## 3. Aviso automático a la lista de espera y verla en el panel

**Hecho** (rama `feat/lista-de-espera`): `netlify/lib/waitlist.mjs` y la función programada
`send-waitlist-notifications` (cada 15 min) avisan una vez por persona y evento cuando hay una entrada comprable para
su evento o función; la tarjeta "Lista de espera" del panel (`EventWaitlistManager.vue`, `/api/events/waitlist-list`,
con CSV) aparece cuando hay anotados. Se quitaron los "Pronto" de música, fiestas, talleres y seminarios. Sin enlace
de baja: es un solo aviso que la persona pidió. Falta: verla desde el asistente de IA.

**Dónde se promete**
- `musica/MusicPresale.astro` ("Aviso automático")
- `musica/MusicCurveSection.astro` ("Aviso automático al abrir")
- `fiestas/PartyPresale.astro` (aviso a quienes dejaron el correo antes de abrir)
- `talleres/talleresLanding.js`, nota `waitlist`: "Ver esa lista y avisarles cuando se libere un cupo"
- `seminarios/SeminarBefore.astro` ("Ver la lista de espera y avisarles")

**Qué hay hoy**
`src/pages/api/events/waitlist.ts` guarda el correo en `aitickets_event_waitlist`, con `kind`, `full`, `sold_out` o
`sale_opens`, y `functionId` opcional. No avisa a nadie y la lista no se ve en el panel.

**Qué falta**
- **Envío automático**:
  - `sale_opens`: cuando empieza la venta de una entrada (su `init_date`), avisar a los anotados de ese evento o función.
  - `full` / `sold_out`: cuando se libera cupo (cancelación o devolución) o se abre una tanda nueva, avisar con el link.
  - Una función programada que revise los cambios y mande el correo con `mailer.mjs`.
  - Marcar a quién ya se avisó, para no repetir.
  - Link para darse de baja.
- **Panel**: lista por evento y función (correo, fecha, motivo, avisado sí o no), exportable. También como herramienta
  del asistente de IA.

**Criterio de aceptación**
Alguien que dejó su correo en un evento agotado recibe un solo correo cuando se abre la siguiente tanda. El productor ve
cuántos hay anotados y a quién se avisó.

## 4. Abrir sola la siguiente tanda cuando se agota la anterior

**Dónde se promete**
- `fiestas/PresaleStairs.vue` ("Que abra sola cuando se agota la anterior")
- `musica/MusicCurveSection.astro` ("Siguiente tanda automática")
- Comentario en `src/data/landings.ts:242`

**Qué hay hoy**
Cada tanda es un tipo de entrada con cupo y ventana de venta (`init_date`, `end_date`). La siguiente se abre por fecha o
a mano, no al agotarse la anterior.

**Qué falta**
- Un campo en el tipo de entrada, por ejemplo `opens_after_ticket_id`: queda oculta hasta que la tanda anterior llega a
  su cupo.
- Hacer la regla en el servidor al confirmar cada compra, no en el navegador, para evitar carreras entre compras
  simultáneas.
- Que la página del evento muestre la tanda siguiente como "se abre al agotarse la anterior".
- Encadena con el ítem 3: al abrir, avisar a la lista de espera.

**Criterio de aceptación**
Con Preventa 1 (cupo 100) y Preventa 2 encadenada, la compra número 100 de la primera deja la segunda a la venta sin
intervención. Dos compras simultáneas no sobrevenden la primera.

## 5. Que cada promotor o RRPP vea sus números

**Dónde se promete**
- `clubs/ClubList.astro` ("Cada RRPP ve sus números en su celular", `data-testid="club-rrpp-soon"`)
- `fiestas/PartyPromoters.astro` ("Cada promotor ve sus números en su celular")

**Qué hay hoy**
El productor ve las ventas por link. La atribución va por `?ref=` en `eventos/[slug].astro`, en `sessionStorage`. El
promotor no tiene acceso.

**Qué falta**
- Un link privado por promotor, sin cuenta y con token que se puede revocar (como el link temporal de puerta,
  `create_checkin_link`), que muestre solo sus ventas.
- La página debe mostrar entradas y monto por evento y función. No debe mostrar datos de compradores.
- Alternativa: un rol "Promotor" en `permissions.ts`, pero obliga a crear cuenta.

**Criterio de aceptación**
El promotor abre su link en el celular y ve cuántas entradas vendió en cada evento, actualizado. No ve nombres ni
correos de los compradores.

## 6. Check-ins por canal ("cuántos de cada lista entraron")

**Dónde se promete**
- `clubs/ClubList.astro` ("Cuántos de cada lista entraron")
- `clubs/RrppBoard.vue` (columna "Entraron" con "—")

**Qué hay hoy**
`get_checkin_stats` y `list_attendees` (`src/lib/producer-api/tools/access.ts`) dan los check-ins por tipo de entrada.
La venta guarda el link que la trajo.

**Qué falta**
Cruzar check-in con el link de la venta y mostrarlo en la vista de ventas por link y en el asistente de IA.

**Criterio de aceptación**
En la tabla de links, cada RRPP tiene "vendidas" y "entraron".

## 7. Aforo en vivo en el panel

**Dónde se promete**
- `clubs/NightLive.vue` ("Vista de aforo en el panel")
- `fiestas/PartyNight.astro` ("Aforo en vivo en el panel")
- `seminarios/SeminarAccreditation.astro` ("Aforo en vivo en el panel")

**Qué hay hoy**
Los check-ins por tipo de entrada solo se ven desde el asistente de IA (`get_checkin_stats`). La pantalla de puerta
(`ValidateQR.vue`) muestra su propio conteo.

**Qué falta**
Una vista en el panel con ingresados sobre el total, por tipo de entrada y función, que se refresque sola (polling o
realtime de Supabase).

**Criterio de aceptación**
Con la puerta escaneando, el panel muestra el número subiendo sin recargar, con menos de 10 segundos de atraso.

## 8. Validar la hora de ingreso de la lista

**Dónde se promete**
- `clubs/ClubDoor.astro` ("Rechazar la lista después de su hora")
- `clubs/NightLive.vue` ("Validar la hora de ingreso de la lista")

**Qué hay hoy**
Se cierra la inscripción a la lista (fin de venta). En la puerta, la entrada se valida a cualquier hora.

**Qué falta**
- Un campo "válida hasta" en el tipo de entrada.
- Que `netlify/functions/confirm-ticket` responda "fuera de horario" pasada esa hora.
- Que `ValidateQR.vue` muestre ese resultado y permita forzar el ingreso.

**Criterio de aceptación**
Una entrada de lista "hasta 01:00" escaneada a las 01:05 se marca en ámbar como "fuera de horario" y la puerta decide.

## 9. Una entrada para cada invitado de la mesa

**Dónde se promete**
`clubs/ClubTables.astro` ("Una entrada para cada invitado de la mesa").

**Qué hay hoy**
Una mesa es un tipo de entrada. Una compra genera un QR. Se resuelve a mano con cortesías (`CourtesyTicketsForm.vue`),
cada una con su QR.

**Qué falta**
- Un tipo de entrada "mesa para N" que al pagarse emita N entradas.
- Que quien compra pueda reenviar cada una por correo o WhatsApp (nombre opcional).
- Revisar `netlify/lib/tickets.mjs` (`buildAttendeeRows`) y el correo de la orden.

**Criterio de aceptación**
Comprar "Mesa VIP · 6 personas" deja 6 QR distintos en la orden, que se pueden compartir y se validan uno por uno.

## 10. Dirección que solo ven quienes compran

**Dónde se promete**
`fiestas/PartyPage.astro` ("Dirección que solo ven quienes compran").

**Qué hay hoy**
La página muestra la comuna. La dirección se manda con un correo programado desde el asistente
(`src/lib/producer-api/tools/messaging.ts`).

**Qué falta**
- Un campo "dirección privada" en el evento.
- Que la página pública muestre solo la comuna.
- Que la orden, el correo de la entrada y el recordatorio muestren la dirección. Opcional: que se revele X horas antes.

**Criterio de aceptación**
La dirección no aparece en el HTML público del evento ni en su JSON-LD, y sí en la orden de quien compró.

## 11. Repetir funciones con un patrón y copiar entradas a cada función

**Dónde se promete**
- `teatro/TheatreActOne.astro` ("Repetir funciones de jueves a domingo", "Copiar las entradas a cada función")
- `talleres/talleresLanding.js`, nota `repeat`: 'Repetir "todos los sábados" en un paso'

**Qué hay hoy**
Hasta 60 funciones por evento (`MAX_FUNCTIONS` en `src/lib/producer-api/tools/schedule.ts`), cargadas una por una.
También se puede duplicar el evento.

**Qué falta**
- En el editor de fechas: "repetir" con días de la semana, hora y fecha de término, que cree las funciones de una vez
  (respetando el tope de 60).
- Opción "copiar estos tipos de entrada a cada función nueva".
- La misma capacidad en la herramienta de IA (`schedule.ts`).

**Criterio de aceptación**
"Jueves a domingo, 20:00, hasta el 30 de noviembre" crea todas las funciones con sus entradas en un paso. Si pasa de
60, avisa antes de crear.

## 12. Mostrar reseñas mientras quedan fechas

**Dónde se promete**
- `teatro/TheatreSeason.astro` ("Mostrar las reseñas en la página mientras la obra sigue en cartelera")
- `talleres/WorkshopAfter.astro` ("…mientras el taller sigue con fechas")

**Qué hay hoy**
Las reseñas se muestran solo cuando el evento terminó (`EventDetail.vue`, `showReviews`).

**Qué falta**
- Mostrar las reseñas de funciones pasadas aunque queden funciones futuras.
- Una opción por evento para activarlo. Ojo con el layout de la card v2 en estado "en venta".

**Criterio de aceptación**
Una obra con funciones pasadas reseñadas y funciones futuras a la venta muestra las reseñas y el botón de compra.

## 13. Ocupación de cada función en una vista

**Dónde se promete**
`teatro/TheatreSeason.astro` ("Ocupación de cada función en una vista").

**Qué hay hoy**
Emitidas y cupo por tipo de entrada.

**Qué falta**
Una tabla en el panel con una fila por función: vendidas, cortesías, cupo y porcentaje. Comparte datos con los ítems 7
y 23.

## 14. Borderó por función

**Dónde se promete**
`teatro/TheatreVenues.astro` ("Borderó por función").

**Qué hay hoy**
CSV de órdenes (`src/pages/api/events/orders-csv.ts`).

**Qué falta**
- Un documento por función para liquidar con la sala, con entradas por tipo y precio, cortesías, bruto, cargos y neto.
- Exportarlo en PDF o planilla.
- Definir el formato con una sala real antes de construirlo.

## 15. Preguntas al inscribirse

**Dónde se promete**
`talleres/BeforeWorkshop.astro` (ítem con `soon: true`).

**Qué hay hoy**
Cada inscripción guarda nombre y correo de quien compra.

**Qué falta**
- Preguntas configurables por evento (texto corto, opción, sí o no), obligatorias u opcionales.
- Pedirlas en el checkout y en `RsvpForm` para eventos gratis.
- Verlas en la lista de asistentes y en el CSV.

## 16. Validar la misma entrada en varias sesiones o días

**Dónde se promete**
- `talleres/WorkshopDay.astro` ("Pasar lista en cada sesión")
- `talleres/talleresLanding.js`, nota `roll`
- `seminarios/SeminarAccreditation.astro` ("Ingreso cada día con el mismo pase")
- `seminarios/ProgramBuilder.vue`

**Qué hay hoy**
`netlify/functions/confirm-ticket` valida una entrada una sola vez. Una entrada "para todas las funciones"
(`event_date_id` NULL) se acredita el primer día.

**Qué falta**
- Registrar el check-in por entrada **y función**, en vez de un solo flag por entrada.
- Una entrada multifunción queda válida una vez en cada función.
- Que `ValidateQR.vue` pida o deduzca la función que se está validando.
- Asistencia por sesión en la lista de asistentes.

**Criterio de aceptación**
Un pase de 3 días entra una vez cada día. El segundo escaneo del mismo día dice "Ya ingresó hoy".

## 17. Agenda con expositores y salas

**Dónde se promete**
`seminarios/ProgramBuilder.vue` ("Agenda con expositores y salas").

**Qué falta**
- Un modelo de bloques de agenda: hora, título, expositor, sala y función.
- Editarlos en el panel.
- Mostrarlos en la página del evento.
- Es lo más grande de seminarios. Validar demanda antes de construirlo.

## 18. RUT y razón social de la empresa al comprar

**Dónde se promete**
`seminarios/SeminarCompanies.astro` ("RUT y razón social de la empresa al comprar").

**Qué hay hoy**
El comprobante es `LEGAL.receiptLabel`, que no es boleta ni factura.

**Qué falta**
- Campos opcionales de empresa en el checkout, con validación de RUT, guardados en la orden y mostrados en el
  comprobante y el CSV.
- **Revisar con abogado y contador** antes: pedir RUT puede generar la expectativa de factura (comentario en
  `src/data/landings.ts:307`).

## 19. Nombre de cada asistente en una compra de varias entradas

**Dónde se promete**
`seminarios/TeamOrder.vue` ("Que la empresa escriba el nombre de cada asistente al comprar").

**Qué falta**
- Nombre y correo por entrada en el checkout cuando la cantidad es mayor a 1 (opcional por evento).
- Mandar cada QR a su asistente.
- Es la base de los ítems 20 y 21, y comparte trabajo con el ítem 9.

## 20. Certificados de asistencia

**Dónde se promete**
`seminarios/SeminarAfter.astro` (ítem con `soon: true`).

**Qué hay hoy**
La lista de quienes ingresaron (`list_attendees`).

**Qué falta**
- Un PDF con nombre, evento, fecha y horas, enviado después del evento solo a quienes hicieron check-in.
- Depende del ítem 19, porque sin nombre por asistente el certificado sale a nombre de quien compró.
- Si se usa el ítem 16, permitir certificar solo a quien asistió a X sesiones.

## 21. Imprimir credenciales con nombre

**Dónde se promete**
- `seminarios/SeminarAccreditation.astro` ("Imprimir credenciales con nombre")
- `seminarios/Credential.vue` (comentario)

**Qué falta**
- Un PDF imprimible con una credencial por asistente: nombre, empresa, tipo de entrada y QR.
- Depende del ítem 19.

## 22. Publicar en LinkedIn desde el panel

**Dónde se promete**
`seminarios/SeminarDiffusion.astro` ("Publicar en LinkedIn desde tu panel").

**Qué falta**
- Conectar una página de empresa de LinkedIn y publicar el anuncio del evento, o una serie corta.
- La API de LinkedIn exige aprobación del producto.
- Comparte diseño con el ítem 1.

## 23. Lista de asistentes y ventas separadas por función

**Dónde se promete**
`academias/CourseBreakdown.vue` (nota "Por función").

**Qué hay hoy**
Las ventas por link y la lista de asistentes son por evento.

**Qué falta**
- Filtro por función en la lista de asistentes y en ventas por link, y en el CSV.
- Comparte datos con los ítems 7 y 13.

---

## Cosas que se dice que NO existen (sin "Pronto", a propósito)

No son pendientes. Las landings dicen que no existen y no prometen nada:
- Butacas numeradas o mapa de asientos (teatro, música, `src/data/teatroFaq.ts`).
- Plano de mesas (clubs, `ClubTables.astro`).

Si alguna se vuelve prioridad, agregarla a este documento antes de cambiar el texto.

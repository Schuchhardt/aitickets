# Pendientes "Pronto": lo que las landings prometen y el producto todavía no hace

Inventario de todas las etiquetas **Pronto** (`src/components/ui/SoonBadge.vue`) que dejó el rediseño (PR #46).
Cada una es una promesa pública. Este documento dice, por cada una, dónde aparece, qué existe hoy en el código, qué
falta construir y qué hay que tocar en las landings cuando esté lista.

Estado al 28-10-2026: todos los ítems están hechos (el último lote, en la rama `feat/pronto-resto`). Ya no queda
ningún "Pronto" en las landings.

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
| 1 | ~~Publicación automática en Facebook, TikTok y Reels~~ **Hecho** | Todos (organizadores, stand-up, teatro, música, clubs, fiestas, talleres, seminarios) | P2 | L |
| 2 | ~~Segmentar anuncios por intereses o profesión~~ **Hecho** | Stand-up, música, clubs, fiestas, seminarios | P2 | M |
| 3 | ~~Aviso automático a la lista de espera y verla en el panel~~ **Hecho** | Música, fiestas, talleres, seminarios | P1 | M |
| 4 | ~~Abrir sola la siguiente tanda cuando se agota la anterior~~ **Hecho** | Música, fiestas | P1 | M |
| 5 | ~~Que cada promotor o RRPP vea sus números~~ **Hecho** | Clubs, fiestas | P1 | M |
| 6 | ~~Check-ins por canal ("cuántos de cada lista entraron")~~ **Hecho** | Clubs | P2 | S |
| 7 | ~~Aforo en vivo en el panel~~ **Hecho** | Clubs, fiestas, seminarios | P2 | S |
| 8 | ~~Validar la hora de ingreso de la lista~~ **Hecho** | Clubs | P3 | S |
| 9 | ~~Una entrada para cada invitado de la mesa~~ **Hecho** | Clubs | P2 | M |
| 10 | ~~Dirección que solo ven quienes compran~~ **Hecho** | Fiestas | P2 | S |
| 11 | ~~Repetir funciones con un patrón y copiar entradas a cada función~~ **Hecho** | Teatro, talleres | P1 | M |
| 12 | ~~Mostrar reseñas mientras quedan fechas~~ **Hecho** | Teatro, talleres | P2 | S |
| 13 | ~~Ocupación de cada función en una vista~~ **Hecho** | Teatro | P2 | S |
| 14 | ~~Borderó por función~~ **Hecho** | Teatro | P2 | M |
| 15 | ~~Preguntas al inscribirse~~ **Hecho** | Talleres | P2 | M |
| 16 | ~~Validar la misma entrada en varias sesiones o días~~ **Hecho** | Talleres, seminarios | P1 | M |
| 17 | ~~Agenda con expositores y salas~~ **Hecho** | Seminarios | P3 | L |
| 18 | ~~RUT y razón social de la empresa al comprar~~ **Hecho** | Seminarios | P2 | M |
| 19 | ~~Nombre de cada asistente en una compra de varias entradas~~ **Hecho** | Seminarios | P2 | M |
| 20 | ~~Certificados de asistencia~~ **Hecho** | Seminarios | P3 | M |
| 21 | ~~Imprimir credenciales con nombre~~ **Hecho** | Seminarios | P3 | M |
| 22 | ~~Publicar en LinkedIn desde el panel~~ **Hecho** | Seminarios | P3 | M |
| 23 | ~~Lista de asistentes y ventas separadas por función~~ **Hecho** | Academias | P2 | S |

Recomendación de orden: 3, 4, 11 y 16 primero, porque son las que más se repiten y las que un productor nota en su
primera semana. Después 5, 6, 7 y 23, que salen casi de los mismos datos de check-in y ventas por link.

---

## 1. Publicación automática en Facebook, TikTok y Reels

**Hecho (rama `feat/pronto-resto`).** Migración `202610300400_social_series_networks.sql`: `networks` (estado por red) y `reel_enabled` en la
serie; `platform` y `video_url` en los slots, con `kind` 'reel'.
- Facebook (página) publica las mismas historias y posts, con el link en el texto (`fb-serie`) y DM por Messenger al
  comentar la palabra (`fb-post-dm`).
- TikTok publica una foto vertical por día la última semana, con el link en la descripción (`tiktok-serie`). Zernio
  exige `tiktokSettings` y permite 15 photo posts al día por cuenta.
- Cada red tiene sus propias piezas: si una falla o se desconecta, se omiten sus pendientes y se avisa; las demás siguen.
  Al reconectarla, se retoma desde ese día.
- Se activa por evento en "Difusión automática" (`SocialSeriesCard.vue`) o con `prepare_social_series`
  (`facebook_enabled`, `tiktok_enabled`, `reel_enabled`).
- El reel usa el video vertical del evento (3 a 60 s) y sale cerca de D-3 en cada red activa.
- Sin las columnas, la serie queda solo en Instagram.
- **AI Tickets no genera video desde el afiche**: Zernio no lo hace y las funciones no tienen codificador. Las landings
  dicen "Reel con tu video" en vez de "Reels". El panel (subir video y la tarjeta de difusión) enlaza a las plantillas de
  reel de Canva (`CANVA_REEL_URL` en `src/lib/socialPlatforms.ts`) para armarlo con el afiche y subirlo.

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

**Hecho (rama `feat/pronto-resto`).** Sin migración.
- `searchAdAudience` (`zernio-ads.mjs`) busca intereses y cargos de Meta vía Zernio (`/ads/targeting/search`, dimensiones
  `interest` y `workPosition`).
- El armado del anuncio deja elegir hasta 3 intereses y hasta 3 cargos (`CreateAdCampaign.vue`,
  `/api/promote/ads/targeting?dimension=`).
- Se guardan en `ad_campaigns.target_audience` y se mandan en `adTargeting` (create y boost).
- Los cargos solo llegan a quien informó su cargo en Facebook, y el armado lo dice.
- Demos de stand-up, música, clubs, fiestas y seminarios sin "Pronto".

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
de baja: es un solo aviso que la persona pidió. El asistente de IA la ve con `list_waitlist`.

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

**Hecho (rama `feat/pendientes-2`).** `event_tickets.opens_after_ticket_id` (migración `202610290100_ticket_chain.sql`)
encadena una tanda a la anterior. La regla vive en `netlify/lib/tickets.mjs` (`waitingOnPrevious`, `chainError`): la
siguiente se vende cuando la anterior se agota (vendidas + reservas vigentes = cupo), cierra su ventana o se pausa. La
aplican la compra (`purchase-tickets`, 409 "se abre cuando se agote…"), la página del evento ("Se abre al agotarse…" en
el checkout), el chat del comprador, la lista de espera y la API (`create_ticket_type` / `update_ticket_type` con
`opens_after_ticket_type_id`; `get_event` dice cuál espera). En los formularios de crear y editar evento cada entrada
tiene "Venta: se vende desde ya / se abre al agotarse…". Al duplicar un evento se copia la cadena. Sin "Pronto" en
música ni fiestas. Si se cae una reserva de la anterior, vuelve a venderse primero la anterior (la regla es en vivo, no
queda "abierta" para siempre). Dos compras simultáneas no sobrevenden la anterior: lo sigue garantizando
`aitickets_reserve_order`.

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

**Hecho (rama `feat/links-promotores`).** Link privado por promotor, sin cuenta y revocable: tabla
`aitickets_promoter_links` (migración `202610290300_promoter_links.sql`; solo el sha256 del token, como los links de
puerta) y página `/promotor/<token>` (`src/lib/promoterLinks.ts`).
- El promotor ve solo las órdenes pagadas con su `ref` (sin mayúsculas/minúsculas; sin cortesías ni transferencias):
  entradas, monto y compras por evento, desglose por función y su link `?ref=` para copiar en cada evento a la venta.
  Nunca nombres, correos ni teléfonos. Se calcula en cada visita ("Actualizar").
- Alcance: todos los eventos de la productora (un RRPP de todas las noches) o un evento. Muestra los eventos con ventas
  suyas y los publicados que no terminaron hace más de 2 días.
- Se crea desde el panel del evento (módulo "Promotores y RRPP" en Difusión, sugerido para noche y música;
  `PromoterLinksManager.vue`, `/api/events/promoter-links`) o el asistente de IA (`create_promoter_link`,
  `list_promoter_links`, `revoke_promoter_link`). Un miembro con acceso solo a algunos eventos crea links de esos eventos.
- Landings de clubs y fiestas y la FAQ de ventas por promotor sin "Pronto".

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

**Hecho (rama `feat/checkins-por-canal`).** `loadOrderCheckins` (`src/lib/eventAnalytics.ts`) cuenta por orden las
entradas vigentes y las validadas (`event_attendees.event_order_id`); una entrada transferida cuenta en su venta
original (`transferred_from_order`, siguiendo la cadena). Sin cortesías, igual que las ventas. Sin migración.
- Analítica del evento: "Ventas por canal" suma la columna "Entraron" (`channelConversion`, `checked_in`).
- Asistente de IA: `get_checkin_stats` trae `by_channel` (entradas, entraron, pendientes y % por link o UTM) y
  `get_event_performance` trae `checked_in` en `channel_conversion`.
- Landing de clubs: "Cuántos de cada lista entraron" sin "Pronto". El ranking de ejemplo es de las 20:00 (antes de
  abrir), así que pierde la columna "Entraron" en vez de mostrar números inventados.

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

**Hecho (rama `feat/aforo-en-vivo`).** Módulo "Aforo en vivo" en la pestaña Puerta del panel del evento
(`LiveCapacityPanel.vue`, `live-capacity` en `eventModules.ts`, aparece cuando hay entradas emitidas). Durante el evento
el panel abre en esa pestaña.
- Datos: `/api/events/checkin-stats`, que es la herramienta `get_checkin_stats` con la sesión del usuario
  (`producer-api/session.ts`): adentro sobre emitidas y sobre la capacidad, por tipo de entrada y función, y llegadas
  cada 15 minutos. Permiso `checkin`, con el acceso por evento del equipo. Sin migración.
- Se refresca cada 5 segundos (polling) mientras la tarjeta está a la vista y la pestaña del navegador activa.
- Landings de clubs, fiestas y seminarios sin "Pronto" en el aforo del panel.

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

**Hecho (rama `feat/pronto-resto`).** `event_tickets.entry_until` (migración `202610300300_ticket_entry_until.sql`): hora límite de
ingreso en hora de Chile, relativa a la función.
- Si es antes del inicio, cuenta como la madrugada siguiente. La regla está en `src/lib/entryDeadline.mjs`, y la usan el
  servidor y el escáner sin conexión.
- Pasada la hora, `/api/confirm-ticket`, `/api/door/<token>/confirm` y `check_in_attendee` responden 409 `late_entry` sin
  marcar el ingreso, salvo con `force: true`.
- `ValidateQR.vue` lo muestra en ámbar con "Dejar entrar igual".
- Se configura con "Ingreso hasta" en los formularios de entradas y con `entry_until` en `create_ticket_type` /
  `update_ticket_type`.
- Sin la columna, se entra a cualquier hora, como antes. Landing de discotecas sin "Pronto".
- Pendiente: la lista de asistentes no marca quién entró tarde.

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

**Hecho (rama `feat/pronto-resto`).** `event_tickets.people_per_ticket` (migración `202610300110_table_tickets.sql`).
- Una "Mesa VIP · 6 personas" emite 6 QR por mesa vendida (`buildAttendeeRows`, mismo `unit_id`, `seat_number` 1..6). Se
  validan uno por uno.
- Cupo, precio y máximo por compra son por mesa:
  - `aitickets_reserve_order` no cambia (mismo bloqueo).
  - `aitickets_ticket_availability` cuenta una mesa mientras tenga algún QR vigente.
  - `findOversell` cuenta igual.
- La ocupación por función y `get_checkin_stats` cuentan el cupo en personas (mesas × N).
- En la orden, cada QR tiene "Compartir" (su `/ticket/<id>`) y dice "invitado 2 de 6". Con "Nombre de cada asistente" se
  pide un nombre por invitado.
- Se configura en crear/editar evento ("Personas por entrada") y con `create_ticket_type` / `update_ticket_type`
  (`people_per_ticket`). Landing de clubs sin "Pronto".
- Pendiente: una cortesía de mesa emite un solo QR.

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

**Hecho (rama `feat/pronto-resto`).** La dirección privada (`events.secret_location`) se carga en los formularios del evento y con
`update_event` (`private_address`).
- `secret_location_reveal_hours` (migración `202610300310_secret_location_reveal.sql`) la revela N horas antes de la
  primera función de la entrada.
- Lo público muestra el lugar y la comuna, sin calle ni coordenadas: página, JSON-LD, meta, `events.location` de los
  listados y sitios, chat del comprador, invitaciones y copy de redes.
- La orden, la entrada, el correo y el recordatorio la muestran desde que se revela; antes dicen cuándo llega.
- `send-secret-location` (cada 15 min) la manda por correo una vez por persona. Lógica en
  `netlify/lib/secret-location.mjs`.
- Lo público dice "Lugar secreto" y la comuna (`SECRET_PLACE_NAME`, `publicPlace`): ni el nombre del recinto, que en un
  lugar conocido delata la dirección. Lo mismo las piezas de la difusión automática y el copy de redes.
- Cuándo se revela: el día del evento (por defecto al activarla: a las 9:00, o al empezar si es antes; valor 0,
  migración `202610310200_secret_location_event_day.sql`), N horas antes o apenas compran.
- Ojo: los eventos antiguos conservan la calle en `events.location` hasta que se vuelven a guardar.
- Landing de fiestas sin "Pronto".

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

**Hecho (rama `feat/repetir-funciones`).** El patrón vive en `src/lib/functionPattern.mjs` (`MAX_FUNCTIONS`,
`repeatDates`) y lo usan los dos lados:
- Formularios de crear y editar evento: "Repetir en varios días" bajo las funciones de cada lugar
  (`FunctionRepeat.vue`: días, desde, hasta, hora) muestra cuántas funciones agrega y avisa antes de pasar de 60.
  En el paso de entradas, "Copiar a cada función" (`TicketCopyToFunctions.vue`) copia las entradas de la primera
  función con entradas propias (o las de "Todas las funciones", que pasan a la primera) a cada función que no tiene,
  con las tandas encadenadas dentro de cada función. En el editor no reasigna entradas guardadas de "Todas las
  funciones" (pueden tener ventas). Lógica en `src/components/events/functionRepeat.js`.
- El servidor rechaza más de 60 funciones al crear o guardar (`assertFunctionCount`).
- `update_event_functions` acepta `repeat` (`weekdays`, `from`, `until`, `start_time`, `end_time`) y
  `copy_tickets_from_function_id`; omite fechas repetidas o pasadas y, si quedarían más de 60, no crea nada.
- Landings: sin "Pronto" en teatro (Acto I) ni en la nota `repeat` de talleres.

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

**Hecho (rama `feat/pronto-resto`).** Sin migración: `review_settings.show_while_on_sale`.
- Con la opción activa, desde que pasa la primera función la página muestra las reseñas de las funciones pasadas junto al
  botón de compra, y la nota en las insignias, si ya hay alguna.
- Se activa en la configuración de reseñas del panel y con `update_review_settings`. El módulo aparece en cartelera con
  varias funciones.
- El correo "¿Cómo estuvo?" ya salía 24 h después de cada función.
- Landings de teatro y talleres sin "Pronto".

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

**Hecho (rama `feat/ocupacion-por-funcion`).** Sin migración. `functionOccupancy` (`src/lib/eventAnalytics.ts`): por
función, vendidas, cortesías, emitidas (sin anuladas), ingresadas, cupo (suma de sus tipos de entrada; sin límite si
alguno lo es) y % = emitidas ÷ cupo. Las entradas de tipos sin función (pase completo, tipo "Cortesía") van en su propia
fila.
- Panel del evento: módulo "Ocupación por función" en Entradas y ventas, con más de una función (`function-occupancy`
  en `eventModules.ts`).
- Asistente de IA: `get_event_performance` trae `occupancy_by_function`.
- Landing de teatro: sin "Pronto" en la ocupación por función.

**Dónde se promete**
`teatro/TheatreSeason.astro` ("Ocupación de cada función en una vista").

**Qué hay hoy**
Emitidas y cupo por tipo de entrada.

**Qué falta**
Una tabla en el panel con una fila por función: vendidas, cortesías, cupo y porcentaje. Comparte datos con los ítems 7
y 23.

## 14. Borderó por función

**Hecho (rama `feat/pronto-resto`).** Sin migración. `src/lib/functionSettlement.ts` arma el borderó de una función:
- entradas por tipo y precio y cortesías;
- bruto y descuentos;
- cargo por servicio, el que pagaron los compradores y el absorbido;
- neto al productor.

Las compras de varias funciones se reparten con `orderForFunction`, que ahora también reparte el cargo y su IVA.
- Se imprime o guarda en PDF en `/dashboard/events/<id>/bordero` y se descarga en planilla
  (`/api/events/function-settlement`).
- Se enlaza desde "Ocupación por función" y "Ventas por función".
- En el asistente de IA: `get_function_settlement`.
- Solo órdenes pagadas, sin reembolsadas ni transferencias.
- Pendiente: validar el formato con una sala real. Los reembolsos parciales no se descuentan.

**Dónde se promete**
`teatro/TheatreVenues.astro` ("Borderó por función").

**Qué hay hoy**
CSV de órdenes (`src/pages/api/events/orders-csv.ts`).

**Qué falta**
- Un documento por función para liquidar con la sala, con entradas por tipo y precio, cortesías, bruto, cargos y neto.
- Exportarlo en PDF o planilla.
- Definir el formato con una sala real antes de construirlo.

## 15. Preguntas al inscribirse

**Hecho (rama `feat/pronto-resto`).** Hasta 8 preguntas por evento (texto corto, elegir una opción, sí o no; obligatorias u opcionales)
en `events.checkout_fields.questions` (migración `202610300100_checkout_fields.sql`, reglas en
`src/lib/checkoutFields.mjs`).
- Se editan en crear/editar evento ("Qué pedir al comprar", `CheckoutFieldsEditor.vue`) y con `update_event`.
- Se piden una vez por compra en el checkout y en el registro gratis (`CheckoutExtras.vue`).
- El servidor las valida y las guarda en `event_orders.registration_answers`.
- Se ven en `/dashboard/tickets`, en el CSV de órdenes (una columna por pregunta), en `list_attendees`, `get_order` y
  `list_orders`, y en la orden.
- Landing de talleres sin "Pronto".
- Pendiente: respuestas por asistente (hoy, por compra).

**Dónde se promete**
`talleres/BeforeWorkshop.astro` (ítem con `soon: true`).

**Qué hay hoy**
Cada inscripción guarda nombre y correo de quien compra.

**Qué falta**
- Preguntas configurables por evento (texto corto, opción, sí o no), obligatorias u opcionales.
- Pedirlas en el checkout y en `RsvpForm` para eventos gratis.
- Verlas en la lista de asistentes y en el CSV.

## 16. Validar la misma entrada en varias sesiones o días

**Hecho (rama `feat/checkin-por-funcion`).** Tabla `aitickets_attendee_checkins` (migración
`202610290200_attendee_checkins.sql`): una fila por entrada y función, con `UNIQUE (event_attendee_id, event_date_id)`.
- Una entrada "para todas las funciones" de un evento con más de una función entra una vez en cada función
  (`checkInSession` en `netlify/lib/checkin.mjs`). La función se deduce de la hora del escaneo en hora de Chile
  (`pickSession` en `src/lib/sessionCheckin.mjs`): la de hoy; con dos el mismo día, la que ya empezó o empieza dentro
  de 2 horas; si hoy no hay, la más cercana. Una validación offline se registra en el día en que se escaneó.
- El segundo escaneo del mismo día responde 409 `already_validated` con "Ya ingresó hoy.". En el primer ingreso la
  entrada queda `validated` (validated_at = primer ingreso), así "asistió" significa lo mismo en estadísticas,
  reseñas y mensajes.
- Lo usan `/api/confirm-ticket`, `/api/door/<token>/confirm` y `check_in_attendee` (este último responde
  `sessions_attended` de `sessions_total`). `validate-ticket` y las 5 fuentes de la lista del escáner devuelven el
  estado de la función de hoy (`session_checkins` + `sessionView`), también sin conexión.
- El escáner (`ValidateQR.vue`) muestra "Ingreso 2 de 3" al validar y "Pase de N funciones · fue a X" en la lista.
  `get_checkin_stats` agrega `multi_pass_check_ins_by_function`.
- Backfill: las multifunción ya validadas quedan registradas en la función del día en que se validaron.
- Si la tabla aún no existe, todo vuelve a la regla de un solo ingreso.
- Landings: talleres (pasar lista en cada sesión) y seminarios (ingreso cada día con el mismo pase) sin "Pronto".

Pendiente: la lista de asistentes de `/dashboard/tickets` sigue mostrando solo validado sí/no.

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

**Hecho (rama `feat/pronto-resto`).** Tabla `aitickets_event_agenda` (migración `202610300200_event_agenda.sql`).
- Cada bloque tiene inicio y término, título, expositores (texto), sala y función (`event_date_id`; NULL = todos los
  días).
- Lógica en `src/lib/eventAgenda.mjs`.
- Se edita en el panel (módulo "Agenda" en Página, `EventAgendaManager.vue`) o con `get_event_agenda` /
  `update_event_agenda`.
- La página del evento la muestra por día, solo si hay bloques. El chat de la página la usa.
- Pendiente: expositores con foto y JSON-LD `subEvent`.

**Dónde se promete**
`seminarios/ProgramBuilder.vue` ("Agenda con expositores y salas").

**Qué falta**
- Un modelo de bloques de agenda: hora, título, expositor, sala y función.
- Editarlos en el panel.
- Mostrarlos en la página del evento.
- Es lo más grande de seminarios. Validar demanda antes de construirlo.

## 18. RUT y razón social de la empresa al comprar

**Hecho (rama `feat/pronto-resto`).** Ajuste por evento `checkout_fields.company`.
- En compras pagadas, el checkout ofrece "¿Compras para una empresa?" con RUT (con dígito verificador, `isValidRut`) y
  razón social, opcionales.
- Al lado dice que salen en el comprobante de compra, que no es boleta ni factura.
- Se guardan en `event_orders.company_rut` / `company_name` y salen en el comprobante, en el CSV de órdenes, en
  `get_order` / `list_orders` y en las credenciales.
- Landing de seminarios sin "Pronto".
- **Pendiente: revisarlo con abogado y contador** antes de promoverlo, por la expectativa de factura.

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

**Hecho (rama `feat/pronto-resto`).** Ajuste por evento "Nombre de cada asistente" (no pedir / opcional / obligatorio) en
`events.checkout_fields`.
- En compras con más de un QR, el checkout y el registro gratis piden nombre y correo por entrada. La primera vacía es
  quien compra.
- Se guarda en `event_orders.attendee_holders`; al emitir, cada QR toma el suyo (`event_attendees.holder_name` /
  `holder_email`).
- Quien compra recibe todas. Cada asistente con correo propio recibe la suya en el primer envío
  (`renderHolderTicketEmail`).
- Se ve en `/dashboard/tickets`, el CSV, `list_attendees`, `get_order`, el escáner y la orden.
- Pendiente: editar el asistente después de comprar (hoy, `transfer_ticket`).

**Dónde se promete**
`seminarios/TeamOrder.vue` ("Que la empresa escriba el nombre de cada asistente al comprar").

**Qué falta**
- Nombre y correo por entrada en el checkout cuando la cantidad es mayor a 1 (opcional por evento).
- Mandar cada QR a su asistente.
- Es la base de los ítems 20 y 21, y comparte trabajo con el ítem 9.

## 20. Certificados de asistencia

**Hecho (rama `feat/pronto-resto`).** `src/lib/certificates.ts`, PDF con jsPDF en `src/lib/attendeePdf.mjs`.
- Solo para entradas `validated`, con el nombre del titular o de quien compró.
- Incluye las fechas y horas de las funciones a las que fue, o las que fije el productor.
- En un pase de varias funciones se puede exigir un mínimo de funciones con ingreso.
- Panel: módulo "Certificados de asistencia" en Asistentes y después (`CertificatesCard.vue`), con todos en un PDF y el
  link de cada uno.
- El envío por correo (`send_attendance_certificates`, con confirmación) se activa recién con el evento terminado:
  - Cada persona recibe un link firmado sin vencimiento (`/certificado/<token>`).
  - Queda registro en `aitickets_certificate_sends` (migración `202610300210`), y un segundo envío llega solo a quienes
    faltan.

**Dónde se promete**
`seminarios/SeminarAfter.astro` (ítem con `soon: true`).

**Qué hay hoy**
La lista de quienes ingresaron (`list_attendees`).

**Qué falta**
- Un PDF con nombre, evento, fecha y horas, enviado después del evento solo a quienes hicieron check-in.
- Depende del ítem 19, porque sin nombre por asistente el certificado sale a nombre de quien compró.
- Si se usa el ítem 16, permitir certificar solo a quien asistió a X sesiones.

## 21. Imprimir credenciales con nombre

**Hecho (rama `feat/pronto-resto`).** Panel, pestaña Puerta: módulo "Credenciales con nombre" (`CredentialsPrintCard.vue`,
`/api/events/credentials`, `src/lib/credentials.ts`).
- PDF A4 con 4 credenciales por hoja, en orden alfabético, una por entrada vigente.
- Cada una lleva nombre del titular, empresa (si la orden la tiene), tipo de entrada, función y el QR de la entrada.
- Se filtra por función.
- Pendiente: logo y tamaños configurables.

**Dónde se promete**
- `seminarios/SeminarAccreditation.astro` ("Imprimir credenciales con nombre")
- `seminarios/Credential.vue` (comentario)

**Qué falta**
- Un PDF imprimible con una credencial por asistente: nombre, empresa, tipo de entrada y QR.
- Depende del ítem 19.

## 22. Publicar en LinkedIn desde el panel

**Hecho (rama `feat/pronto-resto`).** Sin migración (`social_accounts.platform` no tiene restricción).
- Promocionar conecta LinkedIn (perfil o página de empresa, se elige en el flujo de Zernio) y TikTok.
- Los posts del panel y de la IA (`create_social_post`, `publish_social_post`) salen en Instagram, Facebook, TikTok y
  LinkedIn.
- Reglas por red en `src/lib/socialPlatforms.ts`: LinkedIn acepta solo texto o hasta 20 imágenes, con 3.000 caracteres
  como máximo.
- Landing de seminarios sin "Pronto".

**Dónde se promete**
`seminarios/SeminarDiffusion.astro` ("Publicar en LinkedIn desde tu panel").

**Qué falta**
- Conectar una página de empresa de LinkedIn y publicar el anuncio del evento, o una serie corta.
- La API de LinkedIn exige aprobación del producto.
- Comparte diseño con el ítem 1.

## 23. Lista de asistentes y ventas separadas por función

**Hecho (rama `feat/ventas-por-funcion`).** Sin migración. Helpers en `src/lib/eventAnalytics.ts`:
`lineFunctionKey` (la función de cada línea; en órdenes antiguas, la de su tipo de entrada), `orderForFunction` (la
parte de una orden que es de una función, con su parte del monto ya con descuento) y `salesByFunction`.
- Analítica del evento: tabla "Ventas por función" (con varias funciones) y selector de función en "Ventas por canal"
  (`?funcion=`). Las visitas y la conversión siguen siendo del evento completo.
- Lista de asistentes (`/dashboard/tickets`): cada entrada muestra su función y hay un filtro por función (las válidas
  para cualquier función aparecen en todas). El "Exportar CSV" descarga la función elegida.
- CSV de órdenes: columna "Función" con varias funciones, y `event_date_id` deja solo las órdenes de esa función (y las
  válidas para todas) con la columna "Entradas de la función". Los montos son los de la orden completa.
- Asistente de IA: `get_event_performance` trae `sales_by_function`; `list_attendees` ya filtraba por `function_id`.
- Landing de academias: "Por función" sin "Pronto".

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

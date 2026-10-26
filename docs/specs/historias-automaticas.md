# Spec: Historias y posts automáticos

| | |
| --- | --- |
| Estado | **Implementado** (fases 1 a 3, 2026-10-26). Operación: [`docs/runbooks/historias-automaticas.md`](../runbooks/historias-automaticas.md) |
| Fecha | 25-oct-2026 (@Seba) |
| Código | `src/lib/socialSeries.ts` (ciclo de vida, job, DM, cortes, webhooks), `socialSeriesCadence.ts`, `socialSeriesRender.ts`, `src/lib/producer-api/tools/socialSeries.ts`, `src/components/dashboard/SocialSeriesCard.vue` |
| Migración | `db/migrations/202610280200_social_series.sql` |

## 1. Contexto y objetivo

El productor aprueba una serie una sola vez y AI Tickets publica sola historias y posts en su Instagram hasta el día
del evento, con el link entregado por DM automático.

Caso que lo origina: "Concierto de Primavera" (Escuela de Música del Dire, 8-nov-2026). Lleva 67 de 350 entradas
(19%) con 33% de conversión, pero solo 84 visitantes únicos. El productor tiene Instagram conectado y 0 posts
publicados: publicó el evento y se olvidó. La venta vino casi toda de WhatsApp y decae después del primer aviso. El
problema no es convertir, es que la gente vuelva a ver el evento: una presencia diaria en historias, sin trabajo del
productor, ataca eso.

**Métrica de éxito:** en eventos con la serie activa, visitantes únicos y entradas vendidas en los días con historia
vs. eventos comparables sin serie. Secundaria: DMs enviados por la automatización y clics en el link trackeado.

## 2. Alcance

| Entra (v1) | No entra (v2 o después) |
| --- | --- |
| Historias programadas con cadencia que se acelera al acercarse el evento | Reels y video |
| Posts de feed la última semana (1 al día) | Facebook (la integración lo soporta) |
| Imagen vertical generada por la plataforma con la cuenta regresiva | Edición pieza por pieza (se regenera la serie completa) |
| DM por palabra clave en respuesta a historia (`story_reply`) y en comentarios de los posts (`comment`) | Anuncios pagados |
| Aprobación única con vista previa de todas las piezas | Sticker de link nativo (la Graph API no lo permite: el link va por DM) |
| Pausar, reanudar y cancelar; corte automático si se agota, se cancela o cambia de fecha | |

## 3. Experiencia del productor

Tarjeta **"Difusión automática"** en `/dashboard/events/[id]` (solo eventos publicados):

1. **Entrada.** Con Instagram conectado ofrece "Activar historias automáticas"; si no, el CTA es conectarlo (Promocionar).
2. **Configuración mínima.** Por defecto: cadencia automática, posts de feed la última semana, palabra clave ENTRADAS
   (variantes "entrada" y "link"), historia "agotado" desactivada. Todo editable, nada obligatorio.
3. **Vista previa.** Carrusel con todas las piezas: fecha, hora, imagen real (renderizada con los datos de ese momento)
   y, en los posts, un caption de ejemplo. Se puede cambiar la foto base y regenerar.
4. **Aprobación única.** "Aprobar y programar" → resumen de confirmación → desde ahí la plataforma publica sola.
5. **Seguimiento.** Publicadas, por publicar, DMs enviados, entradas vendidas por el link del DM, próxima pieza y el
   calendario con el estado de cada una (y el error si alguna falló).
6. **Control.** Pausar (no publica nada hasta reanudar), reanudar (recalcula desde hoy, pide confirmación) y cancelar
   (borra lo programado en Zernio y desactiva el DM).

También desde el MCP: `prepare_social_series` deja el borrador (soporte o un agente, también el admin con
`org_prepare_social_series`) y el productor solo aprueba (`approve_social_series`, con confirmación en el servidor).

## 4. Motor de cadencia (`socialSeriesCadence.ts`)

| Días para el evento (D) | Historias | Posts de feed |
| --- | --- | --- |
| D-8 o más | Cada 3 días (D-10, D-13, …) | No |
| D-7 a D-1 | 1 diaria | 1 diario |
| D-0 | 1, a las 09:00 y al menos 3 h antes del inicio | No |

- Cálculo **hacia atrás desde el evento**: la transición a diario siempre cae en D-7. D-8 y D-9 quedan libres.
- Hora: la hora pico de visitas del evento (o de la organización) con al menos 50 visitas, acotada entre 09:00 y 22:00;
  si no, 19:30.
- A menos de 24 h del evento: solo D-0. Si la hora de D-0 ya pasó y falta más de una hora para el inicio, sale cuanto antes.
- Varias funciones: la cuenta regresiva apunta a la próxima función; al pasar, se replanifica hacia la siguiente; la serie
  termina después de la última.
- **Bandas y horas son configuración global** (`aitickets_platform_settings 'social_series_cadence'`, admin:
  `update_social_series_config`). Cada serie guarda la copia con que se aprobó.

Concierto de Primavera (activado el 26-oct, evento el 8-nov a las 12:00): historias el 26-oct (D-13), 29-oct (D-10), del
1 al 7-nov (con post cada día) y el 8-nov a las 09:00. Total 10 historias y 7 posts (verificado en
`tests/unit/social-series.test.mjs`).

## 5. Generación de contenido (`socialSeriesRender.ts`)

- **Historia 1080×1920 JPG / post 1080×1350:** foto base con overlay oscuro, nombre, fecha y lugar, número grande con la
  cuenta regresiva y el llamado a responder la palabra clave. **Plantilla en el servidor** (Satori: texto → vectores, sin
  depender de las fuentes del sistema; sharp compone sobre la foto), no IA: los datos salen exactos. Zona segura de
  Instagram respetada (contenido entre y=260 y y=1660). Cada pieza cambia color y alineación respecto de la anterior.
- Mensaje por etapa: "Faltan 13 días" + fecha y lugar · "Faltan 5 días" + escasez si aplica · "Mañana" + "Última noche
  para comprar" · "Hoy" + hora de inicio y "Entradas en puerta o por DM" · "Agotado" (historia opcional).
- **Escasez real:** "Quedan N entradas" solo si queda menos del 30% (configurable) y solo la última semana. Nunca un número
  inventado: se calcula al renderizar.
- **Render tardío:** la imagen se genera unas 2 h antes de publicar con los datos vigentes. La vista previa usa los de ese momento.
- **Caption del post:** Claude desde la descripción del evento (cambia el ángulo respecto de los anteriores; sin hashtags ni
  links inventados) y siempre termina en "Comenta ENTRADAS y te mandamos el link 📩". Sin IA configurada, texto fijo.
- Foto base: la elegida para la serie, la portada o el fotograma del video de portada; sin ninguna, fondo liso (la tarjeta lo avisa).

## 6. Link por DM (comment-automations de Zernio)

- **Historias:** una automatización `story_reply` sin `platformPostId` (cualquier historia) **por cuenta de Instagram**,
  compartida por las series vivas de esa cuenta. Con una serie responde con su evento; con varias, con el más próximo y la
  página de la organización (si tiene sitio). `repeatPolicy: every_comment` con 12 h de enfriamiento, para que quien vuelva
  a responder otro día reciba el link de nuevo.
- **Posts:** una automatización `comment` **por post**, atada con `postId` al post de Zernio aún no publicado (se arma sola
  al publicarse) y con respuesta pública "¡Listo! Te mandamos el link por DM 📩". *Desviación de la spec original*: Zernio
  tiene un disparador por automatización, así que "una automatización con dos disparadores" son N automatizaciones.
- Mensaje por defecto: "¡Hola! Aquí están tus entradas para Concierto de Primavera, el domingo 8 de noviembre a las 12:00:
  https://aitickets.cl/eventos/concierto-de-primavera-2296?ref=ig-story-dm". Editable (`{link}` marca dónde va), más un
  botón "Comprar entradas" con el mismo link (Zernio cuenta los clics).
- **Tracking:** `ref=ig-story-dm` y `ref=ig-post-dm`: las ventas aparecen como canales propios en la analítica del evento.
- Palabra clave ENTRADAS por defecto, `contains` sin distinguir mayúsculas, con variantes "entrada" y "link".

## 7. Integración con Zernio

- **Publicar:** `POST /v1/posts` con `platformSpecificData.contentType: "story"` (historias) o con `content` (posts),
  `scheduledFor` = hora del slot, `timezone: America/Santiago`, `metadata.aitickets_slot_id` (vuelve en los webhooks) e
  `Idempotency-Key: aitickets-series-slot-<id>` (un reintento nunca duplica).
- **Cuándo se llama:** no al aprobar. El job (`runSeriesJobs`) corre cada 15 min (función programada
  `social-series-dispatch` → `POST /api/social-series/run` con `x-internal-secret`, porque el render necesita el servidor de
  Astro con las fuentes incrustadas), toma los slots de las próximas 2 h, renderiza y programa. Pausar o cancelar solo borra
  lo que ya está en cola en Zernio (como máximo 2 h hacia adelante).
- **Webhooks** (`/api/webhooks/zernio`, firma `X-Zernio-Signature` = HMAC-SHA256 hex del cuerpo, deduplicación por
  `X-Zernio-Event-Id`): `post.platform.published` → publicado con su link; `post.platform.failed` → fallido con el error (si
  es `auth_expired`, pausa la serie); `post.cancelled`; `account.disconnected` → pausa las series de esa cuenta.
- Un fallo que llegó a Zernio no se reintenta desde AI Tickets (Zernio ya reintenta); los que no llegaron (render, subida,
  red, 5xx, 429) se reintentan hasta 3 veces. Un slot fallido avisa a Slack y se muestra en la tarjeta.
- Límites: solo cuentas Business o Creator; sin stickers, música ni link en historias por API; el DM usa la Private Reply API
  de Meta.

## 8. Modelo de datos y jobs

`aitickets_social_series` (la unidad que se aprueba; una sola viva por evento: índice único parcial) y
`aitickets_social_series_slots` (cada publicación: `planned → rendering → queued → published | failed | skipped`). Detalle
de columnas en la migración. `aitickets_zernio_webhook_events` deduplica los webhooks.

| Job | Qué hace |
| --- | --- |
| plan (al aprobar y reanudar) | Calcula los slots desde ahora y sincroniza el DM de historias |
| dispatch (cada 15 min) | Libera claims huérfanos, reconcilia las series y despacha lo que publica en ≤ 2 h (presupuesto de 7 s por pasada; lo que no alcanza sale en la siguiente) |
| webhook | `queued → published / failed` |
| close | Tras la última función sin pendientes: `completed`, borra las automatizaciones |

## 9. Casos borde (regla: nunca publicar algo que ya no sea cierto)

| Situación | Qué hace la serie |
| --- | --- |
| Evento agotado | Detiene los slots siguientes; una historia "Entradas agotadas, gracias" si el productor la activó; el DM responde "agotado". Si vuelve a haber entradas, retoma |
| Evento cancelado o despublicado | Cancela todo: slots omitidos, posts en cola borrados, automatizaciones borradas |
| Cambio de fecha u hora | Recalcula los slots futuros (los publicados no se tocan) y avisa en la tarjeta |
| Cambio de foto, nombre o lugar | Lo toma el próximo render; no requiere reaprobar |
| Instagram desconectado o token vencido | Pausa, avisa por correo y en la tarjeta; al reconectar, reanuda desde hoy |
| Activación a menos de 24 h | Solo la historia de D-0 |
| Varias funciones | Cuenta hacia la próxima función; termina en la última |
| Dos eventos en la misma cuenta | Historias de ambos; el DM responde con el más próximo y la página de la organización |
| Fallo de publicación | Slot fallido visible en la tarjeta y aviso a Slack; el siguiente sigue normal |
| Serie pausada | El job no despacha; al reanudar, lo que no salió queda omitido y se recalcula desde hoy |
| Job caído más de 30 min | El slot vencido se omite ("no alcanzó a publicarse a tiempo"): no se publica tarde |

## 10. Métricas

- Ventas atribuidas: órdenes con `ref` ig-story-dm / ig-post-dm (canales propios en la analítica del evento).
- DMs enviados y clics: estadísticas de las automatizaciones en Zernio, en la tarjeta y en `get_social_series`.
- Admin: `get_platform_overview.social_series` (series activas, % de eventos próximos con serie, entradas, venta bruta y
  cargo neto atribuidos en el período), `get_event_analytics.social_series` y `list_social_series`.
- Uso de la tarjeta: la bitácora del panel registra activar, vista previa, aprobar, pausar y cancelar
  (`window.aitTrack`, `docs/specs/bitacora-panel.md`).
- Pendiente: "lift por día" (visitas y entradas en días con historia vs. sin) como herramienta; hoy se calcula con la serie
  diaria de `get_event_analytics` y los slots publicados.

## 11. Antes de usarlo con un productor

1. Configurar `ZERNIO_WEBHOOK_SECRET` y dar de alta el webhook (`node scripts/zernio-webhook.mjs`).
2. Probar en una cuenta propia (Business/Creator) con un evento de prueba publicado: activar, ver la primera historia,
   responder ENTRADAS desde otra cuenta y comprobar el DM y el `ref` en la analítica.
3. Activar para el Concierto de Primavera antes del 1-nov (D-7) para alcanzar la semana diaria.

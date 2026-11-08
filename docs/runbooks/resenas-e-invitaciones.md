# Reseñas, fotos de asistentes e invitación al próximo evento

Migración `db/migrations/202610220100_event_reviews.sql`. Reglas en `netlify/lib/reviews.mjs`.

## Flujo

1. **Correos "¿Cómo estuvo?"** — `netlify/functions/send-review-requests` (cada hora, a los :20; lógica en
   `netlify/lib/review-requests.mjs`, reglas de horario en `netlify/lib/reviews.mjs`). Hasta **3 correos por persona y
   evento**, solo a quienes aún no califican:
   - **A quién:** por cada entrada vigente de la función, el correo del titular (`attendees.email`), el de quien compró
     (`event_orders.buyer_email`) y el del asistente de ese QR (`event_attendees.holder_email`). Un envío por email.
     Las entradas "cualquier función" lo reciben después de la última función.
   - **1º correo:** 4 h después del término si la función termina de día, 8 h si termina de noche (21:00–08:00), corrido
     a la ventana **10:00–23:00** de Chile para que estén despiertos (`firstReviewRequestAt`). Ejemplos: termina 13:00 →
     17:00 · 18:00 → 22:00 · 20:00 o 23:00 → 10:00 del día siguiente · 02:00 → 10:00 · 05:00 → 13:00. Se manda hasta
     72 h después del término.
   - **2º correo** (fotos) 2 días después del 1º y **3º** (último) 3 días después del 2º (`nextReviewReminderAt`), hasta
     10 días después del 1º y solo si la persona sigue con una entrada vigente. No van a quien se dio de baja de la
     productora (`aitickets_org_email_optouts`).
   - **Fuera de 10:00–23:00 no sale nada**, ni lo atrasado: si la función programada estuvo caída, espera a la mañana.
   - **Registro:** cada envío es una fila de `notification_log` (`type = 'review_request'`, `email`, `attendee_id`); las
     filas de un email dicen en qué paso va. Las filas anteriores a la columna `email` (migración
     `202611080300_review_request_email.sql`) se asocian por `attendee_id`.
   - **Baja:** cada correo trae "No quiero más recordatorios de este evento" (página `/resenas/baja`, one-click
     `List-Unsubscribe` en `/api/resenas/baja`, token `ro` sin vencimiento). Queda como `notification_log.type =
     'review_request_optout'` con el email.
   - Cada estrella del correo es un link (`/eventos/<slug>#resena=<token>&nota=N`): el token va en el fragmento (`#`),
     así no llega a los logs, al CDN ni a Google Analytics, y la página lo borra de la URL al abrirla.
   - La nota del correo solo **preselecciona** las estrellas: hay que tocar "Enviar". Así un escáner de enlaces
     (Safe Links, antivirus) que abre los 5 links no registra calificaciones falsas.
2. **Página del evento terminado** (`src/components/event/EventReviews.vue`): resumen, comentarios públicos,
   galería "Fotos de los asistentes" y el formulario. Para calificar hay que validar la asistencia:
   - link del correo (token firmado),
   - compra hecha en ese navegador,
   - "Validar con mi correo" (`/api/reviews/request-link`: solo a emails con entradas vigentes, misma respuesta
     siempre para no revelar quién compró),
   - "Validar con mi entrada" (`/api/reviews/verify`: link `/order/<id>` o `/ticket/<id>`, su id o el código del QR).
3. **Reseña** (`POST /api/reviews`): 1-5 estrellas, comentario público (se muestra como "María P.") y mensaje
   privado (solo la productora). Una por persona y evento; calificar de nuevo la edita.
4. **Premio opcional** (`events.review_settings.reward`): la primera vez que alguien califica se crea un código
   `GRACIAS-XXXXXX` en `aitickets_discount_codes` (`source = 'review_reward'`, 1 uso, % configurable, vence en N
   días, válido en cualquier evento de la organización) y se le manda por correo. Se entrega **sin importar la
   nota** (premiar solo las buenas sería manipular reseñas). Los premios no aparecen en la lista de códigos del
   panel/API ni cuentan para el máximo de 500.
5. **Fotos** (`/api/reviews/photos`): hasta 6 por persona, optimizadas en `event-attendee-photos/<evento>/`.
   Visibles al tiro o "pendientes" si la productora activó la revisión previa.
6. **Panel** (`EventReviewsManager.vue`, en la ficha del evento): promedio y distribución, configuración,
   comentarios con filtro y CSV, mensajes privados, moderación de fotos e invitación al próximo evento.
   Ocultar un comentario lo saca de la página pero **su nota sigue contando en el promedio**.
7. **Invitación al próximo evento** (`/api/events/invitations`, herramienta MCP `invite_past_attendees`): se encola en
   `aitickets_scheduled_messages` (`kind = 'invitation'`, `target_event_id`) y la envía
   `send-scheduled-messages-background`. Omite a quienes ya tienen entradas del evento destino, a quienes ya fueron
   invitados a él (`notification_log.type = 'next_event_invite'`, `event_id` = destino) y a quienes se dieron de baja
   (`aitickets_org_email_optouts`). Cada correo trae enlace de baja (página `/invitaciones/baja` y one-click
   `List-Unsubscribe`) y UTM `utm_campaign=invitacion-<evento>` para medir ventas. Máximo 5 envíos por organización
   cada 24 h.

## Variables

- `REVIEW_TOKEN_SECRET` (opcional, recomendado): firma de los links para calificar y de los enlaces de baja. Sin
  ella se deriva de `EMAIL_VERIFY_SECRET` / `INTERNAL_API_SECRET`. **Cambiarla invalida los links ya enviados**,
  incluidos los de baja. Sin ningún secreto no se envían correos de reseña ni invitaciones.

## Operación

- ¿Por qué alguien no recibió el correo de reseña? Revisar que el evento esté publicado y no cancelado, que
  `review_settings.enabled` no sea `false`, que su entrada siga vigente, cuántos `review_request` tiene en
  `notification_log` para ese evento (máximo 3) y si tiene un `review_request_optout`. Recordar que nada sale entre las
  23:00 y las 10:00, y que el primer correo de una función que termina de noche sale a las 10:00 o más tarde.
- ¿Cuántos correos lleva cada persona?
  `SELECT email, count(*), min(created_at), max(created_at) FROM notification_log WHERE event_id = <id> AND type = 'review_request' GROUP BY email;`
- Contenido ofensivo: la productora lo oculta desde el panel. Para borrarlo a mano:
  `DELETE FROM aitickets_event_review_photos WHERE id = '<uuid>';` o
  `UPDATE aitickets_event_reviews SET public_status = 'hidden' WHERE id = '<uuid>';`.
- Una invitación quedó `sending` más de 30 min: la función `send-scheduled-messages` la marca `failed` y avisa por
  Slack (no se reintenta sola para no duplicar). Revisar `notification_log` antes de reenviar: las personas ya
  invitadas se omiten solas en un nuevo envío.

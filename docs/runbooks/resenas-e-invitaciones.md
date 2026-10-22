# Reseñas, fotos de asistentes e invitación al próximo evento

Migración `db/migrations/202610220100_event_reviews.sql`. Reglas en `netlify/lib/reviews.mjs`.

## Flujo

1. **Correo "¿Cómo estuvo?"** — `netlify/functions/send-review-requests` (cada hora, a los :20). Por cada
   función que terminó hace entre 24 y 72 h escribe a quienes tenían entradas vigentes de esa función; las
   entradas "cualquier función" reciben el correo después de la última función. Un correo por persona y evento
   (`notification_log.type = 'review_request'`), nunca a quien ya calificó. Cada estrella del correo es un link
   (`/eventos/<slug>#resena=<token>&nota=N`): el token va en el fragmento (`#`), así no llega a los logs, al CDN
   ni a Google Analytics, y la página lo borra de la URL al abrirla.
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
  `review_settings.enabled` no sea `false`, que su entrada siga vigente y si ya tiene un `review_request` en
  `notification_log` para ese evento.
- Contenido ofensivo: la productora lo oculta desde el panel. Para borrarlo a mano:
  `DELETE FROM aitickets_event_review_photos WHERE id = '<uuid>';` o
  `UPDATE aitickets_event_reviews SET public_status = 'hidden' WHERE id = '<uuid>';`.
- Una invitación quedó `sending` más de 30 min: la función `send-scheduled-messages` la marca `failed` y avisa por
  Slack (no se reintenta sola para no duplicar). Revisar `notification_log` antes de reenviar: las personas ya
  invitadas se omiten solas en un nuevo envío.

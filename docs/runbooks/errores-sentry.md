# Bandeja de errores de producción (Sentry → MCP Admin)

Cada error que cae a Sentry queda en `aitickets_error_issues` (uno por issue de Sentry, sin duplicados), avisa a Slack
cuando es nuevo o vuelve después de resuelto, y se revisa y arregla desde el MCP Admin:

1. `list_error_issues`: qué hay pendiente (`new`, `in_progress`).
2. `get_error_issue`: stack trace, request, tags y breadcrumbs del último evento (en vivo desde Sentry).
3. `update_error_issue`: `in_progress` al tomarlo, `fixed` con el `pr_url` del PR, o `ignored` con nota.
4. Con el fix en producción, resolver el issue en Sentry. Si vuelve a ocurrir, la bandeja lo marca como regresión,
   lo devuelve a `new` y avisa a Slack.

**El repo es público:** no se crean issues en GitHub. En commits y PRs se describe el arreglo sin copiar mensajes,
URLs ni datos del error. Títulos, mensajes y breadcrumbs ya se guardan sin correos, RUT, teléfonos, tokens ni query strings.

## Piezas

| Pieza | Qué hace |
| --- | --- |
| `POST /api/webhooks/sentry` | Webhook de la Internal Integration (`issue` y `event_alert`), firmado con `SENTRY_CLIENT_SECRET` |
| `netlify/functions/sentry-sync` | Cada 30 min trae los issues vistos en 24 h. Respaldo del webhook; latido en `get_system_health` |
| `netlify/lib/sentry-issues.mjs` | Lógica compartida: firma, normalización, deduplicación, regresiones, avisos, API de Sentry |
| `db/migrations/202611120300_error_issues.sql` | Tabla `aitickets_error_issues` (`sentry_issue_id` UNIQUE) |

Solo el proyecto `aitickets`: la organización `seba` tiene otros proyectos (`aitickets-lambda`, `chlog-*`…) y el webhook de
una Internal Integration manda los issues de toda la organización. El webhook y el cron descartan los issues de otro
proyecto (y los que no dicen de qué proyecto son).

Sin duplicados: Sentry agrupa los eventos del mismo error en un issue con id estable. Un INSERT que choca con
`sentry_issue_id` pasa a UPDATE (conteos y fechas solo avanzan), y cada aviso a Slack se reclama con un UPDATE
condicional (`notified_at IS NULL`, `sentry_status = 'resolved'`), así que webhook y cron a la vez avisan una sola vez.
Solo se avisan errores `error`/`fatal` cuyo primer evento tiene menos de 24 h (la primera sincronización no inunda Slack).

## Configuración

1. **Sentry** → Settings → Developer Settings → Custom Integrations → *Create New Integration* → **Internal Integration**.
   - Webhook URL: `https://aitickets.cl/api/webhooks/sentry`
   - Permissions: **Issue & Event: Read** (lo demás en No Access).
   - Webhooks: marcar **issue**.
   - Guardar. Copiar el **Client Secret** y crear un **token** (Tokens → New Token).
2. **Netlify** → Site settings → Environment variables (scope Functions, contexto Production):
   - `SENTRY_CLIENT_SECRET`: el Client Secret (sin esto el webhook responde 404).
   - `SENTRY_API_TOKEN`: el token de la integración (o un token de usuario con lectura de issues y eventos).
   - Opcionales, con el valor correcto por defecto: `SENTRY_ORG` (`seba`), `SENTRY_PROJECT_ID` (`4510110385897472`,
     el proyecto `aitickets` del DSN) y `SENTRY_API_BASE` (`https://sentry.io/api/0`).
3. Redeploy. Revisar en el MCP Admin: `get_system_health` (job `sentry-sync` sin `skipped`) y `list_error_issues`.

Si el plan de Sentry no entrega webhooks de `issue`, igual funciona: el cron sincroniza cada 30 min. También se puede
agregar a una regla de alerta la acción "Send a notification via <integración>" (llega como `event_alert`).

## Problemas

- `get_error_issue` sin `latest_event`: revisa `warnings` (falta token/org, o Sentry respondió error).
- Frames del cliente minificados: el build no subió source maps a Sentry (`@sentry/astro` necesita `SENTRY_AUTH_TOKEN` en el build).
- El webhook responde 401: el Client Secret en Netlify no es el de la integración.

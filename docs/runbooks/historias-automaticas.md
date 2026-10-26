# Historias automáticas en Instagram (difusión automática)

El productor aprueba una vez y AI Tickets publica historias (y posts de feed la última semana) en su Instagram hasta el
día del evento, con el link por DM a quien responda o comente la palabra clave. Diseño:
[`docs/specs/historias-automaticas.md`](../specs/historias-automaticas.md).

| Pieza | Dónde |
| --- | --- |
| Ciclo de vida, job, DM, cortes, webhooks | `src/lib/socialSeries.ts` |
| Cadencia (pura) / imágenes (Satori + sharp) | `src/lib/socialSeriesCadence.ts` / `src/lib/socialSeriesRender.ts` |
| Herramientas de productor (MCP, REST, panel, admin `org_*`) | `src/lib/producer-api/tools/socialSeries.ts` |
| Tarjeta del panel y sus rutas | `SocialSeriesCard.vue`, `/api/events/social-series`, `/api/events/social-series-preview` |
| Job cada 15 min | `netlify/functions/social-series-dispatch` → `POST /api/social-series/run` (`x-internal-secret`) |
| Webhooks de Zernio | `POST /api/webhooks/zernio` |
| Admin | `list_social_series`, `update_social_series_config`; `social_series` en `get_platform_overview` y `get_event_analytics` |

## 1. Activarlo (una vez)

1. Netlify → Environment variables (Functions, Production):
   - `ZERNIO_API_KEY` (ya existe para posts y anuncios).
   - `ZERNIO_WEBHOOK_SECRET` = `openssl rand -hex 32`.
   - Opcional: `SOCIAL_SERIES_ENABLED=false` para apagarlo; `SOCIAL_SERIES_BUDGET_MS` (por defecto 7000).
   - `INTERNAL_API_SECRET` y `SITE_URL` (ya existen): la función programada llama al job con ellos.
2. Deploy de producción: aplica `202610280200_social_series.sql` (tablas y configuración de cadencia por defecto).
3. Alta del webhook en Zernio (idempotente: si existe, lo actualiza):

   ```bash
   ZERNIO_API_KEY=... ZERNIO_WEBHOOK_SECRET=... SITE_URL=https://aitickets.cl node scripts/zernio-webhook.mjs
   ```

   Sin webhook las piezas igual se publican, pero quedan "En cola para publicar" en la tarjeta y no se detecta a tiempo
   una cuenta desconectada.
4. Prueba con una cuenta propia (Business o Creator) y un evento publicado antes de usarlo con un productor.

## 2. Cómo se ve en operación

- `get_system_health` / logs de Netlify: la función `social-series-dispatch` escribe `📸 Difusión automática: {...}`
  cuando despacha, falla o corta algo.
- Slack: `⚠️ Historia automática fallida (serie, evento, slot, hora): motivo` por cada pieza que Zernio rechazó o que falló
  3 veces.
- MCP admin: `list_social_series` muestra todas las series con piezas publicadas, pendientes, fallidas, el último error,
  avisos y ventas por DM. El detalle de una: `org_get_social_series { event_id }`.

## 3. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| La tarjeta dice "Conecta la cuenta de Instagram" con la cuenta conectada | `social_accounts` sin fila `instagram` activa (o `status` expired/revoked) | Reconectar en Promocionar |
| Serie pausada "Instagram se desconectó" | Token vencido (webhook `account.disconnected`, `auth_expired` o 403 `ACCOUNT_DISCONNECTED` al publicar) | El productor reconecta; el job la reanuda sola desde hoy en la próxima pasada (≤ 15 min) |
| Pieza "Falló" con error de Instagram | Contenido o cuenta rechazados (no Business/Creator, imagen) | Ver `error` en `org_get_social_series`; la siguiente sale normal |
| Piezas quedan "En cola para publicar" pasada su hora | Falta el webhook o su secreto no coincide | Paso 1.3; revisar `aitickets_zernio_webhook_events` y los logs de `/api/webhooks/zernio` (401 = firma) |
| Nadie recibe el DM | La automatización story_reply no se creó (aviso en la tarjeta) o la cuenta no permite mensajes | El job la reintenta; revisar `zernio_story_automation_id` de la serie y los logs de la automatización en Zernio |
| Piezas "Omitida: no alcanzó a publicarse a tiempo" | La función programada no corrió (deploy caído, `INTERNAL_API_SECRET`) | Revisar la función; no se publican tarde a propósito |

## 4. Ajustar la cadencia

`update_social_series_config` (MCP admin, escritura con `reason`) cambia las bandas y horas globales
(`aitickets_platform_settings 'social_series_cadence'`): días de la banda diaria, cada cuántos días antes, posts de feed,
hora por defecto, hora del día del evento, horas mínimas antes del inicio, visitas para usar la hora pico, anticipación del
render y umbral de escasez. Aplica a las series que se aprueben o reanuden después; las activas siguen con su copia.

## 5. Apagar de emergencia

- Una serie: `org_cancel_social_series { event_id }` (borra lo programado y el DM) o `org_pause_social_series`.
- Todo: `SOCIAL_SERIES_ENABLED=false` y redeploy. El job deja de despachar y no se puede activar nada nuevo. Lo que ya está
  en cola en Zernio (hasta 2 h) sale igual: si hace falta frenarlo, cancelar las series.

## 6. Datos

- `aitickets_social_series` / `aitickets_social_series_slots`: se conservan como historial de lo publicado (las imágenes
  quedan en el bucket `Events`, carpeta `social-series/`).
- `aitickets_zernio_webhook_events`: solo deduplicación; se puede purgar lo de más de 30 días.

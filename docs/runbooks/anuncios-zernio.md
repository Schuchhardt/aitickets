# Anuncios en Facebook e Instagram (Meta) vía Zernio

Las productoras crean anuncios pagados de sus eventos desde **Promocionar → Anuncios** (`/dashboard/promote?tab=ads`),
miden cuántas entradas vende cada uno y lo ven también en su reporte de los domingos. Todo pasa por Zernio, que es
Meta Marketing Partner: AI Tickets no necesita app propia de Meta ni App Review de `ads_management`.
Migración `db/migrations/202610250200_zernio_ads.sql`. Referencia de la API: https://docs.zernio.com/platforms/meta-ads
(contrato completo en https://zernio.com/openapi.json).

| Pieza | Archivo |
| --- | --- |
| Cliente y reglas (validación del gasto, cuerpo de los requests, estados, ventas atribuidas, recuperación) | `netlify/lib/zernio-ads.mjs` |
| Panel: conexiones, lista con ventas, sincronización | `src/lib/ads.ts` |
| Rutas | `src/pages/api/promote/ads/{connect,callback,create,status,stats,targeting,disconnect}.ts` |
| Asistente y lista | `src/components/dashboard/promote/CreateAdCampaign.vue`, `AdCampaignList.vue` |
| Texto del anuncio con IA | `generateAdCopy` en `src/lib/aiText.ts` (`/api/promote/generate` con `type: "ad"`) |
| Reporte semanal | `loadWeekAds` en `netlify/lib/weekly-report-send.mjs` |

## Quién paga qué

- **Meta le cobra el gasto directo a la cuenta publicitaria de la productora** (su tarjeta en Meta). AI Tickets nunca
  toca ese dinero.
- **Zernio**: los anuncios vienen en el plan usage-based. Sin medio de pago la cuenta de Zernio tiene 500 anuncios vivos
  gratis; pasado eso responde `403 ads_allowance_exceeded` (el panel muestra "Los anuncios no están disponibles").
  Un plan antiguo sin Ads responde 403 en todo.

## Flujo

1. **Conectar** (`POST /api/promote/ads/connect`, solo `admin`/`producer`): usa el perfil de Zernio de la organización
   (el mismo de publicar posts). Si su Facebook ya tiene permisos de anuncios, Zernio la conecta sin pasar por Meta;
   si no, devuelve el diálogo de Meta y la vuelta llega a `/api/promote/ads/callback`, que valida el state firmado
   (`purpose: zernio-ads`, 30 min), que el perfil sea el de la organización y que la conexión pertenezca a ese perfil
   (falla cerrado). Las cuentas publicitarias (`act_...`) se guardan en `ad_account_connections` (`provider = 'zernio'`)
   con su moneda y mínimo diario; las que Meta no deja usar quedan `unusable` con el motivo.
2. **Crear** (`POST /api/promote/ads/create`, solo `admin`/`producer`): un anuncio nuevo (título, texto, imagen, botón
   "Comprar entradas") o **promocionar un post** ya publicado desde AI Tickets. Objetivo tráfico a la página del evento.
3. **Medir**: el link lleva `utm_source=meta&utm_medium=paid&utm_campaign=ad-<id>`. Las ventas con ese `utm_campaign`
   se atribuyen al anuncio (sin cortesías ni transferencias). La lista muestra gasto, alcance, clics, entradas, ventas,
   costo por entrada y retorno (solo si la cuenta está en CLP).
4. **Pausar / activar / cancelar** (`POST /api/promote/ads/status`): pausar y cancelar los puede hacer quien administra
   eventos (detienen el gasto); reactivar vuelve a gastar y queda para `admin`/`producer`. Solo cambia el interruptor
   del anuncio, no su campaña.

## Reglas del gasto (validateAdInput, en el servidor)

- Presupuesto **diario**, en unidades enteras de la moneda de la cuenta (CLP `5000` = $5.000; Zernio convierte a lo que
  pide Meta). Entre el mínimo de la cuenta (Meta) y un tope de cordura (`DAILY_BUDGET_SANITY_CAP`: $1.000.000 CLP,
  1.000 USD/EUR al día).
- De 1 a 30 días, empieza al crear y **nunca termina después del evento**.
- **Gasto máximo = diario × días**, y la productora lo confirma con una casilla; el servidor exige el mismo total.
- Público: todo Chile o una ciudad (id de Meta, buscador `/api/promote/ads/targeting`) con radio de 17, 25, 40 u
  80 km (Meta no entrega con menos de ~17 km); edad 18 a 65 por defecto.
- Imagen generada con IA en AI Tickets (`promote/<org>-ai-…`): se declara a Meta (`aiDisclosure: OPT_IN`).

## Sin duplicados ni anuncios "fantasma"

- La fila de `ad_campaigns` se guarda **antes** de llamar a Zernio con el cuerpo exacto (`zernio_request`) y la llamada
  lleva `Idempotency-Key: aitickets-ad-<id>`.
- Timeout, red, 409, 429 o 5xx: la fila queda `creating`. Al abrir la pestaña de anuncios (`/stats`) se reenvía el mismo
  cuerpo con la misma clave: Zernio devuelve el anuncio ya creado en vez de crear otro. Pasadas 24 h queda `error`
  ("revisa tu Administrador de anuncios").
- Rechazo (datos inválidos, política de Meta): `error` con el motivo en español (o el mensaje de Meta).
- Doble clic: el mismo anuncio (evento, tipo, diario, días) creado hace menos de 2 min se devuelve con 409.

Revisar anuncios de una organización:

```sql
SELECT id, event_id, ad_type, status, review_status, daily_budget, duration_days, spend, clicks,
       zernio_ad_id, error_message, created_at
FROM public.ad_campaigns
WHERE organization_id = 123 AND provider = 'zernio'
ORDER BY created_at DESC;
```

## Configuración

- `ZERNIO_API_KEY` con scope **Builds y Functions** (las rutas y el reporte semanal la leen en runtime).
- `ADS_ENABLED=false` apaga los anuncios (la pestaña muestra "Próximamente" y las rutas responden 503). Los anuncios ya
  creados siguen corriendo en Meta: se pausan desde el Administrador de anuncios de la productora o volviendo a
  encender la opción.
- La integración antigua directa con Meta (`META_APP_ID`, `META_APP_SECRET`, `META_ADS_ENABLED`, filas
  `provider = 'meta_direct'`) ya no se usa.

# Runbook: blog SEO automatizado

Diseño y reglas: [`docs/specs/blog-seo.md`](../specs/blog-seo.md). Todo se maneja desde el MCP de administración
(herramientas `*_blog_*`) o con variables de entorno en Netlify (Functions).

## 1. Puesta en marcha

1. **Migración.** `202611090200_blog.sql` se aplica sola en el deploy de producción (crea las tablas y 14 temas).
2. **Claude.** Ya está `ANTHROPIC_API_KEY`. Nada más que hacer.
3. **Search Console + Google Ads (un solo OAuth).**
   1. En Google Cloud (cualquier proyecto): habilita **Google Search Console API** y **Google Ads API**.
   2. Pantalla de consentimiento OAuth: tipo Externo, agrega tu correo como usuario y pásala a **En producción**
      (en "Prueba" el refresh token vence a los 7 días). Como la usa solo el dueño, no hace falta verificar la app:
      Google mostrará "app no verificada" una vez; continúa.
   3. Credenciales → Crear ID de cliente OAuth → **App de escritorio**. Guarda el client ID y el secret.
   4. En tu computador: `GOOGLE_OAUTH_CLIENT_ID=… GOOGLE_OAUTH_CLIENT_SECRET=… node scripts/google-oauth.mjs`, abre la
      URL con la cuenta **dueña de la propiedad de Search Console** y con acceso a Google Ads, y acepta.
   5. En Netlify (Functions): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` y
      `GSC_SITE_URL` (`sc-domain:aitickets.cl` si la propiedad es de dominio; `https://aitickets.cl/` si es de prefijo).
4. **Keyword Planner (opcional, recomendado).** En la cuenta de administrador de Google Ads → Herramientas →
   Centro de API: pide el developer token y solicita acceso **Basic** (el de prueba solo sirve con cuentas de
   prueba; la aprobación tarda unos días). Luego `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID` (la cuenta
   donde se consulta, sin guiones) y, si entras a través de la de administrador, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
   Google saca una versión de la API al mes y cada una dura ~1 año: cuando llegue el aviso de *sunset*, sube
   `GOOGLE_ADS_API_VERSION` (por defecto `v25`).
5. **IndexNow (opcional).** `INDEXNOW_KEY` = cualquier cadena de 8-128 letras/números/guiones (p. ej. `openssl rand -hex 16`).
   Se publica sola en `/indexnow.txt` y Bing se entera de cada artículo nuevo al instante.
6. **Revisar.** En Claude: "¿cómo está el blog?" → `get_blog_overview` dice qué está configurado y qué falta.
7. **Primeras corridas a mano** (sin esperar al cron):
   - `run_blog_task` `keywords` → en ~3 min `list_blog_keywords` muestra las candidatas con score.
   - Revisa y ajusta: descarta lo que no sirva (`upsert_blog_keywords` `rejected`), prioriza lo que quieras primero
     (`queued`), agrega las tuyas.
   - `run_blog_task` `generate` con `publish: false` → revisa el borrador con el `preview_url` de `get_blog_post`.
     Si te gusta, `update_blog_post` `status: published`.
8. **Activar el piloto automático.** `BLOG_ENABLED=true` (y, si quieres revisar cada artículo antes,
   `BLOG_AUTOPUBLISH=false`). Cadencia: `BLOG_POSTS_PER_WEEK` (por defecto 3).

## 2. Operación diaria

- **Slack** avisa cada artículo publicado o borrador, cada refresco y cada corrida de keywords (con advertencias).
- **Ajustar el mix de temas:** `upsert_blog_topic` cambia `weight` (cuota relativa), semillas o la landing del cierre;
  `weight: 0` o `active: false` deja de escribir sobre ese tema. Nuevo nicho: `upsert_blog_topic` con `slug`, `kind`,
  `name`, `description`, `landing_path` y 5 semillas informativas ("cómo…", "cuánto…", "qué es…").
- **Qué está funcionando:** `list_blog_posts` con `sort: clicks` y `get_blog_post` (consultas de Search Console que
  traen cada artículo). Las keywords que ya aparecen entre la 4 y la 30 sin artículo propio:
  `list_blog_keywords` con `striking_distance: true` → priorízalas (`queued`).
- **Refrescar uno puntual:** `run_blog_task` `refresh` con `post_id`.
- **Corregir un artículo:** `update_blog_post` (título, meta, extracto o el Markdown completo). `draft` lo despublica.

## 3. Problemas comunes

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| `OAuth de Google: invalid_grant` | Refresh token vencido o revocado (app en "Prueba", cambio de contraseña) | Pasa la app a "En producción" y vuelve a correr `scripts/google-oauth.mjs` |
| `planner …: Developer token is not approved` | Token con acceso de prueba | Pide acceso Basic; mientras, el blog usa Search Console y autocompletado |
| `User does not have sufficient permission for site` | `GSC_SITE_URL` no coincide con la propiedad o la cuenta no es dueña/usuario completo | Revisa el formato (`sc-domain:` vs `https://…/`) y los permisos en Search Console |
| Artículos quedan en borrador con errores | No pasaron las validaciones (`quality` en `get_blog_post`) | Corrige con `update_blog_post` y publícalo, o descártalo con `archived` |
| `generate` → `skipped: No hay keywords candidatas` | Sin keywords nuevas con score ≥ 25 | Corre `keywords`, agrega semillas al tema o prioriza a mano |
| La función diaria no hace nada | `BLOG_ENABLED` no es `true` | `get_system_health` muestra `blog-tick` con `last_note: skipped` |

## 4. Apagar

`BLOG_ENABLED=false` detiene el piloto automático (lo publicado sigue online). Para despublicar un artículo:
`update_blog_post` con `status: draft` o `archived`.

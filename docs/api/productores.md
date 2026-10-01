# API de productores (MCP + REST)

Permite a los productores gestionar AI Tickets desde su LLM (Claude, ChatGPT, Cursor, VS Code, cualquier
cliente MCP) o desde automatizaciones (n8n, Make, Zapier).

| Superficie | URL | Formato |
| --- | --- | --- |
| Servidor MCP | `POST /api/mcp` | JSON-RPC 2.0 sobre Streamable HTTP, sin estado, respuestas JSON (sin SSE) |
| REST | `POST /api/v1/<herramienta>` | Cuerpo JSON → `{ ok: true, data }` o `{ ok: false, error: { code, message } }` |
| Catálogo | `GET /api/v1` | Público: herramientas, JSON Schema de cada una, scopes |

Ambas superficies ejecutan **las mismas herramientas** (`src/lib/producer-api/tools/`), con la misma
validación (`validateArgs` sobre el JSON Schema publicado), permisos y bitácora (`runTool`).

## Autenticación

Dos formas, ambas terminan en el mismo actor (usuario + organización + scopes):

### OAuth 2.1 (claude.ai, ChatGPT, Claude Code)

El productor pega `https://aitickets.cl/api/mcp` como conector; el cliente descubre todo solo:

1. `POST /api/mcp` sin token → `401` con `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/api/mcp"`.
2. `GET /.well-known/oauth-protected-resource/api/mcp` (RFC 9728) → servidor de autorización.
3. `GET /.well-known/oauth-authorization-server` (RFC 8414) → endpoints.
4. Registro: `POST /api/oauth/register` (RFC 7591, público, 30/h por IP) o Client ID Metadata Document
   (client_id = URL https; se lee con `src/lib/safe-fetch.ts`, anti-SSRF).
5. `/oauth/authorize` → login (`?next=`) → pantalla de consentimiento (el productor elige scopes) →
   `POST /api/oauth/authorize` (sesión + CSRF por origen) → redirect con `code`, `state`, `iss`.
6. `POST /api/oauth/token`: `authorization_code` con PKCE S256 obligatorio (código de un solo uso, 10 min)
   y `refresh_token` rotativo (90 días; se valida antes de rotar y se rota con compare-and-swap).
7. `POST /api/oauth/revoke` (RFC 7009).

Access token = fila de `aitickets_api_keys` con `oauth_grant_id` y vencimiento de 1 h, así `/api/mcp` y
`/api/v1` lo autentican igual que una llave. Cada autorización es un `aitickets_oauth_grants` ("app
conectada" en el panel); desconectarla revoca el grant y sus access tokens vivos. Si el usuario se
desactiva o pierde el rol, el siguiente refresh revoca la conexión.

redirect_uri: https, `http://localhost|127.0.0.1|[::1]` (cualquier puerto, RFC 8252) o esquema de app
nativa (`cursor://…`); nunca `javascript:`/`data:`/`file:`. La pantalla de consentimiento no se puede
embeber (`frame-ancestors 'none'`).

### Llaves personales

- Llaves personales `aitk_…` creadas en **/dashboard/ia** ("Conecta tu IA"). Header
  `Authorization: Bearer aitk_…` (o `X-API-Key`).
- En la BD (`aitickets_api_keys`) solo queda el sha256 y un prefijo. La llave en claro se muestra una vez.
- La llave actúa como el usuario que la creó. En **cada** petición se revisa: no revocada, no vencida,
  usuario activo, misma organización y rol `admin`/`producer`/`editor`.
- Scopes: `read` (siempre), `write`, `publish` (publicar eventos y posts), `attendees` (datos de compradores).
- Un admin/productor ve y revoca las llaves de toda la organización; un editor solo las suyas.
- Límite: 120 peticiones/min por llave (`aitickets_rate_limit_hit`); `generate_image`: 20/día por organización.
- Estas rutas no usan cookies: el middleware las exime de la verificación CSRF y responden con CORS `*`.

## Herramientas

| Dominio | Herramientas |
| --- | --- |
| Cuenta / eventos | `get_account`, `list_events`, `get_event`, `list_venues`, `create_event` (borrador), `update_event`, `set_event_status` (publish) |
| Entradas / órdenes | `create_ticket_type`, `update_ticket_type`, `delete_ticket_type`, `list_orders` (attendees) |
| Descuentos | `list_discount_codes`, `create_discount_code`, `update_discount_code` |
| Analítica | `get_event_performance`, `get_sales_overview` |
| Marketing | `get_marketing_kit`, `create_tracking_link`, `upload_image`, `generate_image`, `create_social_post`, `list_social_posts`, `publish_social_post` (publish) |

El servidor MCP además entrega `instructions` (reglas de uso para el modelo) y 3 prompts:
`lanzar_evento`, `reporte_de_ventas`, `campana_redes`.

Decisiones:
- `create_event` siempre crea en borrador; publicar es otra herramienta con scope `publish` y
  `destructiveHint`, para que el cliente MCP pida confirmación.
- Fechas/lugares de un evento existente se editan desde el panel (allí se notifica a los asistentes).
- El copy lo escribe el LLM del productor (`get_marketing_kit` le da el contexto); el servidor solo aloja
  imágenes, genera imágenes (OpenAI, opcional) y publica vía Zernio.
- `upload_image` por URL: solo https, DNS resuelto a IPs públicas, redirecciones re-verificadas, 5 MB,
  tipo detectado por bytes (sin SVG).
- `aitickets_api_audit` registra cada escritura (herramienta, resultado, evento) sin argumentos.

## Agregar una herramienta

1. Definir un `ToolDef` en el archivo del dominio (`src/lib/producer-api/tools/*.ts`): `scope`,
   `inputSchema` (JSON Schema; `nullable: true` se publica como `["tipo","null"]`), `annotations` y
   `handler(args, ctx)`. **Toda consulta filtra por `ctx.actor.orgId`** o por un evento cargado con
   `loadOwnedEvent`.
2. Errores esperables: `throw new ToolError(code, mensaje)` (el mensaje lo lee el LLM: que sea accionable).
3. Agregarla al arreglo exportado del archivo y un test en `tests/unit/producer-api.test.mjs`.

## Pendiente (siguiente fase)

- Herramientas de cortesías, reenvío de entradas y edición de funciones vía API.

# MCP de administración (`aitickets-admin`)

Servidor MCP privado para el dueño de la plataforma: ve todas las organizaciones, sus eventos, compradores y la
plata, opera lo que antes era SQL a mano y puede actuar como cualquier productor (`org_*`). Diseño completo:
[`docs/specs/mcp-admin.md`](../specs/mcp-admin.md). Código: `src/lib/admin-api/`, ruta `src/pages/api/admin/mcp.ts`.

| | |
| --- | --- |
| URL | `POST https://aitickets.cl/api/admin/mcp` (JSON-RPC 2.0, Streamable HTTP sin estado, respuestas JSON) |
| Autenticación | `Authorization: Bearer aitkadm_…` (llave estática; en el servidor solo su sha256) |
| Deshabilitado / otro host | `404` (no existe). Solo responde en el host de `SITE_URL` |

## 1. Activarlo

1. Genera la llave: `node scripts/admin-key.mjs`. Muestra la llave **una vez** y su hash. Guarda la llave en tu
   gestor de contraseñas.
2. En Netlify, en Site settings > Environment variables, agrega lo siguiente con scope **Functions** y
   contexto **Production** únicamente. Los deploy previews comparten la base de producción y ejecutan código
   no confiable.
   - `AITICKETS_ADMIN_KEY_SHA256` = el hash (no la llave).
   - `ADMIN_MCP_ENABLED` = `true`.
   - Opcional: `AITICKETS_ADMIN_READONLY_KEY_SHA256` (de `node scripts/admin-key.mjs --readonly`). Esa llave
     solo ve herramientas de lectura que no exponen datos personales ni bancarios.
3. Redeploya producción. La migración `202610270400_admin_api.sql` se aplica en ese deploy: crea la bitácora,
   el usuario de servicio "Soporte AI Tickets" y amplía los CHECK de canal a `admin`.

## 2. Conectarlo a Claude

**claude.ai, Desktop y móvil.** Configuración → Conectores → Agregar conector propio:

- URL: `https://aitickets.cl/api/admin/mcp`
- Autenticación: **No sign-in**
- Request headers: `Authorization` = `Bearer aitkadm_…`. Escribe la palabra `Bearer` y un espacio: el valor se
  envía tal cual.

La autenticación de un conector no se puede editar: para rotar la llave, borra el conector y vuelve a
crearlo. El conector también queda disponible en las sesiones de Claude Code en la web.

**Claude Code local** (en la configuración de usuario, nunca en un `.mcp.json` versionado en este repo):

```bash
claude mcp add --scope user --transport http aitickets-admin https://aitickets.cl/api/admin/mcp \
  --header "Authorization: Bearer $AITICKETS_ADMIN_KEY"
```

## 3. Qué puedes hacer

Empieza siempre con `get_admin_context`. Prompts listos: `ayudar_productor`, `revisar_productor`, `pagar_retiros`,
`bandeja_operacion`, `cierre_mensual` y `reporte_plataforma`.

| Familia | Herramientas |
| --- | --- |
| Plataforma | `get_platform_overview`, `get_platform_timeseries`, `rank_producers`, `get_producer_funnel`, `list_platform_activity`, `get_system_health` |
| Productores | `search_organizations`, `get_organization`, `search_users`, `list_organization_notes` |
| Eventos | `search_events`, `get_event_analytics` |
| Compradores y órdenes | `search_orders`, `get_order_timeline` |
| Plata | `get_platform_finance`, `list_payout_requests`, `get_payout_transfer_details` (sensible), `list_refund_requests` |
| Operación (escrituras con `reason`) | `list_pending_operations` (lectura), `verify_payout_account`, `mark_payout_paid`, `mark_payout_failed`, `mark_refund_completed`, `mark_refund_failed`, `moderate_review`, `update_organization`, `add_organization_note`, `send_login_help` |
| Como productor | `org_<herramienta>` para todas las herramientas del MCP de productores, salvo pedir o anular retiros y tocar datos bancarios |

**Pagar un retiro.** Llega el aviso de Slack. En Claude dices "paga los retiros" y te muestra los pendientes y
los datos para transferir. Transfieres y le das el n° de comprobante. Claude te muestra el resumen, confirmas
y queda registrado; al productor le llega un correo con el comprobante.

## 4. Rotar la llave

1. `node scripts/admin-key.mjs` → llave y hash nuevos.
2. `AITICKETS_ADMIN_KEY_SHA256=<nuevo>,<viejo>` en Netlify y redeploy: las dos funcionan.
3. Recrea el conector en Claude con la llave nueva.
4. Deja solo `<nuevo>` y redeploya.

Cada llamada guarda la huella de la llave (los primeros 8 caracteres del hash) en `aitickets_admin_audit`.

## 5. Desactivarlo de emergencia

`ADMIN_MCP_ENABLED=false` (o borra el hash) y redeploya: el endpoint vuelve a responder 404.

## 6. Qué queda registrado

- **`aitickets_admin_audit`**: toda llamada, también las lecturas. Guarda la herramienta, el resultado, la
  organización, el objetivo, el motivo, el hash de los argumentos (nunca los argumentos), el hash de la IP y la
  duración.
- **`aitickets_api_audit` del productor**: lo que se hace con `org_*`. El productor lo ve en su bitácora como
  **Soporte AI Tickets** (canal `admin`), sin el motivo.
- **Slack**: avisa cuando alguien supera 10 intentos con llave inválida en 15 minutos.

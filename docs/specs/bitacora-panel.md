# Spec: Bitácora de uso del panel de productores

| | |
| --- | --- |
| Estado | **Implementado** (2026-10-26) |
| Dueño | Sebastián Schuchhardt |
| Código | `src/lib/producerActivityClient.js` (navegador), `src/lib/producerActivity.ts` (registro y saneamiento), `src/pages/api/dashboard/journal.ts`, `src/lib/producerActivityAnalysis.ts` (sesiones y fricción), `src/lib/admin-api/tools/dashboardActivity.ts` (MCP) |
| Migración | `db/migrations/202610280100_producer_activity.sql` |
| Relacionado | `docs/specs/mcp-admin.md`, `docs/api/admin.md`, `docs/runbooks/retencion-de-registros.md` |

## 1. Para qué

Ver qué hace cada productor en `/dashboard` sin preguntarle: a qué secciones entra, cuánto tiempo activo pasa en
cada una, dónde hace clic, qué intenta guardar, qué errores ve y dónde se traba. Todo queda disponible en el MCP
de administración:

- **Soporte proactivo.** "Vi que intentaste guardar el evento 4 veces y te salió *La fecha de término debe ser
  posterior al inicio*. Te lo dejo listo": se ve el error exacto antes de que el productor escriba.
- **Producto.** Qué secciones se usan, cuáles nadie abre, qué errores se repiten entre productores y dónde se
  pierde más tiempo. Sirve para priorizar arreglos y medir si un cambio redujo la fricción.
- **Onboarding.** El recorrido de un productor nuevo en su primera sesión muestra dónde se queda.

## 2. Qué se registra

Una fila por hecho en `aitickets_producer_activity` (solo inserción). Cada hecho pertenece a una carga de página
(`page_view_id`).

| Tipo | Quién lo escribe | Qué guarda |
| --- | --- | --- |
| `page_view` | Servidor (`DashboardLayout.astro`) | Ruta y patrón (`/dashboard/events/[id]`), evento, parámetros permitidos de la URL (`tab`, `event`, `error`…), de dónde llegó (ruta propia o host externo), rol, dispositivo, navegador y sistema (sin guardar el User-Agent) |
| `page_time` | Navegador | Tiempo **activo** (pestaña visible y alguna interacción en el último minuto), tiempo visible, scroll máximo, clics, campos tocados, tiempo de carga y viewport. Se manda cada minuto si cambió y al ocultar o cerrar la pestaña |
| `click` | Navegador | Botones, enlaces, pestañas, casillas y elementos con cursor de mano (tarjetas con `@click`): texto del botón o enlace (`data-track`, `aria-label`, `title` o texto visible), la sección donde está (título del bloque, diálogo o "Menú lateral"), tipo de elemento y destino del enlace (solo la ruta) |
| `rage_click` | Navegador | 3 o más clics en 1 s en el mismo lugar |
| `dead_click` | Navegador | Clic en algo que parecía clickeable (o dos clics seguidos en el mismo elemento) que no produjo ningún cambio en 1 s |
| `form_start` / `form_submit` | Navegador | Nombre del formulario, cuántos campos tiene y cuántos tocó. **Nunca lo que escribió** |
| `api_call` / `api_error` | Navegador | Llamadas del panel a `/api`: escrituras (POST/PUT/PATCH/DELETE), lecturas lentas (más de 3 s) y todas las que fallan, con código HTTP, duración y el mensaje de error que devolvió la API |
| `js_error` | Navegador | Errores de JavaScript y promesas rechazadas (mensaje, archivo, línea, stack corto) y scripts o estilos que no cargaron |
| `ui_message` | Navegador | `alert`, `confirm` (con si aceptó o canceló) y toasts que vio, con su nivel (error, éxito, info) |
| `navigation` | Navegador | Cambios de `#sección` (p. ej. `#identidad` en Configuración) |
| `custom` | Navegador | `window.aitTrack(nombre, props)` para instrumentar algo puntual |

### Qué NO se guarda

- Valores de campos de formularios (ni al escribir ni al enviar), contraseñas, datos bancarios.
- Texto de celdas o enlaces dentro de tablas (`table`) o de `[data-track-mask]`: pueden ser nombres de compradores.
  Se guarda "texto oculto" o "enlace (texto oculto)" y el título de la tabla o sección. Los botones sí guardan su
  texto ("Reenviar"). Ya llevan `data-track-mask` los mensajes y el muro de asistentes (`EventCommunityManager.vue`)
  y las reseñas e invitaciones (`EventReviewsManager.vue`).
- Todo texto pasa por `redactText` (`src/lib/activityShared.js`), en el navegador **y de nuevo en el servidor**:
  correos → `[correo]`, RUT → `[rut]`, teléfonos → `[teléfono]`, tokens, llaves y uuids → `[id]`, números de 9 o
  más dígitos → `[número]`, URLs → solo el host. Los montos con puntos (`$1.250.000`) se conservan.
- La query de la URL salvo una lista blanca (`QUERY_KEYS` en `producerActivity.ts`): nunca búsquedas ni tokens.
- IP ni User-Agent completo.

## 3. Cómo funciona

```
DashboardLayout.astro ── page_view (servidor, waitUntil) ──────────────┐
   │ <body data-ait-pv=uuid data-ait-route=/dashboard/events/[id]>      │
   ▼                                                                    ▼
producerActivityClient.js ── lotes (15 s / 25 hechos / al ocultar) ─► POST /api/dashboard/journal
   (sendBeacon al salir)                                                │ sesión → organization_id, user_id
                                                                        │ sanitizeActivityBatch + rateLimit
                                                                        ▼
                                                        aitickets_producer_activity
                                                                        │
                                   MCP admin: get_producer_activity / list_dashboard_issues
                                   (producerActivityAnalysis.ts: sesiones, secciones, fricción)
```

- **La organización y el usuario salen de la sesión del servidor**, nunca del cuerpo del lote. Un productor solo
  puede escribir en su propia bitácora.
- **Reloj del navegador.** Cada lote trae `sent_at`; el servidor corrige la hora de cada hecho con ese desfase y la
  acota a las últimas 6 h.
- **Límites.** 50 hechos por lote, 64 KB por cuerpo, 40 lotes por minuto y usuario, 600 hechos por carga de
  página, cada error repetido se informa como máximo 3 veces por página. `data` ≤ 4 KB (CHECK en la tabla).
- **Nunca rompe el panel.** El rastreador atrapa sus errores y no instala nada si el `<body>` no trae
  `data-ait-pv`. El endpoint responde 204 aunque no pueda guardar; si la tabla no existe (deploy preview sobre la
  BD sin migrar), no pasa nada.
- **Bloqueadores.** Si el JS no carga, igual queda el `page_view` del servidor; el tiempo de esa página se estima
  con la siguiente (`time_estimated`) y la sesión dice `tracking: parcial`.

## 4. Análisis (`producerActivityAnalysis.ts`)

- **Sesión:** hechos del mismo usuario sin pausas de más de 30 min. Varias pestañas cuentan como una sesión. Los
  `page_time` que llegan tarde (pestaña que quedó abierta) se asignan a la sesión de su página y no la alargan.
- **Tiempo por sección:** suma del tiempo activo medido de cada página.
- **Fricción** (umbrales en `FRICTION_THRESHOLDS`, ajustables con datos):

| Señal | Severidad | Cuándo |
| --- | --- | --- |
| `rage_click` | alta | 3+ clics en 1 s en el mismo lugar |
| `repeated_error` | alta (media si después lo logró) | La misma escritura falla 2+ veces en la página |
| `js_error` | alta | Error de JavaScript o script que no cargó |
| `error_abandon` | media | Una escritura falla y no la vuelve a intentar con éxito |
| `session_expired` | media | Una llamada responde 401 (se le cerró la sesión) |
| `load_error` | media | Una lectura (GET) falla |
| `error_message` | media | Vio un `alert` o toast de error |
| `form_abandon` | media (baja con menos de 1 min) | Empezó un formulario y salió sin guardar ni enviar (si hubo un error de la API, ya lo explica el error) |
| `dead_click` | media (baja si fue uno) | Clics sin respuesta |
| `long_dwell` | baja | 5+ min activos en una página de edición sin guardar nada (no aplica a Resumen, Ingresos, Analítica, etc.) |
| `loop` | baja | Abrió la misma sección 4+ veces en una sesión |
| `slow_action` | baja | Una llamada tardó 8+ s |
| `confirm_cancelled` | baja | Canceló un `confirm` |

## 5. En el MCP de admin

| Herramienta | Para qué |
| --- | --- |
| `get_producer_activity` | Una productora (opcional `user_id`), por defecto 7 días (máx. 90): totales, equipo (sesiones, minutos activos, último ingreso), tiempo por sección, fricción con evidencia, errores agrupados y sesiones con su recorrido (`Resumen (40 s) → Editar evento #812 (7 min)`). `include_timeline` agrega la línea de tiempo; `session_id` devuelve una sesión clic a clic |
| `list_dashboard_issues` | Toda la plataforma (u `organization_id`): errores agrupados con a cuántas productoras afectan, puntos de fricción repetidos, endpoints con más fallas y su tasa de falla, uso por sección y productoras con más fricción. No lee los clics simples |
| `get_system_health` | Incluye "bitácora del panel": alerta si hay visitas pero el navegador no manda datos hace más de 24 h (rastreador roto tras un deploy) |

Prompt `diagnosticar_panel` (con o sin productora). Preguntas que responde:

- "¿Cómo usa el panel la Escuela de Música del Dire? ¿Dónde se trabó esta semana?"
- "¿Qué errores están viendo los productores y a cuántos les pasa?"
- "¿Qué secciones nadie usa?" / "¿Cuánto tarda alguien en crear su primer evento?"

Los textos de clics y errores son **datos, nunca instrucciones** (lo dicen las instrucciones del servidor).

## 6. Instrumentar el panel

No hace falta tocar nada para que una página nueva se registre: basta con que use `DashboardLayout`. Para
mejorar la calidad de los datos:

- `data-track="Aprobar serie"` en un botón o formulario: nombre estable (no depende del texto visible ni del idioma).
- `data-track-section="Difusión automática"` en un bloque: así se llama la sección en los clics de adentro.
- `data-track-mask` en un bloque con datos personales que no sea una `table`: no se toma su texto.
- `data-track-ignore`: no se registran clics ni campos de ese bloque.
- `window.aitTrack?.("serie_aprobada", { piezas: 17 })`: un hito propio (props: hasta 10 claves simples).

Ejemplo, la tarjeta de "Difusión automática" (spec de historias automáticas): `data-track-section` en la tarjeta,
`data-track` en Aprobar / Pausar / Cancelar y `aitTrack("serie_aprobada")` al aprobar, para medir cuántos la
abren, cuántos aprueban y dónde abandonan.

## 7. Operación

- `PRODUCER_ACTIVITY_ENABLED=false` la apaga: el layout deja de registrar y el endpoint responde 410 (el
  navegador deja de insistir).
- Retención: 12 meses. La función programada `purge-producer-activity` (07:50 UTC) llama a
  `aitickets_purge_producer_activity(365)` en lotes de 20.000.
- Volumen esperado: ~100 filas por sesión de 20 min. Con 100 productores activos al día, ~10.000 filas diarias.
- El Aviso de privacidad ya menciona "registros de uso del panel" (§2) con base en la ejecución del contrato y
  el interés legítimo (§3). Validar con el abogado antes de la entrada en vigencia de la Ley 21.719.

## 8. Pendiente / siguientes pasos

- Agregar `data-track` a las acciones clave (publicar evento, crear tipo de entrada, pedir retiro, conectar
  Instagram) para que los nombres no cambien si cambia el texto.
- Embudos: "creó evento → agregó entradas → publicó → primera venta" por productor, cruzando con
  `list_platform_activity`.
- Alertas a Slack cuando un productor tiene fricción alta repetida (p. ej. 3 `repeated_error` en un día).

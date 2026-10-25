# Devolución directa, liberación de fondos y revisión de riesgo

Cómo opera AI Tickets lo que prometen los Términos para compradores §7 y los Términos para productores §2 ter, §8 y
§9 bis. Todas las rutas `/api/admin/*` exigen el header `x-admin-secret` igual a la variable `ADMIN_API_SECRET`
(mínimo 24 caracteres; sin ella responden 503). Cada acción queda en `aitickets_api_audit` con `channel = 'admin'`.

```sh
export ADMIN_API_SECRET=...        # Netlify > Environment variables (Functions, Production)
export SITE=https://aitickets.cl
```

## 1. Cuándo se libera lo vendido (ledger.ts)

Lo vendido para cada función se libera 48 h después de que termina **solo si se cumplen todas**:

1. Identidad del productor aprobada en Didit (`organizations.identity_status = 'approved'`).
2. Cuenta bancaria verificada (`organization_payout_accounts.verified_at`) y a nombre del mismo RUT verificado
   (`holder_match_status = 'match'`).
3. Check-ins de al menos 30% de las entradas pagadas de la función (`CHECKIN_RELEASE_THRESHOLD`), o el productor
   acreditó que se realizó (panel de Ingresos o herramienta `attest_function_held`; queda en
   `event_dates.held_attested_at` y avisa a Slack).
4. Sin reclamos ni contracargos abiertos sobre la función o el evento (`aitickets_disputes.status = 'open'`).

Si se cumplen, se aplica la reserva por riesgo: `events.reserve_pct` % queda retenido hasta 60 días después de la
función (`RESERVE_HOLD_DAYS`) y luego se libera solo. Lo que no se libera queda como **retenido** con su motivo
(`hold_reasons`) en el panel y en `get_balance`.

Si el productor acreditó una función con pocos check-ins, revisa la nota en Slack y pide evidencia si hace falta
(fotos, contrato del lugar). Una declaración falsa es causal de retención y término (Términos para productores §8 y §11).

## 2. Riesgo por evento y reserva

`netlify/lib/event-risk.mjs` calcula el score al publicar y cada hora (`funds-watch`) para eventos publicados que no
han terminado: productor nuevo, lugar sin dirección exacta, aforo > 1.000 o masivo, monto potencial > $20M, pico de
ventas, muchos correos con un mismo teléfono. Bajo = 0%, medio = 30%, alto = 100% de reserva. Alto o masivo también
exige documentos.

Ver y fijar a mano (el recálculo automático no lo pisa mientras esté fijado):

```sh
curl -s "$SITE/api/admin/events/risk?event_id=123" -H "x-admin-secret: $ADMIN_API_SECRET"
curl -s -X POST "$SITE/api/admin/events/risk" -H "x-admin-secret: $ADMIN_API_SECRET" -H 'content-type: application/json' \
  -d '{"event_id":123,"reviewer":"Seba","reserve_pct":50,"risk_level":"medium","lock":true}'
# volver al cálculo automático
curl -s -X POST "$SITE/api/admin/events/risk" -H "x-admin-secret: $ADMIN_API_SECRET" -H 'content-type: application/json' \
  -d '{"event_id":123,"reviewer":"Seba","lock":false}'
```

## 3. Documentos del evento

El productor sube autorización de la Delegación Presidencial, permiso del lugar y póliza RC en el panel del evento
(bucket privado `aitickets-event-documents`). Llega un aviso a Slack por cada uno. Revisar:

```sh
curl -s "$SITE/api/admin/events/documents?status=pending" -H "x-admin-secret: $ADMIN_API_SECRET"   # trae URLs firmadas de 5 min
curl -s -X POST "$SITE/api/admin/events/documents" -H "x-admin-secret: $ADMIN_API_SECRET" -H 'content-type: application/json' \
  -d '{"document_id":"<uuid>","status":"approved","reviewer":"Seba"}'
```

Al aprobar o rechazar se recalcula `events.permit_status` (la página pública muestra "Autorización en trámite /
aprobada"). Un evento masivo sin autorización aprobada queda "en trámite".

## 4. Reclamos y contracargos

Flow avisa los contracargos por correo: regístralos para que retengan la función.

```sh
curl -s -X POST "$SITE/api/admin/disputes" -H "x-admin-secret: $ADMIN_API_SECRET" -H 'content-type: application/json' \
  -d '{"order_id":"<uuid>","kind":"chargeback","reviewer":"Seba","notes":"Flow #123"}'
curl -s -X POST "$SITE/api/admin/disputes" -H "x-admin-secret: $ADMIN_API_SECRET" -H 'content-type: application/json' \
  -d '{"dispute_id":"<uuid>","status":"won","reviewer":"Seba"}'
```

`funds-watch` avisa a Slack si hay 3 o más en 24 h para un evento, o 5 en total.

## 5. Devolución directa (sin autorización del productor)

Procede solo en los supuestos de los términos (`reason_code`):

| Código | Supuesto |
| --- | --- |
| `not_held` | El evento no se realizó en la fecha anunciada y el productor no informó reprogramación en 5 días hábiles |
| `producer_unresponsive` | El productor no respondió durante 5 días hábiles después de un cambio o cancelación |
| `permit_revoked` | Una autoridad negó, revocó o suspendió la autorización del evento |
| `fraud` | Indicios de fraude o de que el evento no existe |

Antes: guarda la evidencia (correos al productor con fecha, resolución de la autoridad, capturas) y anótala en `--detail`.

```sh
# 1) resumen (no ejecuta nada): órdenes, montos y si el saldo del productor alcanza
ADMIN_API_SECRET=... node scripts/admin-direct-refund.mjs --event 123 --reason not_held --admin "Seba" --detail "Sin respuesta desde 2026-10-20"
# 2) ejecutar
ADMIN_API_SECRET=... node scripts/admin-direct-refund.mjs --event 123 --reason not_held --admin "Seba" --detail "..." --execute
```

Qué hace (misma lógica que `cancel_event`): pasa el evento a borrador con `cancelled_at`, anula todas las entradas,
registra un reembolso total por orden pagada (entradas + cargo por servicio + IVA, `requested_via = 'admin'`) y avisa a
los compradores por correo (`--no-notify` para no avisar). El valor de las entradas se descuenta de lo pendiente por
transferir al productor; si ya se le transfirió, el saldo queda negativo: pídele la restitución en 5 días hábiles
junto con el cargo por servicio devuelto y los costos (Términos para productores §9 bis).

Después: procesar los reembolsos en Flow en hasta 20 días hábiles (marcar `aitickets_refunds.status`), y si hubo
indicios de delito, evaluar la denuncia (Términos para productores §11 bis).

## Variables y funciones

- `ADMIN_API_SECRET`: rutas `/api/admin/*` y `scripts/admin-direct-refund.mjs`.
- `funds-watch` (Netlify scheduled, cada hora a los :40): riesgo, funciones sin check-ins, picos de contracargos.
- Migración `202610260200_funds_release_risk.sql`.

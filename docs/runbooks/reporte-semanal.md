# Reporte semanal a productores

Correo de los domingos a los dueños de cada productora con eventos activos: entradas vendidas y dinero de la
semana, mejor canal e ideas con IA para promover cada evento (siempre una de contenido y una de publicidad).
Migración `db/migrations/202610250100_weekly_producer_reports.sql`.

| Pieza | Archivo |
| --- | --- |
| Reglas y cifras (semana, qué eventos entran, canales, mejor canal, ideas de respaldo) | `netlify/lib/weekly-report.mjs` |
| Ideas con IA (Claude, salida JSON estructurada) | `netlify/lib/weekly-report-ai.mjs` |
| Envío (productoras, reclamo de la semana, destinatarios, registro) | `netlify/lib/weekly-report-send.mjs` |
| Correo | `netlify/lib/emails/weekly-report.mjs` (vista previa: `node scripts/preview-emails.mjs`) |
| Programada (domingos) y background | `netlify/functions/send-weekly-reports`, `netlify/functions/send-weekly-reports-background` |
| Baja / volver a recibirlo | `src/pages/reporte-semanal/baja.astro`, `src/pages/api/reporte-semanal/baja.ts` |

## Reglas

- **Cuándo**: domingos. `send-weekly-reports` corre cada hora a los :40 entre 13 y 22 UTC (10:40 a 19:40 en Chile
  en horario de verano, una hora antes en invierno) y dispara la background. La primera corrida envía casi todo;
  las demás solo retoman lo que faltó o falló.
- **Semana**: del domingo anterior 00:00 al domingo del envío 00:00, hora de Chile (domingo a sábado completos).
  Se compara con la semana previa.
- **Eventos que entran**: publicados, no cancelados ni archivados, no demo, que aún no terminan (`end_date` futura)
  y **creados antes del sábado** de esa semana. Un evento creado el sábado o el domingo no entra; si la productora
  no tiene otro, ese domingo no recibe reporte. Hasta 15 eventos por productora (los que vienen antes) y 6 por correo.
- **Cifras**: ventas sin cortesías ni transferencias (`netlify/lib/order-kinds.mjs`); el dinero es el de las entradas
  para la productora (con descuentos, sin cargo por servicio), igual que `get_event_performance`.
- **Canales**: una venta tiene canal solo si se compró con `ref` (promotor) o UTM; si no, "Directo / sin
  seguimiento". Las visitas usan sus UTM o el sitio de origen (referrer). **Mejor canal** = el que más entradas
  vendió con seguimiento; si ninguna venta lo trae, la fuente con más visitas (el correo lo dice).
- **Destinatarios**: miembros activos con rol `admin` o `producer`, con correo válido, sin quienes se dieron de baja.
  Quien está asignado solo a algunos eventos (`aitickets_event_staff`) recibe solo esos (y sin el resumen de la IA,
  que habla de toda la productora).
- **Ideas**: una llamada a Claude por productora (`WEEKLY_REPORT_MODEL` o `ANTHROPIC_MODEL`, esfuerzo bajo). Las
  ideas se limpian (sin URLs ni markdown, largo máximo) y se completan con reglas fijas si falta la de contenido o la
  de publicidad. Sin API key, con error o con `WEEKLY_REPORT_AI=off`, todas salen de reglas fijas: el correo se envía
  igual. Los links con seguimiento (`utm_campaign=reporte-semanal`, `utm_medium=paid` para anuncios, `ref` para
  promotores) los arma el servidor, nunca la IA.

## Una vez por semana (sin duplicados)

`aitickets_weekly_reports` tiene una fila por productora y semana (`organization_id + week_start` únicos):

- La background **reclama** la semana con un INSERT antes de enviar; otra ejecución que llegue después no envía.
- `status`: `sending` → `sent` | `skipped` (sin destinatarios) | `failed` (fallaron todos los correos o hubo error).
- Se reintenta en la corrida siguiente una fila `failed` o una `sending` de más de 20 min (la invocación murió),
  hasta 3 intentos. Cada correo lleva `Idempotency-Key` por persona y semana: Resend no repite uno que ya salió.
- `summary` guarda las cifras, el mejor canal por evento, si las ideas fueron de IA y el resultado por persona.

Revisar la semana:

```sql
SELECT organization_id, status, attempts, recipients, events, ai_provider, error, sent_at
FROM public.aitickets_weekly_reports
WHERE week_start = '2026-10-18'  -- domingo en que EMPIEZA la semana reportada
ORDER BY status, organization_id;
```

## Disparo manual

Todas las llamadas van a la background con el secreto interno (responde 202; el resultado queda en el log de la
función y, en envíos reales, en Slack):

```sh
curl -X POST "$SITE_URL/.netlify/functions/send-weekly-reports-background" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" -H "Content-Type: application/json" \
  -d '{"organizationId": 123, "previewTo": "tu@correo.cl"}'
```

| Body | Qué hace |
| --- | --- |
| `{"organizationId": 123, "previewTo": "tu@correo.cl"}` | Vista previa del reporte de esa productora con datos reales, **solo** a esa dirección, cualquier día. No registra nada (no bloquea el domingo). |
| `{"organizationId": 123, "dryRun": true}` | Arma el reporte sin enviar; el resultado (asunto, eventos, ideas) queda en el log. |
| `{}` | Corrida normal (solo envía si es domingo en Chile). |
| `{"force": true}` | Corre aunque no sea domingo. Igual no repite una semana ya enviada: úsalo solo si el domingo no corrió nada. |

## Apagar

- Todo el envío: `WEEKLY_REPORTS_ENABLED=false` (scope Functions). Las vistas previas manuales siguen funcionando.
- Solo la IA: `WEEKLY_REPORT_AI=off` (las ideas salen de reglas fijas).
- Una persona: el enlace "Darme de baja" del correo (one-click RFC 8058 incluido). Desde la misma página puede volver
  a activarlo. A mano: `INSERT INTO aitickets_user_email_optouts (user_id, topic, source) VALUES (<id>, 'weekly_report', 'dashboard');`

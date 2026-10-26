# Retención de registros

Política de conservación de AI Tickets para responder a requerimientos de Carabineros, la PDI, el Ministerio Público,
el SERNAC, el SII u otra autoridad (Términos para productores §11 bis, Aviso de privacidad §6). Plazos mínimos: no se
borra antes. Al vencer, se elimina o anonimiza salvo que haya un requerimiento, reclamo o juicio pendiente (en ese caso
se conserva hasta que termine: **retención por litigio**).

> Borrador operativo. Validar plazos con el contador (tributarios) y el abogado (Ley 21.719, vigente desde diciembre 2026).

| Registro | Dónde | Plazo | Motivo |
| --- | --- | --- | --- |
| Órdenes, pagos, reembolsos, retiros y liquidaciones | `event_orders`, `aitickets_refunds`, `aitickets_payouts`, `event_withdrawals` | 6 años desde el cierre del año comercial | Código Tributario (art. 17 y 200) y contabilidad del mandato |
| Entradas y check-ins | `event_attendees` (`validated_at`), `event_tickets` | 6 años (igual que la orden) | Prueba de que la función se realizó; liberación de fondos; reclamos SERNAC |
| Acreditación de funciones y documentos del evento | `event_dates.held_attested_*`, `aitickets_event_documents` + bucket `aitickets-event-documents` | 6 años desde el evento | Permisos (Ley 21.659), prueba ante autoridades |
| Reclamos y contracargos | `aitickets_disputes` | 6 años desde que se cierran | Disputas con Flow/bancos y SERNAC |
| Bitácora de acciones | `aitickets_api_audit` | 6 años | Quién hizo qué (incluye devoluciones directas `channel = 'admin'`) |
| Comunicaciones con compradores y productores | `notification_log`, `aitickets_attendee_messages`, correos en Resend, Slack | 2 años (Resend/Slack según su propio plazo; exportar si hay requerimiento) | Prueba de avisos (cancelaciones, cambios, devoluciones) |
| Verificación de identidad (resultado) | `organizations.identity_*` | Mientras la cuenta esté activa y 5 años después | Prevención de fraude y lavado de activos |
| Imágenes biométricas (documento, selfie, prueba de vida) | Solo en Didit | Lo que fije el contrato con Didit; no se copian a Supabase | Dato sensible (Ley 21.719) |
| Datos bancarios del productor | `organization_payout_accounts` | Mientras la cuenta esté activa y 6 años después del último retiro | Tributario y prueba de pago |
| Logs técnicos (Netlify, Sentry) | Proveedores | 30 a 90 días según el proveedor | Seguridad; exportar si hay requerimiento abierto |
| Analítica | Google Analytics, `event_visits` | 14 meses | Interés legítimo, anonimizada después |
| Uso del panel de productores | `aitickets_producer_activity` | 12 meses (borrado diario: `purge-producer-activity`) | Soporte y mejora del servicio; sin valores de formularios (`docs/specs/bitacora-panel.md`) |

## Requerimiento de una autoridad

1. Registrar el requerimiento (fecha, autoridad, número de causa u oficio, plazo) y avisar en Slack.
2. Marcar retención por litigio: no borrar nada del productor/evento involucrado hasta cerrar el caso.
3. Entregar solo lo pedido, por el canal oficial, y dejar copia de lo entregado.
4. Si corresponde, suspender la cuenta o el evento (Términos para productores §11 bis) y evaluar la devolución directa
   (`docs/runbooks/devolucion-directa.md`).

## Filtraciones

Ante una vulneración de seguridad: contener, evaluar qué datos y titulares se afectaron, avisar a la Agencia de
Protección de Datos Personales y a los titulares cuando la ley lo exija, y a los productores afectados
(Términos para productores §10). Pendiente: protocolo formal y DPA firmados con Didit, Anthropic, OpenAI y Supabase.

# Runbook: bot de WhatsApp (Kapso)

## Qué hace

Un número de WhatsApp de AI Tickets, conectado a [Kapso](https://docs.kapso.ai), responde con Claude a:

| Quién | Qué resuelve el bot | Herramienta |
| --- | --- | --- |
| Asistentes | Buscar eventos públicos próximos (texto, ciudad, fechas) | `buscar_eventos` |
| Asistentes | Dudas de un evento puntual (fechas, lugar, precios con cargo, FAQs) | `ver_evento` |
| Asistentes | "No me llegaron las entradas": lista sus compras por el número de WhatsApp y reenvía el correo | `mis_compras`, `reenviar_entradas` |
| Asistentes | Preguntas que la ficha no responde → tabla `questions` (la productora responde por correo) | `preguntar_a_productora` |
| Productores | Venta de AI Tickets (0% para el productor, cargo 8% + IVA al comprador, link de registro) y captura del lead (`aitickets_leads`, `source = 'whatsapp'`) | `registrar_productor` |
| Todos | Reembolsos, cobros, reclamos o lo que no pueda resolver → pausa el bot y avisa por Slack | `derivar_a_persona` |

Privacidad: `mis_compras` solo busca órdenes **pagadas** cuyo `buyer_phone` termina en los mismos 9 dígitos que el
número de WhatsApp (que WhatsApp ya verificó), y nunca entrega links de órdenes ni QR. `reenviar_entradas` siempre
envía al correo registrado en la orden; por correo responde lo mismo exista o no la compra.

## Arquitectura

```
Kapso ──(webhook firmado)──▶ /api/whatsapp/webhook ──▶ aitickets_wa_messages
                                     │ (x-internal-secret)
                                     ▼
                        whatsapp-bot-background ──▶ Claude + herramientas ──▶ Kapso API (respuesta)
```

- `netlify/functions/whatsapp-webhook`: verifica `X-Webhook-Signature`, guarda el mensaje (wamid único, los
  reintentos no duplican) y dispara la background function. Responde en < 10 s como exige Kapso.
- `netlify/functions/whatsapp-bot-background`: toma el candado de la conversación
  (`aitickets_wa_claim_conversation`), marca leído + "escribiendo…", corre el agente
  (`netlify/lib/whatsapp/agent.mjs`) y envía la respuesta. Si llegan mensajes mientras responde, vuelve a correr.
- Tablas: `aitickets_wa_conversations`, `aitickets_wa_messages` (migración `202610120100_whatsapp_bot.sql`).
- Límite: 30 turnos del bot por conversación por hora; al pasarlo se pausa 1 h y avisa por Slack.

## Intervención humana

Responde desde el **Inbox de Kapso**. Cada `whatsapp.message.sent` que el bot no envió se guarda como mensaje
`human` y **pausa el bot en esa conversación** por `WHATSAPP_HUMAN_PAUSE_HOURS` (12 h por defecto); cada nueva
respuesta humana renueva la pausa. Al terminar la pausa el bot retoma con todo el historial (incluidas las
respuestas humanas). `derivar_a_persona` también pausa el bot y avisa a `SLACK_WEBHOOK_URL`.

Para reactivar el bot antes de tiempo:

```sql
UPDATE public.aitickets_wa_conversations SET bot_paused_until = NULL WHERE id = '<conversation id de Kapso>';
```

## Puesta en marcha

1. **Kapso**: crea el proyecto y conecta el número en **WhatsApp → Phone numbers** (para probar sirve el número
   sandbox del plan gratis). Copia el `phone_number_id`.
2. **API key**: **Integrations → API keys** → crea una key del proyecto.
3. **Variables en Netlify** (Site settings → Environment variables, contexto Production):
   `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET` (un secreto largo aleatorio, p. ej.
   `openssl rand -hex 32`). Opcionales: `WHATSAPP_BOT_MODEL` (por defecto `claude-opus-5-5`),
   `WHATSAPP_HUMAN_PAUSE_HOURS`. `PUBLIC_WHATSAPP_NUMBER` (número del bot, solo dígitos) muestra el link
   "¿Prefieres WhatsApp?" en el asistente de cada evento y lo usa la sección de contacto de `/organizadores`;
   como es `PUBLIC_`, se fija en el build. Ya deben existir `ANTHROPIC_API_KEY`, `INTERNAL_API_SECRET`, `SITE_URL` y
   `SLACK_WEBHOOK_URL`.
4. **Deploy** a producción (la migración corre en el build de producción).
5. **Webhook de WhatsApp** en Kapso (kind `kapso`, payload v2), con el mismo secreto:

   ```bash
   jq -n --arg url "https://aitickets.cl/api/whatsapp/webhook" --arg secret "$KAPSO_WEBHOOK_SECRET" \
     '{whatsapp_webhook:{kind:"kapso",url:$url,secret_key:$secret,events:["whatsapp.message.received","whatsapp.message.sent"],active:true}}' \
   | curl --fail-with-body -X POST \
       "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/$KAPSO_PHONE_NUMBER_ID/webhooks" \
       -H "X-API-Key: $KAPSO_API_KEY" -H 'Content-Type: application/json' --data-binary @-
   ```

   O desde el dashboard. Recomendado: activar **buffering** de `whatsapp.message.received` con 3–5 s, para que
   varios mensajes seguidos se respondan en un solo turno.
6. **Probar**: escribe al número "hola", "¿qué eventos hay en Santiago este fin de semana?", "no me llegaron mis
   entradas" y "soy productor, ¿cuánto cobran?". Revisa los logs de `whatsapp-bot-background` en Netlify
   (`[wa-bot] {"conversationId":…,"turns":1}`).

## Problemas comunes

| Síntoma | Causa probable |
| --- | --- |
| Kapso marca el webhook con 401 | `KAPSO_WEBHOOK_SECRET` distinto al `secret_key` del webhook |
| 503 en el webhook | Falta `KAPSO_WEBHOOK_SECRET` |
| Se guardan mensajes pero el bot no responde | `[wa-webhook] no se pudo disparar el bot`: falta `INTERNAL_API_SECRET` o `SITE_URL`/`DEPLOY_URL`; o en `[wa-bot]` faltan `KAPSO_API_KEY`/`KAPSO_PHONE_NUMBER_ID`/`ANTHROPIC_API_KEY` |
| El bot no responde en una conversación | Está en pausa (`bot_paused_until`) por una respuesta humana, derivación o límite |
| `mis_compras` no encuentra la compra | El comprador escribió otro teléfono al comprar: el bot ofrece reenviar por correo |
| El bot no puede escribir primero / después de 24 h | Regla de WhatsApp: fuera de la ventana de 24 h solo se pueden enviar plantillas aprobadas (no implementado) |

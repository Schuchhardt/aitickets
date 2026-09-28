# Evaluación de interés legítimo: contacto comercial B2B (outreach)

> **Borrador para revisión legal.** Este documento debe ser revisado y firmado por el responsable
> (Chanium LLC) antes de activar el envío real. El código exige `OUTREACH_LIA_APPROVED=true`, además
> de `legalReady()` (dirección postal y correo legal; por defecto Lican Ray 6742, Vitacura, y hello@chanium.com), para enviar cualquier correo en frío.

| Campo | Valor |
| --- | --- |
| Responsable | Chanium, LLC (Delaware LLC, archivo N° 10669971; domicilio comercial Lican Ray 6742, Vitacura, Región Metropolitana, Chile; hello@chanium.com), operadora de AI Tickets |
| Tratamiento | Contacto comercial por correo a productoras, salas y centros culturales |
| Base de licitud | Interés legítimo (Ley 21.719, vigente desde el 1 de diciembre de 2026; confirmar el artículo con el abogado) |
| Normas relacionadas | Ley 19.496 art. 28 B (comunicaciones promocionales), CAN-SPAM Act (EE.UU.) |
| Versión | 2026-09-26 (borrador) |
| Aprobado por / fecha | _pendiente_ |

## 1. Finalidad e interés

AI Tickets ofrece a productores de eventos una web de eventos gratis y venta de entradas, con 0% de
comisión para el productor. El interés es dar a conocer ese servicio a organizaciones que venden
entradas para sus eventos. Es un interés comercial lícito, concreto y actual.

## 2. Necesidad

- Solo se usan datos de contacto **comerciales** publicados por la propia organización (correo de rol
  como `contacto@`, `hola@` o `produccion@`, en el sitio web de la organización) y datos públicos de sus
  eventos.
- No hay una forma menos invasiva de llegar a organizaciones que no nos conocen. El volumen es bajo:
  tope diario (`OUTREACH_DAILY_CAP`, 20 por defecto), a lo más 2 seguimientos y, sin respuesta, no se
  vuelve a contactar antes de 180 días.

## 3. Datos y fuentes

| Dato | Fuente | Se guarda |
| --- | --- | --- |
| Nombre de la organización, evento próximo, comuna | API pública de Chile Cultura (Ministerio de las Culturas) | Sí, con URL de origen |
| Correo de contacto comercial | Sitio web propio de la organización (máx. 5 páginas, respeta robots.txt) | Sí, con `email_source_url` y fecha |
| Validez del dominio de correo | Registro MX del DNS | No (solo se usa para descartar) |
| Datos del formulario /web-gratis | La propia persona (consentimiento) | Sí |

**No se usan:** listas compradas, redes sociales (Instagram, Facebook, LinkedIn), Eventbrite ni otras
plataformas cuyos términos lo prohíben, sondeo SMTP para adivinar correos, ni datos sensibles.
Organismos públicos, colegios, universidades y correos personales de artistas se descartan.

## 4. Ponderación (test de balance)

- **Expectativa razonable:** una organización que publica un correo de contacto comercial y vende
  entradas espera recibir propuestas comerciales relacionadas con su actividad.
- **Impacto:** bajo. Un correo breve, personalizado, sin seguimiento de aperturas ni píxeles, con a lo
  más un enlace a aitickets.cl.
- **Salvaguardas:**
  - Cada correo identifica al remitente (Chanium LLC, dirección postal), indica que es comercial, dice
    dónde se obtuvo el contacto e incluye cómo darse de baja (responder "NO" o enlace de baja de un clic,
    RFC 8058).
  - La baja se registra de inmediato y es permanente (`aitickets_suppressions` nunca se borra).
  - Supresión por correo y por dominio corporativo; exclusión del bot en https://aitickets.cl/bot.
  - Auto-pausa si en los últimos 100 envíos los rebotes superan 3%, las quejas 0,1% o las bajas 5%.
  - Respuestas automáticas solo con plantilla fija para quien pide registrarse; cualquier otra
    respuesta la revisa una persona.
  - Envío desde un dominio y proveedor separados del correo transaccional (nunca Mailgun).
- **Derechos del titular:** acceso, rectificación, supresión, oposición y portabilidad escribiendo al
  correo de privacidad publicado en /privacy (sección "Contacto comercial B2B").

**Conclusión (borrador):** el interés legítimo prevalece siempre que se mantengan las salvaguardas
anteriores. Solo se contacta en Chile (`OUTREACH_COUNTRIES=CL`); otros países (Perú, Colombia,
Argentina, México) requieren una evaluación propia antes de habilitarse.

## 5. Conservación

- Leads sin respuesta: se conservan los datos de contacto hasta 24 meses desde el último contacto;
  después se anonimizan (el registro de supresión se mantiene). _Pendiente: tarea programada de anonimización._
- Supresiones: indefinidamente, para cumplir la obligación de no volver a enviar.

## 6. Revisión

Revisar esta evaluación cada 12 meses, al agregar una fuente de datos o un país, o si la tasa de quejas
supera el umbral de auto-pausa.

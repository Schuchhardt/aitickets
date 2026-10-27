# AI Tickets — Landing para academias de música, danza y teatro

**Para:** Claude Code (implementación)
**Ruta sugerida:** `/academias` (enlazada desde el footer, desde `/organizadores` y desde la sección "Hecho para" de las otras landings).
**Público:** directoras, directores y coordinadores de academias, escuelas de danza, talleres de teatro, coros y colegios artísticos que hacen muestras o recitales para familias y hoy venden o reparten entradas de manera informal (grupo de WhatsApp, transferencias, planilla, entradas impresas, caja en la puerta).
**Promesa:** *El día de la muestra, preocúpate solo del escenario.* AI Tickets ordena la venta o la reserva, entrega las entradas al celular, controla la puerta y deposita lo recaudado.
**Métrica:** visitas → cuentas creadas → primera muestra publicada (gratis o pagada).
**Prototipo:** canvas "AI Tickets — Rediseño", página "Landing productores", artboards **Academias · Desktop** y **Academias · Mobile**. Si hay diferencias, manda este documento.
**Reutiliza** de `SPEC_landing_productores_aitickets.md`: fórmula de precio (§5.3), header sticky (§4), accesibilidad (§9), analítica base (§11). De `SPEC_landing_standup_aitickets.md`: el par tipográfico display + serif cursiva.

---

## 0. Antes de empezar (Claude Code)

1. **Tema propio, claro y cálido** (`[data-theme="academias"]`). No cambia los tokens globales.
2. **Verificar en el backend** antes de publicar cada promesa (si algo no existe, se ajusta el copy o se marca `Pronto`):
   - Máximo de entradas por compra configurable por evento.
   - Links con seguimiento usados "por curso" (son los mismos links por promotor; solo cambia el nombre).
   - Búsqueda de asistente por nombre en el check-in.
   - Reenvío de entradas desde el panel.
   - Exportar lista de asistentes por función.
3. **Fotos:** las del prototipo son generadas con IA solo como referencia. En producción, fotos reales de muestras **con autorización escrita de la academia y de las familias**. Si aparecen menores de edad, la academia debe confirmar que tiene el consentimiento de sus apoderados para uso publicitario; ante la duda, usar fotos donde no se reconozcan rostros de menores.
4. **Testimonio:** solo una cita real (directora/director, academia, ciudad). Si no hay, se oculta el bloque de la cita y quedan los chips "Hecho para".
5. **Marca de terceros:** el mockup del chat dice "grupo de WhatsApp" en el titular, pero la interfaz dibujada es genérica (sin logo ni colores de WhatsApp).

---

## 1. Sistema visual

```css
[data-theme="academias"] {
  --ac-paper: #FBF7F0;     /* fondo */
  --ac-card: #FFFFFF;
  --ac-sand: #F1EADF;      /* secciones alternas, controles */
  --ac-ink: #1B1712;       /* texto y botón primario */
  --ac-text-2: #3E372F;
  --ac-text-3: #5E554B;    /* eyebrows */
  --ac-text-4: #6F665C;    /* meta, legales (AA sobre paper) */
  --ac-serif: #7A5C3E;     /* palabras en cursiva serif */
  --ac-chaos: #C2410C;     /* solo en el estado "Antes" */
  --ac-chaos-bg: #FDE8DF;
  --brand-lime: (lima de marca);
}
```

- Titulares: display (prototipo: Sora 700) + segunda parte en serif cursiva (Fraunces italic 400) en `--ac-serif`. H1 64/66 desktop, 38/41 mobile. H2 52/56 desktop, 32/36 mobile.
- Botón primario: negro tinta sobre papel; en el cierre (fondo foto oscura) pasa a lima.
- Fotos con radio 32 px (24 en mobile) y sombra cálida suave `0 30px 70px rgba(70,50,30,.18)`.
- El naranjo `--ac-chaos` se usa **solo** para representar el desorden del "Antes".

---

## 2. Estructura

| # | Sección | Fondo |
|---|---|---|
| 1 | Hero (texto + foto de la muestra con cards flotantes) | paper |
| 2 | ¿Te suena familiar? — comparador Antes / Con AI Tickets | card (blanco) |
| 3 | Cómo funciona (3 pasos) | paper |
| 4 | El día de la muestra (puerta) | paper |
| 5 | Gratis o con entrada (precio) | sand |
| 6 | Hecho para + testimonio | paper |
| 7 | Preguntas frecuentes | paper |
| 8 | Cierre con foto | foto + overlay |
| 9 | Footer | paper |

---

## 3. Secciones

### 3.1 Header
Sticky, papel translúcido con blur al hacer scroll. Links: `Cómo funciona` (ancla), `Precio` (ancla), `Ingresar`, botón tinta `Crear mi muestra`.

### 3.2 Hero
- Eyebrow: `PARA ACADEMIAS DE MÚSICA, DANZA Y TEATRO`
- H1: **El día de la muestra, preocúpate** *solo del escenario.*
- Bajada: *Las familias compran o reservan con un link, reciben su entrada en el celular y entran con QR. Sin planillas, sin transferencias que revisar, sin entradas impresas y sin caja en la puerta.*
- CTAs: `Crear mi muestra gratis →` (tinta) · `Ver una muestra de ejemplo` (borde).
- Microcopy: *Si tu muestra es gratis, no pagas nada. Si cobras entrada, la familia paga un cargo de 8% + IVA, o lo absorbe la academia.*
- Derecha: foto 5:4 de una muestra con familias grabando. Dos cards flotantes (datos de ejemplo):
  - Abajo a la izquierda (blanca): `Muestra de fin de año · ejemplo` / `Sáb 13 dic · 11:00 y 17:00` / barra lima 88% / `Entradas 212 de 240`.
  - Arriba a la derecha (tinta): check lima + `Familia Rojas · 4 entradas` / `Enviadas a su correo con QR`.

### 3.3 ¿Te suena familiar? (sección clave)
- Eyebrow `¿TE SUENA FAMILIAR?`; H2 **Del grupo de WhatsApp** *a un solo link.*
- A la derecha del título, un **segmented control** `Antes | Con AI Tickets`. El indicador se desliza; en "Antes" es naranjo `--ac-chaos` con texto blanco, en "Con AI Tickets" es tinta.
- **Comportamiento:** al entrar en viewport arranca en "Antes"; los mensajes del chat aparecen uno a uno (260 ms entre cada uno). A los 2,6 s cambia solo a "Con AI Tickets", **una vez**. Si el usuario toca el control antes, no hay cambio automático.
- **Izquierda, panel "Antes"** (fondo `#EFE6D8`): chat genérico "Apoderados Piano 2026 · 47 participantes · +38", con estos mensajes:
  1. Carla (mamá de Sofi): ¿Quedan entradas para el sábado? Somos 5
  2. Jorge: Transferí $15.000, ¿me confirman?
  3. Profe Marcela (propio, a la derecha, verde claro): Las entradas se retiran el jueves en secretaría
  4. Ana: ¿La abuela paga entrada?
  5. Paula: No alcancé a retirarlas, ¿las pueden dejar en la puerta?
  6. Jorge: ¿Les llegó mi transferencia???
  - Post-it amarillo girado 4°: `Planilla.xlsx / ¿Pagó? ¿Cuántas? ¿Retiró? / 87 filas`.
- **Izquierda, panel "Con AI Tickets"** (fondo tinta): `Tu panel · ejemplo`, `Muestra de fin de año`, `Sáb 13 dic · 11:00 y 17:00 · Teatro del colegio`, contador `212 de 240 entradas`; **Por curso** con barras lima animadas (Teatro infantil 64, Piano 48, Canto 40, Violín 36, Guitarra 24); dos mini cards: `Recaudado $1.060.000 · Llega 48 h después del evento` y `Lista de asistentes · Descargar ↓ · Por nombre, curso y función`.
- Transición entre paneles: crossfade + `translateY ±12px` + `scale .98→1`, 420 ms.
- **Derecha, lista de 6 filas** que cambia con el modo (ícono × naranjo / ✓ lima):

| Antes | Con AI Tickets |
|---|---|
| **80 mensajes preguntando lo mismo** — Cuántas quedan, cuánto cuestan, si la abuela paga, a qué hora es. | **Un link en el grupo, y listo** — Fecha, horario, lugar y precio en una página. Las dudas se responden solas. |
| **Transferencias que revisar una por una** — Y cruzarlas con quién dijo que pagó. | **Pago confirmado al instante** — Con Webpay o tarjeta. Nadie tiene que revisar transferencias. |
| **Una planilla de quién pagó y cuántas** — Que solo entiende quien la armó. | **Todo en tu panel** — Cuántas entradas lleva cada curso y cada función, en tiempo real. |
| **Entradas impresas que repartir** — Retiro en secretaría y familias que no alcanzan a ir. | **La entrada llega al celular** — Con QR, por correo. Sin imprimir ni repartir nada. |
| **Caja con efectivo el mismo día** — Vuelto, monedas y alguien cuidando la plata. | **Cero efectivo** — Lo recaudado llega a tu cuenta 48 horas después del evento. |
| **Una lista en papel en la puerta** — Y una fila que no avanza mientras empieza la función. | **La puerta avanza sola** — Tu equipo escanea con el celular, aunque se caiga la señal. |

### 3.4 Cómo funciona
- Eyebrow `CÓMO FUNCIONA`; H2 **Tres pasos,** *y cero filas en secretaría.*
- 3 cards blancas (radio 28) con número en círculo arena, etiqueta de tiempo a la derecha, título, texto y un "tip" en caja papel:

| Paso | Etiqueta | Título | Texto | Tip |
|---|---|---|---|---|
| 1 | 10 MINUTOS | Creas la muestra | Fecha, uno o dos horarios, el lugar y cuántos caben. Gratis o con entrada. | ¿Dos funciones, 11:00 y 17:00? Cada una con su propio cupo. |
| 2 | UN MENSAJE | Compartes un link | En el grupo de apoderados, por correo o en tu Instagram. Las familias compran o reservan desde el celular. | Con un link por curso sabes cuántas entradas compró cada uno. |
| 3 | EL DÍA DE LA MUESTRA | Recibes a las familias | Tu equipo escanea los QR en la puerta. Si cobraste, 48 horas después tienes todo en tu cuenta. | ¿Alguien perdió su entrada? Se la reenvías desde el panel en un toque. |

### 3.5 El día de la muestra
- Izquierda: foto 4:5 de una familia mostrando su QR y una profesora escaneando; card lima encima `✓ Válida · Familia Rojas · 4 de 4 · Función 17:00`.
- Derecha: eyebrow `EL DÍA DE LA MUESTRA`; H2 **Nadie en la puerta** *con una lista de papel.*; 4 ítems con punto lima:
  - **Profes o voluntarios escanean con su celular** — Les das el rol Puerta o un link que vence solo. No necesitan cuenta ni contraseña.
  - **Funciona aunque el gimnasio no tenga señal** — Se valida con la lista descargada y se sincroniza cuando vuelve la conexión.
  - **¿El abuelo no tiene la entrada en el celular?** — Se busca por nombre en la lista y entra igual.
  - **Profes e invitados, con cortesía** — Les mandas una entrada sin costo con su propio QR.

### 3.6 Gratis o con entrada (ancla `#precio`)
- Eyebrow `GRATIS O CON ENTRADA`; H2 **Funciona igual** *si cobras o no.*
- Card blanca "Muestra gratuita": pill lima, **Las familias reservan su lugar.**, *Pones un cupo por función y nadie queda parado al fondo. Cada familia recibe su QR igual que si hubiera pagado.*, `$0 para todos`.
- Card tinta "Muestra con entrada": **Para la academia, el viaje de fin de año o la beca.**, *0% de comisión para la academia. La familia paga un cargo de 8% + IVA, o lo absorbes tú y muestras un precio redondo. Recibes todo 48 horas después del evento.* + mini calculadora: slider `Valor de la entrada` ($1.000–$20.000, default $5.000), segmented `Paga la familia / Lo absorbo yo`, resultados `La familia paga` y `La academia recibe` (lima, grande). Verificación: $5.000 → familia $5.476 / academia $5.000; absorbido → $4.524.

### 3.7 Hecho para + testimonio
- Foto 4:5 de una directora en su sala con piano (en producción: foto real autorizada).
- Eyebrow `HECHO PARA` + chips: Academias de música · Escuelas de danza · Talleres de teatro · Coros · Colegios artísticos · Conservatorios.
- Cita en serif cursiva 34/44: **solo si es real**. Nombre y academia debajo.

### 3.8 Preguntas frecuentes

| Pregunta | Respuesta |
|---|---|
| ¿Cuánto cuesta? | Si tu muestra es gratis, nada. Si cobras entrada, la academia no paga comisión: la familia paga un cargo por servicio de 8% más IVA sobre ese cargo, o lo absorbe la academia para mostrar un precio redondo. |
| ¿Las familias tienen que descargar una app? | No. Compran o reservan desde el navegador del celular y reciben su entrada con QR por correo. |
| ¿Puedo tener dos funciones, en la mañana y en la tarde? | Sí. Cada función tiene su propio cupo y cada familia elige la suya al comprar. |
| ¿Puedo limitar cuántas entradas compra cada familia? | Sí, defines un máximo de entradas por compra para que alcance para todos. *(verificar en backend)* |
| ¿Cómo sé cuántas entradas compró cada curso? | Creas un link por curso y en el panel ves las compras de cada uno, por función. |
| ¿Y si una familia pierde su entrada? | Se la reenvías a su correo desde el panel. En la puerta también se puede buscar por nombre. |
| ¿Cuándo recibo lo recaudado? | Recibes lo recaudado de cada función 48 horas después del evento. |
| ¿Me ayudan con la primera muestra? | Sí. Escríbenos por WhatsApp o agenda una videollamada de 15 minutos y la dejamos lista contigo. |

### 3.9 Cierre
Foto a pantalla completa (grupo de teatro saludando, público aplaudiendo) con overlay tinta 72%. H2 72 px **¿Cuándo es** *la próxima muestra?*; bajada *Créala hoy y comparte el link en el grupo de apoderados. Te ayudamos con la primera.*; CTA lima `Crear mi muestra gratis →` + `Hablar por WhatsApp`.

### 3.10 Mobile
Mismo orden, con estos cambios: hero con foto debajo del CTA y una sola card; comparador con 5 mensajes y 4 filas de lista; pasos apilados; sección de precio en tinta con la calculadora (sin segmented, muestra el caso "paga la familia"); barra flotante tipo pill abajo (`Gratis para muestras gratis · 0% de comisión si cobras` + `Crear muestra`) que aparece después del hero y se oculta en el cierre.

---

## 4. Animaciones

| # | Elemento | Animación |
|---|---|---|
| AC1 | H1, bajada, CTAs | Rise 24 px + fade, stagger 120–150 ms |
| AC2 | Foto del hero | `scale .97→1` + fade, 900 ms |
| AC3 | Cards flotantes | Pop con `--ease-spring` (800 y 1050 ms), luego flotan ±5 px, 2 ciclos |
| AC4 | Secciones | Reveal al 25% de visibilidad, una vez |
| AC5 | Mensajes del chat | Aparecen en secuencia, 260 ms entre cada uno |
| AC6 | Cambio Antes ↔ Ahora | Indicador desliza 260 ms; paneles crossfade 420 ms; filas de la lista con stagger 70 ms |
| AC7 | Cambio automático | A los 2,6 s de ver la sección pasa a "Con AI Tickets", una sola vez |
| AC8 | Barras por curso | `scaleX 0→valor`, 900 ms, stagger 90 ms, al mostrarse el panel "Con AI Tickets" |
| AC9 | Pasos | Reveal con stagger 120 ms |
| AC10 | Fotos | Hover `scale 1.03` |
| AC11 | Calculadora | Montos actualizan en vivo (interpolación opcional) |
| AC12 | Barra mobile | Slide-up 320 ms |

Todo se desactiva con `prefers-reduced-motion` (el comparador queda en "Con AI Tickets" sin animar).

---

## 5. SEO

- Title: *Entradas para muestras y recitales de academias · Gratis o con venta | AI Tickets*.
- Description: venta y reserva de entradas para muestras de fin de año de academias de música, danza y teatro, con QR al celular y control de acceso.
- Palabras clave a cubrir en el texto (sin forzar): muestra de fin de año, recital, academia de música, escuela de danza, entradas para apoderados, reserva de entradas gratis.
- JSON-LD `FAQPage`.

---

## 6. Analítica

Prefijo `ac_`: `ac_view`, `ac_cta_click {position}`, `ac_compare_toggle {to, auto}`, `ac_calc_change {price, payer}`, `ac_faq_open {question}`, `ac_section_view {section}`, `ac_whatsapp_click`.

---

## 7. Componentes

`AcademyHero`, `BeforeAfterCompare` (props: `chat[]`, `dashboard`, `pains{before[], after[]}`, `autoSwitchMs`), `GroupChatMockup` (genérico, sin marcas), `CourseBreakdown`, `StepsCards`, `DoorSection`, `FreeVsPaid` (usa la util de precios compartida), `ForWhoChips`, `Testimonial` (no renderiza sin datos), `FaqAccordion` (compartido), `FloatingCtaPill` (mobile).

---

## 8. Fases

1. **Página base:** tema, hero, comparador sin auto-switch, pasos, puerta, precio, FAQ, cierre, footer.
2. **Interacción:** auto-switch, chat secuencial, barras por curso, calculadora, barra mobile.
3. **Contenido real:** fotos autorizadas, testimonio, ejemplo real de muestra enlazado en "Ver una muestra de ejemplo".

---

## 9. Preguntas abiertas

1. ¿Existe hoy el **máximo de entradas por compra** configurable por evento? Si no, sacar esa FAQ o marcarla `Pronto`.
2. ¿El **check-in permite buscar por nombre**? Si no, cambiar el ítem "¿El abuelo no tiene la entrada…?" por "Entrada en PDF para imprimir" (si existe) o eliminarlo.
3. ¿Se puede **exportar la lista de asistentes por función** desde el panel? (El panel del comparador lo promete.)
4. ¿Hay alguna academia dispuesta a ser **caso de ejemplo** (fotos, testimonio, muestra real enlazada)?
5. ¿Conviene una **oferta especial para academias** (por ejemplo, ayuda para armar la primera muestra o cargo absorbido en la primera)? Es decisión comercial; la página no promete nada que no esté definido.

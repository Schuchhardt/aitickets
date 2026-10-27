# AI Tickets — Rediseño de página de evento y checkout

**Para:** Claude Code (implementación)
**Producto:** aitickets.cl — página pública de evento (`/eventos/[slug]`) y flujo de compra / registro
**Objetivo:** simple pero memorable, en la línea de Luma (eventos gratuitos) y Tesla (contención visual, una decisión por pantalla). Subir conversión vista → entrada emitida.
**Prototipo de referencia:** ver el artifact de diseño "AI Tickets — Evento y checkout" que acompaña este documento. Este documento manda si hay diferencias.

---

## ⚠️ Alcance de esta versión (26-10-2026) — leer antes que todo lo demás

La primera versión de esta spec **ya está implementada** (PR #27 "Rediseño de la página del evento y checkout" y PR #31 "confetti, fondo Iridescence, portada acoplada…"). Esta revisión **no** es un rediseño completo: solo toca dos cosas.

### No tocar (se mantiene exactamente como está en producción)

| Qué | Dónde vive hoy |
|---|---|
| Portada con video (`cover_video`): autoplay sin sonido, botón de sonido, pausa fuera de pantalla, fallback a imagen, poster para listados y correos | `event/AutoplayVideo.vue`, `EventDetail.vue`, `lib/eventPage.ts`, `EventMetaTags.astro` |
| Video de galería (`gallery_video`) | `EventGallery.vue` |
| Fondo animado | `event/IridescenceBg.vue` (+ su selector en `events/EditEventForm.vue`) |
| Los layouts de la página: `banner`, `poster`, `compact` (y la regla compact + video → poster) | `EventDetail.vue` (`layout` computed y estilos `.layout-*`) |
| Tinte del evento, confetti, `reveal.js`, hero, bloque de fecha y lugar de eventos de **una** función | `EventHero.vue`, `confetti.js`, `reveal.js` |
| Flujo gratuito inline, checkout de 1 función, retorno de Webpay | `RsvpForm.vue`, `CheckoutSheet.vue`, `CheckoutStepPay.vue` |

Si un cambio de esta revisión obliga a tocar alguno de estos archivos, el cambio tiene que ser **aditivo** (no alterar el comportamiento actual de los eventos de una función ni de ningún layout) y quedar explicado en el PR. Verificar los 3 layouts × con/sin video × con/sin fondo animado antes de pedir revisión.

### Sí cambia

1. **Eventos con varias funciones** (y/o varios lugares): §4.5 (bloque de fecha cuando hay varias), §4.9b (sección Funciones v2), §6.3 (paso Elegir) y la barra sticky mobile en ese caso. Los eventos de una sola función no deben ver ninguna diferencia.
2. **Cards de acción** (`event/EventActionCard.vue`, y los estados finales de `RsvpForm.vue` solo en lo que dice §4.4b): se actualizan a la versión v2 de §4.4b, que suma lo que la plataforma ganó después de la v1 (asistencia confirmada, reseñas, muro de asistentes, "Mis entradas").

Todo lo demás de este documento queda como referencia histórica de lo ya implementado.


---

## 0. Cómo trabajar con este documento (Claude Code, lee esto primero)

1. **Antes de tocar nada**, ubica en el repo:
   - La página pública del evento (ruta `/eventos/[slug]`) y sus componentes (hero, tabs, card de precio, mapa, FAQ, asistente IA).
   - El modal de compra actual (pasos "1. Entradas → 2. Tus datos → 3. Confirmar").
   - El endpoint / server action que crea la orden y el que inicia el pago con Webpay (Transbank).
   - Cómo se crean hoy las órdenes de precio $0 (eventos gratuitos).
   - Los tokens de diseño existentes (colores, tipografías, radios) — Tailwind config, CSS variables o similar.
2. **No cambies contratos de backend** (tablas, endpoints, webhooks de pago) salvo lo listado explícitamente en §12. Esto es un rediseño de frontend + pequeños ajustes de API.
3. **Trabaja por fases** (§13), cada una como uno o más commits dentro del **PR único del rediseño** (ver `README.md`), con sus criterios de aceptación verificados antes de pasar a la siguiente.
4. **Reutiliza** los tokens y componentes que ya existen. Lo que este documento llama "tokens nuevos" agrégalos al sistema existente, no en archivos sueltos.
5. Si el proyecto ya usa `motion` / `framer-motion`, úsalo para las animaciones. Si no, CSS transitions + `@keyframes` bastan; **no agregues una librería de animación solo por esto** salvo que sea `motion` y el bundle lo justifique.
6. Si una decisión de este documento choca con una restricción real del código (ej. Webpay exige un dato), **respeta la restricción**, implementa lo más cercano y déjalo anotado en el PR.
7. Si existe el skill `impeccable` en el entorno, corre `/impeccable critique` y `/impeccable polish` sobre el resultado de cada fase, pero **dentro** de la dirección de este documento (contención, monocromo, un acento). No introduzcas gradientes, glassmorphism ni grids decorativos.

---

## 1. Diagnóstico (estado actual observado el 13-10-2026)

Página de evento:
- **Íconos invertidos en el hero:** el ícono de *pin/ubicación* aparece junto a la fecha y el de *calendario* junto a la dirección.
- **Hero recorta el póster:** imagen a todo el ancho en franja horizontal; los pósters verticales/cuadrados se cortan (ej. "Concierto de Primavera" pierde la parte superior del título). Luego la misma imagen se repite completa al final de la página.
- **Información triplicada:** fecha en hero + sección "Fecha y hora" + modal. Dirección en hero + "Ubicación" + mapa.
- **Tabs innecesarias** (Descripción / Fecha / Ubicación / Preguntas Frecuentes) en una página corta.
- **CTA no persistente:** la card de precio no es sticky; al hacer scroll desaparece el botón de compra.
- **Botones secundarios compiten:** "Compartir evento" y "Añadir al calendario" tienen casi el mismo peso que "Comprar entrada".
- **No se muestra el organizador.**
- **Precio no final:** "$4.000 + cargo por servicio 8% + IVA"; el total ($4.381) recién aparece dentro del modal.
- **Etiquetas internas expuestas:** "Super Fan", "Fan" en los tipos de entrada.
- **Asistente IA** flotante verde neón compite con el CTA.

Checkout:
- **El evento gratuito usa el mismo flujo de 3 pasos que el pagado** ("Añadir" → "Continuar" → formulario → "Confirmar").
- **Paso 1 obligatorio aunque haya un solo tipo de entrada y una sola función.**
- **Formulario largo:** Nombre, Apellidos, Correo, Confirmar correo, Teléfono, checkbox + bloque legal de ~10 líneas.
- **Código de descuento siempre visible** (incentiva abandonar a buscar cupones).
- **Paso 3 "Confirmar" redundante:** el resumen ya está visible.
- **El modal cambia de alto** entre pasos (layout shift).
- **Tipografía del modal distinta** a la del resto del sitio.

---

## 2. Principios de diseño

1. **El evento es el protagonista; la UI se retira.** El póster y el título hacen el trabajo visual. Interfaz en blanco/negro/grises; el verde lima de marca solo para estados de éxito y foco puntual.
2. **Una decisión por pantalla.** Nunca mostrar una decisión con una sola opción posible: si hay una locación, no se pregunta locación; si hay una función, no se pregunta función; si hay un tipo de entrada, se preselecciona cantidad 1.
3. **El precio que ves es el precio que pagas.** Siempre mostrar el total con cargo incluido; el desglose existe pero colapsado.
4. **Cero pasos de confirmación.** El botón final dice exactamente lo que va a pasar ("Pagar $10.952 con Webpay", "Confirmar asistencia").
5. **Pedir solo lo necesario.** Email + nombre. Todo lo demás es opcional o se infiere.
6. **Movimiento con propósito.** Las animaciones explican cambios de estado (qué apareció, qué se agregó, qué se confirmó). Nada decorativo en loop. Todo respeta `prefers-reduced-motion`.
7. **Mobile primero.** La mayoría del tráfico viene de links en Instagram/WhatsApp (in-app browsers). Diseñar a 375 px y escalar.

---

## 3. Sistema visual

### 3.1 Usa lo existente
- **Tipografías:** mantener la display actual del sitio para títulos y la sans actual para cuerpo. **Unificar el modal/checkout con la misma sans** del sitio (hoy usa otra).
- **Negro de marca** para CTA primario. **Verde lima de marca** solo para: check de éxito, badge "Gratis", foco de inputs y el punto de "en vivo/últimas".

### 3.2 Tokens nuevos o normalizados (agregar al sistema existente)

```css
:root {
  /* Superficies */
  --surface-0: #FFFFFF;          /* fondo página (sobre el tinte) */
  --surface-1: #F6F6F7;          /* cards secundarias, chips inactivos */
  --surface-2: #EDEDEF;          /* hover de chips, skeletons */
  --border: rgba(0,0,0,0.08);
  --border-strong: rgba(0,0,0,0.16);

  /* Texto */
  --text-1: #0A0A0B;             /* títulos, montos */
  --text-2: #5B5B63;             /* secundario */
  --text-3: #8E8E96;             /* terciario, legales */

  /* Marca */
  --brand-ink: #0A0A0B;          /* CTA primario */
  --brand-lime: <usar el verde actual de marca>;
  --danger: #D92D20;
  --warning: #B54708;            /* "Últimas entradas" */

  /* Tinte del evento (se calcula por evento, ver §4.3) */
  --event-tint: 240 10% 96%;     /* HSL, fallback neutro */

  /* Radios */
  --r-sm: 8px;  --r-md: 12px;  --r-lg: 16px;  --r-xl: 24px;  --r-pill: 999px;

  /* Sombras (sutiles, nunca de color) */
  --shadow-card: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06);
  --shadow-sheet: 0 -8px 40px rgba(0,0,0,.12);

  /* Movimiento */
  --ease-out: cubic-bezier(.22, 1, .36, 1);     /* entradas */
  --ease-in-out: cubic-bezier(.65, 0, .35, 1);  /* cambios de estado */
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1); /* micro-rebote, usar poco */
  --dur-1: 120ms;  /* hover, press */
  --dur-2: 200ms;  /* chips, toggles, números */
  --dur-3: 320ms;  /* paneles, sheets */
  --dur-4: 480ms;  /* éxito, entradas de página */
}
```

Modo oscuro: **fuera de alcance** en esta iteración (la página de evento adopta el tinte del póster, que ya da variedad).

### 3.3 Escala tipográfica (página de evento)

| Uso | Desktop | Mobile | Peso |
|---|---|---|---|
| Título del evento | 44/48 | 30/34 | display, bold |
| Fecha grande (día) | 20/24 | 18/22 | sans, semibold |
| Cuerpo | 16/26 | 16/26 | sans, regular |
| Labels / meta | 14/20 | 14/20 | sans, medium |
| Legales / helper | 12/18 | 12/18 | sans, regular, `--text-3` |
| Montos en checkout | 16/20 tabular-nums | igual | sans, semibold |

Todos los montos con `font-variant-numeric: tabular-nums` para que no "bailen" al animar.

### 3.4 Espaciado
Base 4 px. Gutter mobile 16 px. Ancho máximo contenido 1080 px. Gap entre columnas desktop 48 px. Separación entre secciones 56 px desktop / 40 px mobile.

---

## 4. Página de evento (`/eventos/[slug]`)

### 4.1 Layout desktop (≥ 1024 px)

```
┌──────────────────────────────────────────────────────────────────┐
│ header del sitio (logo · Eventos · Para organizadores · Ingresar)│
├──────────────────────────────────────────────────────────────────┤
│  fondo: tinte del póster (§4.3), degradado vertical a blanco     │
│                                                                  │
│  ┌───────────────┐   [Badge: Gratis | Desde $X | Evento privado] │
│  │               │   Título del evento (display, 44px)           │
│  │   PÓSTER      │   ○ Organiza: [avatar] Nombre productora      │
│  │   completo    │                                               │
│  │   4:5 o 1:1   │   [▣ SÁB 8 NOV]  Domingo 8 de noviembre       │
│  │   object-fit: │                 12:00 – 15:00                 │
│  │   contain     │   [⌖]           La Comadre Lola               │
│  │               │                 Manuel A. Matta 1269, Quilicura│
│  └───────────────┘                                               │
│   (col 5/12)        ┌────────────────────────────────┐ (sticky)  │
│                     │ CARD DE ACCIÓN (§4.4)          │           │
│                     └────────────────────────────────┘           │
│                                                                  │
│  Sobre el evento                                                 │
│  descripción…                                                    │
│                                                                  │
│  Ubicación                                                       │
│  [mapa 16:9, radio --r-lg]  Cómo llegar ↗                        │
│                                                                  │
│  Preguntas frecuentes                                            │
│  acordeón                                                        │
│                                                                  │
│  ¿Tienes dudas? Pregúntale al asistente →                        │
│  ───────                                                         │
│  ¿Organizas eventos? Vende con AI Tickets →                      │
└──────────────────────────────────────────────────────────────────┘
```

- Grid de 12 columnas: póster en col 1–5, info + card en col 6–12. La columna derecha es `position: sticky; top: 88px` hasta el fin de la sección superior; **la card de acción queda sticky** mientras el usuario lee la descripción (col derecha continúa sticky hasta el final de "Preguntas frecuentes").
- Póster: `aspect-ratio` del póster real (detectar al subir; fallback 4:5), `object-fit: contain` sobre `--surface-1` si no calza, `border-radius: var(--r-xl)`, `--shadow-card`. **Nunca recortar.**
- **Eliminar**: tabs, sección "Fecha y hora" duplicada (si hay 1 función), imagen repetida al final, ícono de precio, botones "Compartir evento"/"Añadir al calendario" en la card (se mueven, ver §4.5).

### 4.2 Layout mobile (< 768 px)

```
┌─────────────────────┐
│ header compacto     │
│ ┌─────────────────┐ │
│ │ PÓSTER completo │ │  ancho completo menos 16px de gutter
│ └─────────────────┘ │
│ [Badge]             │
│ Título (30px)       │
│ ○ Organiza: Nombre  │
│ ▣ Sáb 8 nov · 12:00 │
│ ⌖ La Comadre Lola   │
│   Quilicura         │
│                     │
│ Sobre el evento     │
│ …                   │
│ Ubicación (mapa)    │
│ Preguntas frec.     │
│                     │
│ (espacio 96px)      │
├─────────────────────┤
│ $4.381   [Comprar]  │  ← barra sticky inferior (§4.6)
└─────────────────────┘
```

- **Eventos gratuitos en mobile**: la card de registro (§5) se muestra **inline**, justo después del bloque de lugar (antes de la descripción), y la barra sticky aparece solo cuando esa card sale del viewport (IntersectionObserver). Tocar la barra hace scroll suave a la card y enfoca el campo Nombre.
- **Eventos pagados en mobile**: la barra sticky está siempre visible; tocar "Comprar" abre el bottom sheet (§6).

### 4.3 Tinte del evento (el "wow" sin esfuerzo del organizador)
- Al subir/actualizar la imagen del evento, **calcular en servidor el color dominante** (o al build/ISR) y guardarlo (ej. `events.theme_color` hex). Si no se quiere migración, calcularlo en el server component al renderizar y cachear.
  - Algoritmo: reducir la imagen a 32×32, cuantizar, tomar el color más frecuente con saturación > 0.15 y luminancia entre 0.15 y 0.85; si ninguno cumple, usar fallback neutro.
- Fondo de la sección superior: `linear-gradient(180deg, hsl(var(--event-tint) / 1) 0%, var(--surface-0) 520px)` donde `--event-tint` es el color dominante llevado a **luminosidad 94–96% y saturación ≤ 30%** (pastel, nunca chillón).
- Opcional (detrás de flag): versión oscura cuando el póster es mayoritariamente oscuro (luminancia media < 0.25): tinte a L 12%, texto blanco. Solo si el contraste AA se cumple.

### 4.4 Card de acción — contenido por estado

Card: fondo `--surface-0`, borde `--border`, radio `--r-lg`, padding 20 px, `--shadow-card`, ancho 100% de la columna (máx 420 px).

| Estado | Badge sobre título | Contenido de la card | CTA |
|---|---|---|---|
| Gratis, cupos disponibles | `Gratis` (lima) | Formulario inline de registro (§5) | `Confirmar asistencia` |
| Gratis, pocos cupos (≤ 15% o ≤ 10) | `Gratis` + `Quedan N cupos` | ídem | ídem |
| Gratis, lleno | `Gratis` | "Se llenaron los cupos." + formulario de lista de espera (email) | `Avisarme si se libera un cupo` |
| Gratis, requiere aprobación (si existe en backend) | `Gratis · Con aprobación` | Formulario | `Solicitar entrada` |
| Pagado, 1 función, 1 tipo de entrada | `$4.381` | Precio final + stepper de cantidad inline | `Comprar entrada` / `Comprar 2 entradas` |
| Pagado, varias funciones o tipos | `Desde $4.381` | Resumen: "3 funciones · 2 lugares" + próxima función | `Elegir entradas` |
| Pagado, últimas entradas | badge `Últimas entradas` (warning) | ídem | ídem |
| Venta aún no abre | `Venta abre el 20 oct, 10:00` | Contador si faltan < 24 h | `Avisarme cuando abra` (email) |
| Agotado | `Agotado` | "Se vendieron todas las entradas." | `Avisarme si se liberan` |
| Evento terminado | `Evento finalizado` | "Este evento ya ocurrió." + link a otros eventos del organizador | — |
| Evento de demostración | banner superior existente se mantiene, más discreto (§8) | normal | normal |

Debajo de la card (fuera de ella), fila de acciones secundarias en texto (no botones con borde):
`↗ Compartir` · `+ Añadir al calendario`  — tamaño 14 px, `--text-2`, hover `--text-1`.


### 4.4b Card de acción v2 (lo que se implementa en esta revisión)

Mismo contenedor, mismo lugar en la página y misma jerarquía que la v1: **estado → contexto → una sola acción principal**. Se mantiene todo lo que hoy funciona en `EventActionCard.vue` (stepper de 1 función, contador de venta, `NotifyForm`, `EventTrust`). Cambios:

**a) Rótulo de estado unificado.** Cada estado abre con una línea de rótulo en 12 px, peso 600, mayúsculas con `letter-spacing .06em`, color según tono: neutro `--text-2`, positivo `--success-text`, alerta `--warning-text`. Reemplaza las variantes sueltas de hoy (`.meta`, `.few-line`, `.headline`). Ej.: `GRATIS`, `GRATIS · QUEDAN 8 CUPOS`, `ÚLTIMAS ENTRADAS`, `AGOTADO`, `EVENTO FINALIZADO`, `VENTA ABRE EL 20 OCT, 10:00`.

**b) Tabla de estados v2**

| Estado | Rótulo | Contenido | Acción principal | Secundario |
|---|---|---|---|---|
| Gratis, cupos | `GRATIS` (o `GRATIS · QUEDAN N CUPOS`) | Formulario inline (sin cambios) | `Confirmar asistencia` | — |
| Gratis, **ya confirmado en este navegador** (hay orden gratis guardada) | `ASISTENCIA CONFIRMADA` (positivo) | "Te esperamos el sábado 8, 20:00." + email enmascarado | `Ver mi entrada` | `Añadir al calendario` · `Ver quiénes van →` |
| Gratis, ya inscrito (email repetido) | `YA ESTÁS INSCRITO` | igual que hoy | `Reenviar entrada` | — |
| Gratis, lleno / en lista de espera | `GRATIS · CUPOS LLENOS` | igual que hoy | `Avisarme si se libera un cupo` | — |
| Pagado, 1 función, 1 tipo | precio grande | igual que hoy (stepper + total animado) | `Comprar entrada` / `Comprar N entradas · $X` | — |
| **Pagado, varias funciones** | `N FUNCIONES · M LUGARES` | `Desde $X` + **hasta 3 chips de próximas funciones** (ver c) | `Elegir entradas` | `Ver todas las funciones ↓` (scroll a §4.9b) |
| Pagado, varios tipos y 1 función | `Desde $X` | Resumen de tipos (igual que hoy) | `Elegir entradas` | — |
| Pagado, últimas entradas | `ÚLTIMAS ENTRADAS` (alerta) | ídem estado correspondiente | ídem | — |
| **Ya compró en este navegador** (`ordersCount > 0`, pagado) | se mantiene el estado de venta | + franja inferior dentro de la card: "Tienes N entradas" | (la del estado) | `Ver mis entradas` · `Ver quiénes van →` |
| Venta aún no abre | `VENTA ABRE EL …` | contador < 24 h (igual) | `Avisarme cuando abra` | — |
| Agotado | `AGOTADO` | igual | `Avisarme si se liberan` | — |
| **Evento finalizado** | `EVENTO FINALIZADO` | Si hay reseñas: promedio `4,8 ★` + "86 reseñas" (de `EventReviews`/su endpoint). Si no: "Este evento ya ocurrió." | `★ ¿Fuiste? Califica el evento` (igual que hoy) | `Ver próximos eventos de {organizador} →` |
| Vista previa / venta cerrada | igual que hoy | | | |

**c) Chips de próximas funciones (solo varias funciones).**
- Hasta 3 chips con las próximas funciones disponibles: `Vie 24 · 21:00` en una línea y, si hay varios lugares, el lugar en 12 px debajo. Agotadas no aparecen; con estado "últimas" llevan un punto `--warning`.
- Click en un chip → abre el checkout en el paso 1 con esa función preseleccionada (mismo mecanismo de URL que hoy: `?checkout=1&funcion=<id>`), evento `event_card_function_chip {function_id, position}`.
- Si quedan más: texto `+ 4 funciones` que hace scroll a la sección Funciones.
- Mobile: los chips van en una fila con scroll horizontal y `scroll-snap`.

**d) "Ver quiénes van".** El muro (`AttendeeFeed.vue`) hoy vive en la página de la orden y de la entrada, y solo lo ve quien tiene entrada. El link de la card lleva a esa vista (orden más reciente de este navegador). **No** se muestra el muro en la página pública. Opcional, solo si el endpoint ya entrega agregados sin datos personales: mostrar en la card la fila de conteos por emoji (`🔥 38 · 🎉 25`) sin nombres ni mensajes. Si no existe ese agregado, se omite (ver §15).

**e) Animaciones.** Cambio entre estados con el `AutoHeight` + crossfade que ya existe (A-series de §10). Los chips entran con stagger de 40 ms; el rótulo `ASISTENCIA CONFIRMADA` aparece con el `SuccessCheck` existente. Todo respeta `prefers-reduced-motion`.

**f) Aceptación.**
- [ ] Cada fila de la tabla tiene un test (unit o e2e) que monta la card en ese estado.
- [ ] Eventos de una función: la card se ve igual que hoy salvo el rótulo unificado.
- [ ] Ningún estado muestra datos de otros asistentes en la página pública.

### 4.5 Bloque de fecha y lugar
- Fecha: "mini-calendario" 48×48 px (mes en 11 px mayúsculas arriba, día en 20 px abajo) + a la derecha "Domingo 8 de noviembre" y debajo "12:00 – 15:00".
- Varias funciones: mini-calendario de la próxima + "Domingo 8 de noviembre" + debajo `y 4 funciones más →` (abre el selector).
- Lugar: ícono **pin** (correcto, no calendario) + nombre del lugar en `--text-1` + dirección en `--text-2`. Click en el bloque → hace scroll a "Ubicación".
- Varias locaciones: "2 lugares · Providencia y Ñuñoa".
- Fechas: formato `es-CL`, día de semana con mayúscula inicial, sin "De" con mayúscula (hoy muestra "Dom, 8 De Noviembre" → debe ser "Domingo 8 de noviembre").
- Hora: "12:00 – 15:00" (guion largo con espacios finos). Si no hay hora de término: "Desde las 20:00".

### 4.6 Barra sticky inferior (mobile)
- Altura 72 px + `env(safe-area-inset-bottom)`. Fondo blanco 92% + `backdrop-filter: blur(12px)`, borde superior `--border`.
- Izquierda: monto final (`$4.381` o `Desde $4.381` o `Gratis`) y debajo en 12 px "por entrada, incluye cargo" (pagado) / "Quedan 8 cupos" (si aplica).
- Derecha: botón primario 48 px de alto, ancho mínimo 160 px.
- Aparece con slide-up (§10) la primera vez que el usuario hace scroll más allá del bloque de lugar (pagado) o cuando la card inline sale de pantalla (gratis).

### 4.7 Organizador
- Fila "Organiza" con avatar 24 px circular (logo de la productora o inicial sobre `--surface-2`) y nombre. Link a la web de eventos del organizador si existe.
- Si el backend no expone nombre público del organizador, usar el nombre de la organización. Si no hay nada, ocultar la fila (no mostrar placeholder).

### 4.8 Descripción, mapa y FAQ
- "Sobre el evento": HTML del organizador sanitizado, máx 68 caracteres por línea. Si supera 600 caracteres, colapsar con fade y botón `Leer más` (expande con animación de altura).
- "Ubicación": mapa estático (imagen) en vez de iframe interactivo para performance; botón `Cómo llegar ↗` que abre Google Maps / Apple Maps (detectar iOS). Lazy-load.
- "Preguntas frecuentes": acordeón sin numeración ("1.", "2." fuera), chevron que rota 180°, borde inferior por ítem.
- Asistente IA: **quitar el botón flotante verde**. Reemplazar por una línea al final de FAQ: `¿No encuentras lo que buscas? Pregúntale al asistente →` que abre el mismo chat existente. En mobile, también accesible desde un ícono discreto (monocromo, 40 px) en la esquina superior derecha del header de la página de evento.
- Categorías: chips pequeños al final, `--surface-1`, sin título "Categorías y temáticas del evento".

### 4.9 Varias funciones en la página
Si el evento tiene > 1 función, agregar sección "Funciones" después de "Sobre el evento", con la lista agrupada por lugar:

```
Funciones
Providencia · Sala Agustín Siré
  Vie 24 oct · 21:00            Disponible        [Elegir]
  Sáb 25 oct · 21:00            Últimas           [Elegir]
Ñuñoa · Teatro Ñuñoa
  Sáb 1 nov · 20:00             Agotada
```
"Elegir" abre el checkout con esa función preseleccionada (`?funcion=<id>`).


### 4.9b Funciones v2 (lo que se implementa en esta revisión)

La sección "Funciones" ya existe (`EventSections.vue`). Mejoras, solo para eventos con más de una función:
- **Agrupación:** por lugar si hay > 1 lugar (encabezado `Providencia · Sala Agustín Siré` + dirección en 13 px); dentro, por mes si hay > 8 funciones.
- **Fila:** fecha y hora a la izquierda (`Vie 24 oct · 21:00`), estado al centro (`Disponible` neutro / `Últimas` alerta / `Agotada` atenuada y tachada) y desde-precio de esa función si difiere del general. Botón `Elegir` (secundario, 36 px) que abre el checkout con la función preseleccionada. Toda la fila es clickeable; la agotada no.
- **Larga lista:** se muestran las 6 próximas y `Ver las N funciones` expande con animación de altura (`AutoHeight`).
- **Bloque de fecha del hero (§4.5) con varias funciones:** mantiene el diseño actual de `EventHero.vue`; solo verificar que `y N funciones más →` haga scroll a esta sección (no abre el checkout).
- **Barra sticky mobile con varias funciones:** `Desde $X` + "N funciones" en 12 px; botón `Elegir entradas`.
- **Paso Elegir (§6.3):** si se llega con `funcion=<id>`, el lugar y la función quedan preseleccionados y el foco va a la primera fila de entradas. Si la función preseleccionada se agotó entre medio: aviso inline "Esa función se agotó, elige otra" y se queda en el selector.

---

## 5. Flujo GRATUITO (registro inline, estilo Luma)

**No hay modal ni pasos.** Todo ocurre dentro de la card de acción.

### 5.1 Estado inicial
```
┌───────────────────────────────────┐
│ Gratis · Quedan 12 cupos          │  (meta, 14px)
│                                   │
│ [chips de tipo de entrada]        │  ← SOLO si hay > 1 tipo gratuito
│                                   │
│ Nombre y apellido                 │
│ [                               ] │
│ Email                             │
│ [                               ] │
│ ¿Quisiste decir gmail.com?        │  ← solo si aplica (§5.3)
│                                   │
│ [   Confirmar asistencia   ]      │  (negro, 48px, ancho completo)
│                                   │
│ Al confirmar aceptas los Términos │  (12px, --text-3, links subrayados)
│ y la Política de privacidad.      │
└───────────────────────────────────┘
```
- **Campos:** "Nombre y apellido" (un solo campo, `autocomplete="name"`) y "Email" (`type="email"`, `autocomplete="email"`, `inputmode="email"`).
- **Se eliminan:** Apellidos (separado), Confirmar correo, Teléfono, checkbox de términos, bloque legal largo.
- **Cantidad:** 1 por defecto. Si el organizador permite más de 1 entrada por persona, mostrar debajo del email un link `+ Llevo acompañantes` que revela un stepper (máx el límite configurado). El CTA pasa a `Confirmar 3 asistencias`.
- **Backend:** el nombre se divide en servidor: primer token → `first_name`, resto → `last_name` (vacío permitido; si la columna es NOT NULL, guardar `""`). Reutilizar el mismo endpoint de creación de orden con total $0 (sin pasar por Webpay).
- **Usuario ya identificado** (cookie de sesión de comprador o email recordado en `localStorage`, envuelto en try/catch): prellenar campos y mostrar "Confirmando como **Seba** (seba@…) · Cambiar". CTA directo.

### 5.2 Validación
- Validar **al salir del campo** (blur) y al enviar, nunca mientras escribe.
- Nombre: mínimo 2 caracteres. Error: "Escribe tu nombre."
- Email: formato válido. Error: "Revisa tu email, parece incompleto."
- Error de campo: borde `--danger`, mensaje 13 px debajo, animación shake (§10). Foco automático al primer campo con error.

### 5.3 Sugerencia de typo de email
Dominios: `gmail.com, hotmail.com, outlook.com, yahoo.com, icloud.com, live.cl, hotmail.cl, yahoo.es, me.com, uc.cl, uchile.cl`. Si el dominio ingresado está a distancia de Levenshtein ≤ 2 de uno de la lista (y no es igual), mostrar:
`¿Quisiste decir seba@gmail.com?` — el dominio sugerido es un botón; al tocarlo reemplaza el valor y la sugerencia desaparece con fade. Esto reemplaza "Confirmar correo".

### 5.4 Enviando
- Botón: texto se reemplaza por spinner de 16 px + "Confirmando…", ancho fijo (sin layout shift), deshabilitado.
- Inputs: `readonly`, opacidad 0.6.
- Timeout 15 s → error genérico (§5.7).

### 5.5 Éxito (misma card, sin recargar)
```
┌───────────────────────────────────┐
│         (✓ check lima animado)    │
│      ¡Listo, Seba! Estás dentro.  │  (20px semibold)
│  Te enviamos tu entrada con QR a  │
│  seba@gmail.com                   │
│                                   │
│  [ + Añadir al calendario ]       │  (botón secundario, borde)
│  [ ↗ Invitar a alguien    ]       │  (Web Share API; fallback copiar link)
│                                   │
│  Ver mi entrada →                 │  (link al ticket/QR si existe ruta)
└───────────────────────────────────┘
```
- La card cambia de contenido con crossfade + ajuste de altura animado (§10).
- Confetti: **no**. El check animado basta.
- Si el usuario recarga: si la sesión/`localStorage` indica que ya está registrado a este evento, mostrar directamente el estado de éxito con "Ya confirmaste tu asistencia."

### 5.6 Ya registrado (email repetido)
Si el backend responde que ese email ya tiene entrada para el evento:
"Ya estás inscrito con este email. Te reenviamos la entrada." + botón `Reenviar entrada` (llama al endpoint existente de reenvío). No es un error rojo; es un estado informativo neutro.

### 5.7 Errores
| Caso | Copy |
|---|---|
| Sin conexión / timeout | "No pudimos confirmar. Revisa tu conexión e inténtalo de nuevo." + `Reintentar` |
| Cupos agotados mientras llenaba | "Justo se acabaron los cupos. ¿Te avisamos si se libera uno?" → pasa al estado lista de espera con el email prellenado |
| Error servidor | "Algo falló de nuestro lado. Inténtalo en unos segundos." |

### 5.8 Lista de espera (si no existe en backend, ver §12)
Solo email. CTA `Avisarme si se libera un cupo`. Éxito: "Listo. Te escribimos a seba@gmail.com si se libera un cupo."

---

## 6. Flujo PAGADO (2 pasos: Elegir → Pagar)

### 6.1 Contenedor
- **Desktop:** *sheet lateral derecho* de 480 px de ancho, alto completo, sobre overlay negro 40%. Cierra con Esc, click en overlay o botón ×. La página detrás no hace scroll (`overflow: hidden` en body; compensar ancho de scrollbar).
- **Mobile:** *bottom sheet* que ocupa 92dvh, con handle de arrastre (barra 36×4 px) y esquinas superiores `--r-xl`. Se puede cerrar arrastrando hacia abajo > 120 px o con ×.
- **Alto fijo** del contenedor: el contenido hace scroll interno; header del sheet y footer con CTA son fijos. **Cero layout shift entre pasos.**
- Header del sheet: miniatura del póster 40×40 + nombre del evento (1 línea, ellipsis) + indicador de paso discreto: dos segmentos de 24×3 px (activo negro, inactivo `--surface-2`). **Eliminar** el breadcrumb "1. Entradas → 2. Tus datos → 3. Confirmar".
- Footer fijo: a la izquierda total final + "Ver detalle" (colapsable); a la derecha CTA primario.
- **Estado en la URL** (para back button y deep links): `?checkout=1&funcion=679&entradas=82:2,83:1`. El botón "atrás" del navegador vuelve del paso 2 al 1 y del 1 cierra el sheet.

### 6.2 Atajo para eventos simples (1 función, 1 tipo de entrada)
La card de acción ya muestra el stepper de cantidad. `Comprar entrada` abre el sheet **directo en el paso 2 (Pagar)**. El paso 1 no existe para este caso.

### 6.3 Paso 1 — Elegir

Orden de las decisiones, **cada nivel se omite si tiene una sola opción**:

**a) Lugar** (solo si las funciones abarcan > 1 lugar)
```
Lugar
( Providencia )  ( Ñuñoa )
```
Chips tipo pill, 40 px de alto. Seleccionado: fondo negro, texto blanco. Debajo del chip seleccionado, dirección en 13 px `--text-2`.

**b) Función** (solo si el lugar elegido tiene > 1 función)
```
Fecha y hora
┌──────────┐ ┌──────────┐ ┌──────────┐
│ VIE 24   │ │ SÁB 25   │ │ SÁB 25   │
│ OCT      │ │ OCT      │ │ OCT      │
│ 21:00    │ │ 21:00    │ │ 23:00    │
│          │ │ Últimas  │ │          │
└──────────┘ └──────────┘ └──────────┘
```
- Tiles de 88×88 px en carrusel horizontal con scroll-snap (mobile) / grid de 4 columnas (desktop). Si hay > 8 funciones en el mismo lugar, agrupar por mes con encabezado.
- Estados del tile: disponible / seleccionado (borde 2 px negro + fondo `--surface-1`) / "Últimas" (texto warning) / "Agotada" (opacidad 0.4, tachado, no clickeable, `aria-disabled`).
- Si solo queda una función disponible, preseleccionarla.

**c) Entradas** (siempre visible una vez definida la función)
```
Entradas
General                              $10.952
Acceso general · sin asiento numerado      [ − ] 1 [ + ]
───────────────────────────────────────────
VIP                                  $32.856
Ubicación preferente + 1 trago             [ − ] 0 [ + ]
───────────────────────────────────────────
Preventa · termina en 2 días         $7.666
                                           [ − ] 0 [ + ]
```
- Precio mostrado = **precio final con cargo e IVA del cargo incluidos**. Fórmula: `final = precio + round(precio × 0.08) + round(round(precio × 0.08) × 0.19)` — **usar la misma función de cálculo que hoy usa el resumen del checkout** (backend o util compartido). No duplicar la fórmula en el cliente si ya existe.
- Descripción del tipo de entrada en 13 px `--text-2` (si el organizador la definió). **No mostrar** las etiquetas internas "Fan"/"Super Fan".
- Stepper: botones de 36×36 px, número en tabular-nums. `−` deshabilitado en 0; `+` deshabilitado al llegar al máximo (stock o límite por orden), con tooltip "Máximo 10 por compra".
- Si hay un solo tipo de entrada disponible, preseleccionar 1.
- Tipos con `on_sale_now = false` y fecha de inicio futura: fila atenuada con "Disponible desde el 1 nov".
- Tipos agotados: fila atenuada con "Agotada".
- Tipos amarrados a una función (`event_date_id`) solo aparecen con esa función.
- Footer: `Total $21.904` · CTA `Continuar` (deshabilitado si total de entradas = 0; con 0 entradas el texto del footer dice "Elige al menos una entrada").

**Reserva temporal (si el backend ya reserva con `reserved_in_checkout`):** al pasar al paso 2 se reservan las entradas. Mostrar timer **solo si quedan ≤ 20 entradas del tipo elegido**: "Guardamos tus entradas por 9:58" en 13 px `--text-2` bajo el header. A los 60 s restantes pasa a `--warning`. Al expirar: "Se liberaron tus entradas. Vuelve a elegirlas." y regresa al paso 1 manteniendo selección si hay stock.

### 6.4 Paso 2 — Pagar
```
← Volver                                    (solo si existió paso 1)

Resumen                                     (colapsado en mobile, abierto en desktop)
Sáb 25 oct · 21:00 · Sala Agustín Siré
2 × General                         $21.904
                               Ver detalle ⌄

Tus datos
Nombre y apellido
[                                    ]
Email
[                                    ]
Te enviaremos las entradas a este email.
¿Quisiste decir gmail.com?                  (si aplica)

¿Tienes un código de descuento?             (link; expande input + "Aplicar")

[✓] Entiendo que las entradas no tienen derecho a retracto.  Ver condiciones

─── footer fijo ───
Total $21.904            [ Pagar $21.904 con Webpay ]
```

- **Campos:** Nombre y apellido (uno), Email. **Eliminar** Apellidos separado, Confirmar correo. **Teléfono:** eliminar del flujo por defecto; si el organizador lo marcó obligatorio (si existe esa config) mostrarlo con `autocomplete="tel"`, `inputmode="tel"`, máscara `+56 9 XXXX XXXX`.
- **Checkbox de no retracto:** se mantiene (requisito legal en compras pagadas; validar redacción con asesoría legal). Una sola línea + link `Ver condiciones` que abre el texto completo actual en un popover/acordeón. El checkbox **no** está premarcado. Si el usuario aprieta pagar sin marcarlo: el checkbox hace shake + mensaje "Marca esta casilla para continuar."
- **Código de descuento:** colapsado. Si la URL trae `?code=XYZ`, aplicarlo automáticamente al abrir el paso 2 y mostrar "Código XYZ aplicado · −$1.500" en verde con opción `Quitar`. Errores de código: "Este código no existe o ya venció." inline bajo el input.
- **Ver detalle** (desglose, colapsable): Subtotal entradas, Cargo por servicio (8%), IVA del cargo (19%), Descuento, Total. Los números ya existen en el resumen actual: reutilizar.
- **CTA:** `Pagar $21.904 con Webpay`. Al tocar: estado cargando "Redirigiendo a Webpay…" y luego redirect al flujo actual de Transbank. **Se elimina el paso "Confirmar".**
- Debajo del CTA (12 px, `--text-3`): "Pago seguro con Webpay · Tarjetas de crédito, débito y prepago".

### 6.5 Retorno de Webpay
**Éxito** (página de orden existente, rediseñada con la misma estética):
- Check animado + "¡Listo, Seba! Tienes 2 entradas para Stand-up de Viernes."
- "Te las enviamos a seba@gmail.com. También puedes verlas aquí:" + QR(s) en cards.
- Acciones: `+ Añadir al calendario`, `↗ Compartir el evento`.
- Datos: función, lugar con link a mapa, número de orden en `--text-3`.

**Rechazo / cancelado:**
- "El pago no se completó. No se hizo ningún cobro." (si Transbank confirma rechazo/anulación).
- CTA `Intentar de nuevo` → vuelve al paso 2 con datos prellenados y selección intacta (si la reserva sigue vigente; si no, al paso 1).

---

## 7. Deep links y tracking

| Parámetro | Efecto |
|---|---|
| `?funcion=<id>` | Preselecciona función (y su lugar). Si la función está agotada, muestra el paso 1 con un aviso "Esa función se agotó. Elige otra:" |
| `?entrada=<ticket_type_id>` | Preselecciona 1 unidad de ese tipo |
| `?code=<CODIGO>` | Aplica el código en paso 2 automáticamente |
| `?checkout=1` | Abre el sheet directo al cargar |
| `utm_*` | Se preservan durante todo el flujo y se envían con la orden (mantener lo que ya hace hoy) |

Los links de seguimiento y posts generados por IA (MCP `create_tracking_link`, `create_social_post`) deberían poder incluir `funcion` y `code`. **Fuera de alcance de este PR** salvo que sea trivial; dejar anotado.

---

## 8. Copy completo (es-CL, tuteo, sin exclamaciones excesivas)

### Página de evento
| Clave | Texto |
|---|---|
| badge.free | Gratis |
| badge.from | Desde {precio} |
| badge.price | {precio} |
| badge.few_left | Quedan {n} cupos / Últimas entradas |
| badge.private | Evento privado |
| badge.sold_out | Agotado |
| badge.ended | Evento finalizado |
| badge.sale_opens | Venta abre el {fecha}, {hora} |
| organizer.label | Organiza |
| date.more_functions | y {n} funciones más |
| place.multiple | {n} lugares · {lugar1} y {lugar2} |
| section.about | Sobre el evento |
| section.functions | Funciones |
| section.location | Ubicación |
| section.faq | Preguntas frecuentes |
| location.directions | Cómo llegar |
| about.read_more | Leer más / Leer menos |
| assistant.cta | ¿No encuentras lo que buscas? Pregúntale al asistente |
| share | Compartir |
| calendar | Añadir al calendario |
| sticky.price_note | por entrada, incluye cargo |
| demo.banner | Evento de demostración: puedes recorrer el flujo completo, no se cobra nada. |
| footer.organizers | ¿Organizas eventos? Vende con AI Tickets |

### Gratuito
| Clave | Texto |
|---|---|
| rsvp.name | Nombre y apellido |
| rsvp.email | Email |
| rsvp.add_guests | + Llevo acompañantes |
| rsvp.cta | Confirmar asistencia |
| rsvp.cta_plural | Confirmar {n} asistencias |
| rsvp.cta_approval | Solicitar entrada |
| rsvp.loading | Confirmando… |
| rsvp.legal | Al confirmar aceptas los Términos y la Política de privacidad. |
| rsvp.success_title | ¡Listo, {nombre}! Estás dentro. |
| rsvp.success_body | Te enviamos tu entrada con QR a {email} |
| rsvp.success_approval | Recibimos tu solicitud. Te avisamos a {email} cuando el organizador la apruebe. |
| rsvp.invite | Invitar a alguien |
| rsvp.view_ticket | Ver mi entrada |
| rsvp.already | Ya estás inscrito con este email. |
| rsvp.resend | Reenviar entrada |
| rsvp.resent | Listo, revisa tu correo. |
| rsvp.full | Se llenaron los cupos. |
| rsvp.waitlist_cta | Avisarme si se libera un cupo |
| rsvp.waitlist_ok | Listo. Te escribimos a {email} si se libera un cupo. |
| rsvp.remembered | Confirmando como {nombre} ({email}) · Cambiar |

### Pagado
| Clave | Texto |
|---|---|
| checkout.cta_open_simple | Comprar entrada / Comprar {n} entradas |
| checkout.cta_open_multi | Elegir entradas |
| checkout.place | Lugar |
| checkout.function | Fecha y hora |
| checkout.tickets | Entradas |
| checkout.few_left | Últimas |
| checkout.sold_out | Agotada |
| checkout.available_from | Disponible desde el {fecha} |
| checkout.max_per_order | Máximo {n} por compra |
| checkout.empty | Elige al menos una entrada |
| checkout.continue | Continuar |
| checkout.back | Volver |
| checkout.summary | Resumen |
| checkout.details | Ver detalle |
| checkout.subtotal | Entradas |
| checkout.fee | Cargo por servicio (8%) |
| checkout.fee_vat | IVA del cargo (19%) |
| checkout.discount | Descuento |
| checkout.total | Total |
| checkout.your_data | Tus datos |
| checkout.email_help | Te enviaremos las entradas a este email. |
| checkout.has_code | ¿Tienes un código de descuento? |
| checkout.apply | Aplicar |
| checkout.code_applied | Código {code} aplicado · −{monto} |
| checkout.code_remove | Quitar |
| checkout.code_error | Este código no existe o ya venció. |
| checkout.withdrawal | Entiendo que las entradas no tienen derecho a retracto. |
| checkout.withdrawal_link | Ver condiciones |
| checkout.withdrawal_error | Marca esta casilla para continuar. |
| checkout.pay | Pagar {total} con Webpay |
| checkout.redirecting | Redirigiendo a Webpay… |
| checkout.secure | Pago seguro con Webpay · Tarjetas de crédito, débito y prepago |
| checkout.hold | Guardamos tus entradas por {mm:ss} |
| checkout.hold_expired | Se liberaron tus entradas. Vuelve a elegirlas. |
| checkout.function_sold_out_link | Esa función se agotó. Elige otra: |
| order.success_title | ¡Listo, {nombre}! Tienes {n} entrada(s) para {evento}. |
| order.success_body | Te las enviamos a {email}. También puedes verlas aquí: |
| order.failed | El pago no se completó. No se hizo ningún cobro. |
| order.retry | Intentar de nuevo |

### Errores generales
| Clave | Texto |
|---|---|
| error.name | Escribe tu nombre. |
| error.email | Revisa tu email, parece incompleto. |
| error.network | No pudimos conectar. Revisa tu conexión e inténtalo de nuevo. |
| error.server | Algo falló de nuestro lado. Inténtalo en unos segundos. |
| error.retry | Reintentar |
| email.suggest | ¿Quisiste decir {email_sugerido}? |

Reglas de copy:
- Montos: `$10.952` (punto de miles, sin decimales, sin "CLP" en la UI; "CLP" solo en el desglose si se quiere ser explícito).
- Fechas: "Sábado 25 de octubre" en títulos; "Sáb 25 oct" en tiles y resúmenes.
- Nunca "Click aquí". Verbos concretos en CTA.
- Sin mayúsculas sostenidas salvo el mes en el mini-calendario y tiles.

---

## 9. Componentes a crear/refactorizar

| Componente | Responsabilidad |
|---|---|
| `EventHero` | Póster + título + organizador + fecha + lugar + tinte |
| `EventActionCard` | Decide el estado (§4.4) y renderiza `RsvpForm` o resumen/stepper pagado |
| `RsvpForm` | Flujo gratuito completo (§5), máquina de estados: `idle → submitting → success | already | error | waitlist` |
| `CheckoutSheet` | Contenedor drawer/bottom sheet, focus trap, URL state |
| `CheckoutStepChoose` | Lugar → función → entradas |
| `CheckoutStepPay` | Datos, código, retracto, pagar |
| `FunctionTile`, `PlaceChip`, `TicketRow`, `QuantityStepper` | Piezas reutilizables |
| `AnimatedNumber` | Transición de montos (§10) |
| `MobileStickyBar` | Barra inferior |
| `EmailSuggest` | Hook `useEmailSuggestion(email)` |
| `SuccessCheck` | SVG animado del check |

Reglas: componentes de presentación sin fetch; la lógica de precios y disponibilidad vive en un único módulo (`lib/pricing` o el existente).

---

## 10. Animaciones (detalle)

Todas usan los tokens de §3.2. **Todas** se desactivan o reducen a fade de 1 frame con `@media (prefers-reduced-motion: reduce)` / `useReducedMotion()`. Solo animar `transform` y `opacity` (y `height` vía técnica de grid-rows o `motion` layout), nunca `top/left/width`.

| # | Elemento | Disparador | Animación | Duración / easing |
|---|---|---|---|---|
| A1 | Póster | Carga de página | `opacity 0→1`, `scale .98→1` | `--dur-4` `--ease-out` |
| A2 | Título, organizador, fecha, lugar | Carga | Stagger: `opacity 0→1`, `translateY 8px→0`, 40 ms entre ítems | `--dur-3` `--ease-out` |
| A3 | Card de acción | Carga | `translateY 12px→0`, `opacity`, delay 160 ms | `--dur-3` `--ease-out` |
| A4 | Tinte de fondo | Carga | `opacity 0→1` del gradiente | 600 ms ease |
| A5 | Botón primario | Hover | fondo negro → `#222`; `translateY -1px` | `--dur-1` |
| A6 | Botón primario | Press | `scale .98` | 80 ms |
| A7 | Chip / tile | Selección | fondo y borde con transición; `scale .96 → 1` con `--ease-spring` | `--dur-2` |
| A8 | Stepper | +/− | El número sale hacia arriba y entra el nuevo desde abajo (`translateY ±60%` + opacity) | `--dur-2` `--ease-out` |
| A9 | Totales (`AnimatedNumber`) | Cambio de monto | Interpolar el valor numérico (count) | 300 ms `--ease-out`, tabular-nums |
| A10 | Fila de entrada | Entra al seleccionar función | Stagger 30 ms, `opacity` + `translateY 6px` | `--dur-2` |
| A11 | Sheet desktop | Abrir / cerrar | `translateX 100%→0` + overlay `opacity 0→.4` | abrir `--dur-3` `--ease-out`; cerrar 240 ms `--ease-in-out` |
| A12 | Bottom sheet mobile | Abrir / cerrar / arrastre | `translateY 100%→0`; el arrastre sigue el dedo; soltar > 120 px o velocidad > 500 px/s cierra | `--dur-3` |
| A13 | Cambio de paso 1↔2 | Continuar / Volver | Paso saliente `translateX 0→-24px` + fade out; entrante `24px→0` + fade in (inverso al volver). Altura del contenedor fija | `--dur-3` `--ease-in-out` |
| A14 | Indicador de paso | Cambio | El segmento activo rellena de izq. a der. (`scaleX 0→1`, origin left) | `--dur-3` |
| A15 | Campo con error | Validación | Shake horizontal `0, -6, 6, -4, 4, 0 px` | 280 ms |
| A16 | Mensaje de error/sugerencia | Aparece | Altura 0→auto + fade | `--dur-2` |
| A17 | Botón enviando | Submit | Crossfade texto → spinner manteniendo ancho | `--dur-2` |
| A18 | Card gratuita → éxito | Respuesta OK | Contenido viejo fade out (150 ms) → altura se ajusta (`--dur-3`) → contenido nuevo fade + `translateY 8px→0` | total ~500 ms |
| A19 | Check de éxito | Estado éxito | Círculo lima `scale 0→1` (`--ease-spring`, 320 ms), luego trazo del check con `stroke-dashoffset` (240 ms, delay 160 ms) | — |
| A20 | Barra sticky mobile | Primera aparición | `translateY 100%→0` | `--dur-3` `--ease-out` |
| A21 | FAQ | Abrir / cerrar | Altura con grid-rows `0fr→1fr`, chevron `rotate 0→180°` | `--dur-2` |
| A22 | "Leer más" | Expandir | Altura + quitar fade del borde inferior | `--dur-3` |
| A23 | Badge "Últimas / Quedan N" | Carga | Punto de 6 px con pulso suave (`scale 1→1.6`, opacity 0.6→0) **máximo 3 iteraciones**, luego estático | 1.2 s c/u |
| A24 | Código aplicado | Éxito | Fila de descuento entra con altura + total anima (A9) | `--dur-2` |
| A25 | Skeletons | Carga de disponibilidad | Shimmer lineal `--surface-1 → --surface-2` | 1.2 s loop, solo mientras carga |

Prohibido: confetti, parallax, animaciones en loop infinito (salvo skeleton mientras carga), rotaciones 3D, blur animado.

---

## 11. Accesibilidad

- Contraste AA en todo texto (ojo con texto sobre el tinte del evento; calcular y oscurecer el tinte si hace falta).
- Sheet: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` al nombre del evento, focus trap, foco inicial en el primer control interactivo del paso, Esc cierra, al cerrar el foco vuelve al botón que lo abrió.
- Chips/tiles: grupo con `role="radiogroup"` y cada opción `role="radio"`, navegación con flechas.
- Stepper: botones con `aria-label="Agregar una entrada General"` / "Quitar…"; el número en `aria-live="polite"`.
- Errores: `aria-invalid`, `aria-describedby` al mensaje. Resumen de error anunciado en `aria-live="assertive"` al enviar.
- Éxito gratuito: mover foco al título de éxito; anunciar con `aria-live`.
- Objetivos táctiles ≥ 44×44 px.
- Respeta `prefers-reduced-motion` (§10).
- El póster tiene `alt` = nombre del evento (o alt del organizador si existe).

---

## 12. Cambios de backend / API (mínimos)

1. **Crear orden gratuita** sin pasar por Webpay con payload `{ event_id, function_id, ticket_type_id, quantity, full_name, email, utm }` — probablemente ya existe; adaptar para recibir `full_name` y dividir en servidor.
2. **Respuesta "ya inscrito"**: si `email` ya tiene orden válida para ese evento (gratuito), responder `409 { code: "ALREADY_REGISTERED" }` en vez de crear duplicado (o lo que el modelo actual permita; si se permiten múltiples, no aplica).
3. **Lista de espera** (si no existe): tabla `event_waitlist (id, event_id, function_id null, email, created_at, notified_at null)` + endpoint `POST`. Notificación cuando se libere cupo: **fuera de alcance** (dejar solo el registro).
4. **Color del evento**: columna `events.theme_color text null` calculada al subir imagen (o cálculo on-the-fly cacheado, ver §4.3).
5. **Disponibilidad por función y tipo** en una sola llamada para el paso 1 (si hoy son varias): `GET /api/events/:id/availability` → `{ functions: [{ id, date, start, end, venue, status: available|few|sold_out }], ticket_types: [{ id, function_id|null, price, final_price, remaining, max_per_order, on_sale_now, sales_start }] }`. `final_price` calculado en servidor con la misma función que el resumen.
6. Validar en servidor todo lo que el cliente preselecciona por URL (`funcion`, `entrada`, `code`).

---

## 13. Plan por fases y criterios de aceptación

### Fase 0 — Quick wins (sin cambios de flujo)
- [ ] Íconos de fecha y ubicación corregidos en el hero.
- [ ] Formato de fecha "Domingo 8 de noviembre" (sin "De" mayúscula).
- [ ] Card de precio sticky en desktop; barra sticky inferior en mobile.
- [ ] Precio final con cargo incluido en card y barra ("$4.381 · incluye cargo").
- [ ] Etiquetas "Fan"/"Super Fan" ocultas para el comprador.
- [ ] Imagen repetida al final de la página eliminada.
- [ ] Tipografía del modal unificada con el sitio; alto del modal fijo (sin saltos).
- [ ] Si hay 1 tipo de entrada y 1 función: cantidad 1 preseleccionada y paso 1 saltado.
- [ ] "Confirmar correo" eliminado; sugerencia de typo de email agregada.
- [ ] Código de descuento colapsado detrás de "¿Tienes un código de descuento?".
- [ ] Asistente IA flotante reemplazado por link al final de FAQ.

### Fase 1 — Página de evento nueva
- [ ] Layout 2 columnas desktop / 1 columna mobile según §4.1–4.2.
- [ ] Póster nunca recortado, cualquier aspect ratio.
- [ ] Tinte del evento calculado y aplicado, con contraste AA verificado.
- [ ] Tabs eliminadas; secciones "Sobre el evento", "Funciones" (si >1), "Ubicación", "Preguntas frecuentes".
- [ ] Organizador visible.
- [ ] Todos los estados de §4.4 renderizan correctamente (probar con eventos mock de cada estado).
- [ ] Animaciones A1–A5, A20–A23.
- [ ] LCP < 2.5 s en 4G simulado; CLS < 0.05.

### Fase 2 — Flujo gratuito inline
- [ ] Registro sin modal, 2 campos, 1 clic, éxito en la misma card.
- [ ] Estados: idle, submitting, success, already, error, full/waitlist, approval (si existe).
- [ ] Usuario recordado prellena datos.
- [ ] Animaciones A15–A19.
- [ ] El email de confirmación con QR se sigue enviando igual que hoy.
- [ ] Prueba: registro completo en mobile en < 15 s desde que carga la página.

### Fase 3 — Checkout pagado 2 pasos
- [ ] Sheet lateral desktop / bottom sheet mobile, sin layout shift.
- [ ] Paso 1 omite niveles con una sola opción (probar: 1 lugar/1 función/1 tipo; 1 lugar/3 funciones/2 tipos; 2 lugares/5 funciones/3 tipos con uno amarrado a función).
- [ ] Precios finales coinciden al peso con el cálculo de backend para todos los tipos.
- [ ] Paso 2 con 2 campos + checkbox de retracto; paso "Confirmar" eliminado.
- [ ] Deep links `funcion`, `entrada`, `code`, `checkout` funcionando y validados en servidor.
- [ ] Back del navegador navega entre pasos.
- [ ] Reserva temporal con timer (si aplica).
- [ ] Retorno de Webpay éxito/rechazo rediseñado.
- [ ] Animaciones A6–A14, A24, A25.
- [ ] Accesibilidad §11 verificada con teclado y VoiceOver (macOS/iOS).

---

## 14. Analítica (embudo)

Emitir eventos (con el sistema de analítica actual; mantener UTM y `event_id` en todos):

| Evento | Cuándo |
|---|---|
| `event_view` | Carga de página |
| `rsvp_start` | Primer foco en un campo del formulario gratuito |
| `rsvp_submit` / `rsvp_success` / `rsvp_error {code}` | Envío / resultado |
| `checkout_open {entry: card|sticky|function_list|deeplink}` | Abre el sheet |
| `checkout_place_select`, `checkout_function_select`, `checkout_qty_change` | Interacciones del paso 1 |
| `checkout_step2_view` | Llega al paso 2 |
| `checkout_code_apply {valid}` | Aplica código |
| `checkout_pay_click {total, qty}` | Aprieta pagar |
| `order_paid` / `order_failed` | Retorno de Webpay |
| `hold_expired` | Expira reserva |

Meta: medir conversión `event_view → rsvp_success` (gratis) y `event_view → order_paid` (pagado) dos semanas antes y después de cada fase.

---

## 15. Fuera de alcance / preguntas abiertas

**Revisión 26-10-2026:**
- ¿El endpoint del muro puede entregar conteos por emoji agregados para la página pública, sin nombres ni mensajes? Si no, la card no los muestra (§4.4b d).
- "Asistencia confirmada" depende de reconocer la orden gratis en este navegador (sesión de asistente o storage local, como hoy hace "Ver mis entradas"). Usar el mismo mecanismo; no crear uno nuevo.


- Modo oscuro completo del sitio.
- Selección de asientos numerados.
- Login de compradores / cuenta de asistente (solo "recordar email" local).
- Notificaciones automáticas de lista de espera.
- Apple Pay / Google Pay / MercadoPago (cuando exista MercadoPago, el CTA pasa a `Pagar {total}` y el método se elige en el paso 2 con dos tiles).
- **Abierto:** ¿el organizador puede marcar el teléfono como obligatorio? Si no existe la opción, el teléfono desaparece del flujo.
- **Abierto:** ¿existe hoy "requiere aprobación" para eventos gratuitos privados? Si no, el estado `approval` queda preparado pero oculto.
- **Abierto:** límite de entradas por orden (hoy no visible); usar 10 por defecto si no está configurado.

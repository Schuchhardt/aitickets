# AI Tickets — Rediseño de la landing para productores

**Para:** Claude Code (implementación)
**Ruta:** `/organizadores` (landing "Para organizadores")
**Objetivo:** que un productor de stand-up, teatro, música o talleres entienda en 5 segundos qué gana, cuánto cuesta y cómo empezar, y que publique su próxima función. Métrica principal: visitas → cuentas creadas → primer evento publicado.
**Dirección visual:** la misma de la página de evento (`SPEC_evento_checkout_aitickets.md`): contención estilo Tesla/Luma, blanco/negro/grises, el verde lima de marca como único acento.
**Prototipo de referencia:** página "Landing productores" del canvas "AI Tickets — Evento y checkout" (desktop y mobile). Si hay diferencias, manda este documento.

---

## 0. Cómo trabajar con este documento (Claude Code, lee esto primero)

1. Ubica la página `/organizadores` y sus componentes, y la configuración de metadata/SEO de esa ruta.
2. **Reutiliza los tokens** definidos en `SPEC_evento_checkout_aitickets.md` §3 (superficies, texto, radios, sombras, curvas y duraciones). Si esa spec aún no se implementó, implementa sus tokens primero. No crees un segundo sistema de colores.
3. Mantén la tipografía display y la sans actuales del sitio.
4. No cambies URLs, slugs ni enlaces internos a guías (`/guias/...`, calculadora, términos). La landing tiene valor SEO: el H1, el title y la description se mantienen o mejoran, no se pierden.
5. Las fases (§12) son commits dentro del **PR único del rediseño** (ver `README.md`). Cada commit debe dejar el sitio compilando.
6. Si existe el skill `impeccable`, corre `/impeccable critique` y `/impeccable polish` al final de cada fase, dentro de esta dirección. No introduzcas gradientes, blobs, glassmorphism ni grids decorativos.

---

## 1. Diagnóstico de la landing actual (14-10-2026)

**Ruido visual**
- Diez secciones con siete fondos distintos: blob de gradiente violeta/rosa en el hero, gradiente menta→lima, negro, gradiente oscuro con brillo verde, blanco, gradiente lima, negro. Cada cambio de fondo reinicia la atención y la página se siente como varias landings pegadas.
- El lima se usa para todo: CTAs, badges, palabras destacadas en titulares, tarjetas del chat, barras. Cuando todo es acento, nada lo es.
- Cada sección tiene un badge tipo pill ("Funciones recurrentes", "Links con seguimiento", "Opcional · Conector…", "Míralo en acción", "El día del evento", "Precio transparente", "Sin mensualidad…"). Siete badges es demasiado.

**Contenido repetido**
- Cortesías aparece en "Muchas funciones" y en "La venta termina en la puerta".
- Check-in con QR aparece en las cards del hero, en el video y en "La venta termina en la puerta".
- Los links por promotor aparecen en las cards del hero, en "¿Quién está vendiendo tus entradas?", en la FAQ y en el cierre.
- Las tres cards del hero adelantan secciones que vienen después; no suman.
- El video repite un tercer titular ("¿Y si cada función estuviera llena?") que compite con el H1.

**Orden**
- El precio, que es la principal duda de un productor y el mayor diferenciador (0% para ti), aparece recién en la octava sección.
- La sección de IA (conector para Claude/ChatGPT) ocupa una pantalla y media en el centro de la página, aunque es opcional y la mayoría de los productores no la necesita para decidir.

**Confianza**
- No hay prueba social: ni productores, ni números, ni testimonios.
- **Inconsistencia en los plazos de pago:** la landing dice "disponible 48 h después… llega en hasta 2 días hábiles"; la home dice "48–72 h". **Decisión:** el plazo es **48 horas después del evento**. Unificar esa frase en home, landing, FAQ, página de precios y emails.

---

## 2. Mensaje y estructura

**Una promesa:** vende más funciones sin pagar nada fijo, y sabe qué te está funcionando.

**Tres pruebas, en este orden:** cuánto cuesta (nada para ti) → cómo funciona (publica, comparte, cobra) → qué te hace distinto (sabes qué promotor vende, la puerta funciona sin señal, la IA opcional).

### Estructura nueva (10 secciones, 2 fondos oscuros como máximo)

| # | Sección | Fondo | Reemplaza a |
|---|---|---|---|
| 1 | Hero + prueba social | blanco | Hero + 3 cards |
| 2 | Cómo funciona (3 pasos) | blanco | "Muchas funciones…" (parcial) y el video |
| 3 | Precio con calculadora | `--surface-1` | "Publica sin mensualidad…" + link a calculadora |
| 4 | Quién vende tus entradas | `--brand-ink` (oscuro) | igual, simplificada |
| 4b | Marketing en piloto automático (redes + anuncios) | blanco | nueva (antes solo "Posts con IA" en una card) |
| 5 | La venta termina en la puerta | blanco | igual, sin cortesías repetidas |
| 5b | Antes, durante y después (video de portada, muro, reseñas) | blanco | nueva |
| 6 | Todo lo demás, incluido | `--surface-1` | "Muchas funciones…" (resto) |
| 7 | Tu ticketera, dentro de tu IA | blanco | igual, a la mitad de alto |
| 8 | Preguntas frecuentes | blanco | igual, con respuestas |
| 9 | Cierre | `--brand-ink` (oscuro) | igual |

**Se elimina:** la sección de video como bloque propio. El video pasa a un modal que abre el CTA secundario del hero ("Ver cómo funciona · 1 min").

---

## 3. Sistema visual de la landing

- **Fondos:** solo blanco, `--surface-1` (#F6F6F7) y `--brand-ink` (#0A0A0B). Sin gradientes ni blobs.
- **Lima** (`--brand-lime`) solo en: botón primario sobre fondo oscuro, el check/estado "válida", las barras de progreso de ventas y el punto de "en vivo". En fondo blanco, el botón primario es negro.
- **Titulares:** display actual, 64/68 desktop y 40/44 mobile para el H1; 44/48 y 30/34 para H2. Sin palabras destacadas en color dentro de los titulares.
- **Eyebrows:** en lugar de badges tipo pill, texto 13 px, peso 600, `letter-spacing .08em`, mayúsculas, `--text-2`. Solo en secciones 2, 3, 4, 5 y 7.
- **Ancho de contenido:** 1120 px máx; texto corrido máx 60 caracteres.
- **Espaciado vertical entre secciones:** 128 px desktop, 80 px mobile.
- **Imágenes de producto:** mockups reales del producto (página de evento rediseñada, panel de métricas, check-in) dentro de marcos de dispositivo sobrios, sin sombras de color.

---

## 4. Header

- Sticky. Arriba del todo: fondo transparente sobre blanco. Después de 8 px de scroll: fondo blanco 92% + `backdrop-filter: blur(12px)` + borde inferior `--border`.
- Izquierda: logo. Derecha: `Eventos` · `Precios` (ancla a §3) · `Ingresar` (texto) · botón `Publicar función` (negro, 36 px de alto).
- El botón `Publicar función` del header **solo aparece cuando el CTA del hero sale del viewport** (IntersectionObserver), con fade + `translateY(-4px → 0)`. Mientras el hero es visible, no hay dos CTAs iguales en pantalla.
- Mobile: logo + `Ingresar` + menú (hamburguesa) que abre un sheet con los mismos links.

---

## 5. Secciones: layout, copy y comportamiento

### 5.1 Hero

**Layout desktop:** dos columnas (6/6). Izquierda: texto. Derecha: composición de producto. Alto mínimo 640 px. Mobile: texto arriba, composición abajo (recortada a 360 px de alto).

**Copy:**
- Eyebrow: `PARA PRODUCTORES · SIN MENSUALIDAD · 0% DE COMISIÓN PARA TI`
- H1: **Tu próxima función merece vender más.**
- Bajada: *Publica tus fechas en minutos, mide qué promotor vende y recibe lo de cada función 48 horas después del evento.*
- CTA primario: `Publicar mi próxima función →` (negro, 52 px)
- CTA secundario: `▶ Ver cómo funciona · 1 min` (texto con ícono; abre el video en modal)
- Microcopy (13 px, `--text-2`): *Crear tu cuenta es gratis. El comprador paga un cargo de 8% + IVA, o lo absorbes tú.*
- Línea terciaria (14 px): `¿Prefieres hablar? Escríbenos por WhatsApp` · `Mira un evento de ejemplo`

**Composición de producto (derecha):**
- Un teléfono (marco 300×620, radio 44) con la página de evento rediseñada (**portada en video** + título + card "Comprar entrada"). El video va silenciado, en loop, con un ícono de parlante tachado abajo a la derecha (decorativo, `aria-hidden`). Así el hero muestra desde el primer segundo que la portada puede ser video. Reglas de carga en §9.
- Card flotante arriba a la izquierda del teléfono: *Stand-up de Viernes · 142 de 200 vendidas* con barra lima al 71%.
- Card flotante abajo a la derecha: *Link de Pedro · 23 entradas · $184.000*.
- Card flotante pequeña: *✓ Pago disponible · Función del jueves · $1.296.000* (o el plazo real).
- Los números son datos de ejemplo; mostrar la etiqueta `Datos de ejemplo` en 11 px bajo la composición.

**Prueba social (debajo del hero, misma sección):**
- Línea: `Productores que ya venden con AI Tickets` + fila de 5–6 logos en gris (opacidad 0.6, hover 1).
- Tres cifras: `[N] funciones publicadas` · `[N] entradas vendidas` · `[N] entradas validadas en puerta`. **Solo con datos reales**; si no hay cifras que mostrar, se oculta la fila completa (nunca inventar).

### 5.2 Cómo funciona

- Eyebrow: `CÓMO FUNCIONA`
- H2: **De la fecha a la puerta, en un solo lugar.**
- Tres columnas, cada una con un mini-mockup (240 px de alto) arriba, número, título y una línea:

| Paso | Título | Texto | Mockup |
|---|---|---|---|
| 1 | Publica | Todas las fechas en un solo evento. Para la próxima temporada, lo duplicas. | Lista de funciones con "+ Agregar función" |
| 2 | Comparte | Un link para cada comediante, promotor o campaña, y posts listos con IA. | Lista de 3 links con contador de entradas |
| 3 | Cobra | Tu equipo valida con QR desde el celular y lo recaudado llega 48 h después del evento. | Pantalla de check-in con "✓ Válida" |

- Debajo: `▶ Ver el video completo` (abre el mismo modal).
- Mobile: los tres pasos en un carrusel horizontal con scroll-snap y puntos de paginación, o apilados (preferir apilados si el carrusel complica la accesibilidad).

### 5.3 Precio con calculadora (ancla `#precios`)

- Eyebrow: `PRECIO`
- H2: **Sin mensualidad. Se cobra solo cuando vendes.**
- Bajada: *Para ti, 0% de comisión. El comprador paga un cargo por servicio de 8% sobre el valor de la entrada, más IVA sobre ese cargo. Si prefieres mostrar un precio final, lo absorbes tú. Las entradas gratis no pagan cargo.*

**Calculadora (card blanca, 2 columnas en desktop):**

Entradas (izquierda):
- `Precio de tu entrada`: input numérico con prefijo `$`, formato `es-CL` (miles con punto), + slider de $1.000 a $100.000 en pasos de $500. Default $10.000.
- `Entradas que esperas vender`: slider 10–1.000, default 100, con el número editable.
- `¿Quién paga el cargo?`: segmented control de 2 opciones: `El comprador` (default) · `Yo lo absorbo`.

Resultados (derecha, fondo `--surface-1`):
- `El comprador paga` → precio final por entrada.
- `Tú recibes por entrada` → monto.
- `Tú recibes en total` → monto grande (display 40 px), animado (A9).
- Desglose colapsable `Ver detalle`: Entrada · Cargo por servicio (8%) · IVA del cargo (19%).
- Línea fija: *Sin mensualidad · Sin permanencia · Sin costos fijos.*

**Fórmula** (debe coincidir al peso con el backend; reutilizar la util de precios existente o el endpoint `quote_fees` si ya existe en la API):
```
cargo   = round(precio × 0.08)
ivaCargo = round(cargo × 0.19)
Si paga el comprador: comprador = precio + cargo + ivaCargo ; recibes = precio
Si lo absorbes:       comprador = precio ; recibes = precio − cargo − ivaCargo
Total = recibes × entradas
```
Verificación: precio $10.000 → cargo $800, IVA $152, comprador $10.952 / recibes $10.000; absorbido → recibes $9.048.

- Debajo de la card: `Ver precios en detalle →` (link a la página de precios existente).

### 5.4 Quién vende tus entradas (fondo oscuro)

- Eyebrow: `LINKS CON SEGUIMIENTO`
- H2: **¿Quién está vendiendo tus entradas?**
- Texto: *Crea un link para cada integrante del line-up, promotor o campaña. Cada compra queda asociada al link con que llegó el comprador, y en las métricas ves órdenes, entradas e ingresos por canal. Sin capturas de pantalla ni reportes a mano.*
- Dos bullets (ícono monocromo):
  - *Compara canales y decide dónde poner tu próxima publicación o tu presupuesto.*
  - *Súmale códigos de descuento con fecha límite y cupos para preventas o la última semana.*
- Link: `Cómo medir las ventas de cada promotor →`
- Visual (derecha): panel "Ventas por canal · Stand-up del jueves" con 4 filas (Link de campaña 37 · Link de Pedro 23 · Link de Ana 11 · Directo 9), barras lima sobre `#1F1F22`, montos en `--text-3` claro. Etiqueta `Datos de ejemplo`.
- **Animación:** al entrar en viewport, las barras crecen de 0 al valor con stagger de 80 ms y los contadores de entradas cuentan de 0 al valor (A12).

### 5.4b Marketing en piloto automático (ancla `#marketing`)

> **Funcionalidad nueva.** Esta sección promete tres capacidades: conectar redes, programar publicaciones automáticas y lanzar anuncios. **Antes de publicar la sección, confirma en el backend cuáles existen.** Las que aún no estén listas se muestran con una etiqueta `Pronto` (pill gris, 12 px) junto al título del bloque, nunca como si funcionaran. Ver §13.

- Eyebrow: `MARKETING EN PILOTO AUTOMÁTICO`
- H2: **Tu evento se promociona solo, todos los días.**
- Bajada: *Conecta Instagram, Facebook o TikTok. Con el póster y los datos de tu evento armamos historias, posts y reels, y se publican solos hasta el día de la función.*

**Layout desktop:** grid `1fr 360px`, gap 24.

**Izquierda: calendario semanal** (card blanca, borde `--border`, radio 20, `--shadow-card`):
- Header: `Esta semana · {nombre del evento}` + chips de redes: `● Instagram` `● Facebook` (punto verde = conectada) y `+ TikTok` (gris, sin conectar).
- Grid de 7 columnas (lun–dom), cada una con día y número; la columna de hoy con borde lima y fondo `#FBFEF5`; los días con función muestran un tag negro `FUNCIÓN`.
- Slots por día (máx. 3): `Post 12:00` (lun, mié, vie), `Historia 19:00` (todos los días), `Reel 20:00` (día antes y día de la función). Estados: pasado = `Publicado ✓` (fondo `#EEF8DC`, texto `#2F5A00`); hoy = `Hoy 19:00` (fondo lima); futuro = hora (fondo `--surface-1`).
- Debajo: 3 switches tipo pill — `Historia diaria`, `Post lun · mié · vie`, `Reel antes de la función` — que agregan o quitan sus slots del calendario en vivo, y el contador `{n} publicaciones esta semana` a la derecha.
- Nota (13 px, `--text-3`): *Cada publicación lleva su link con seguimiento, y puedes revisarla o editarla antes de que salga.*

**Derecha: anuncios** (card negra, radio 20):
- Eyebrow `OPCIONAL · ANUNCIOS`; título **¿Faltan entradas? Impulsa la función.**; texto *Campañas en Instagram y Facebook desde tu panel, para el público de tu ciudad. Tú defines el presupuesto y la pausas cuando quieras.*
- Slider `Presupuesto diario` ($3.000–$50.000, paso $1.000, default $10.000) y slider `Días` (1–7, default 3).
- Botón lima: `Impulsar · {presupuesto × días}`. En la landing es demostrativo: al apretarlo la card muestra `✓ Campaña activa · 3 días · $30.000` y `Pausar`. **No hay alcance estimado ni resultados** (no inventar números).

**Mobile:** título + bajada, lista de 3 filas (`Historia diaria · 19:00 — Activa`, etc.) y card negra de anuncios abajo.

**Animaciones:** al entrar en viewport, los slots aparecen con stagger (70 ms por día, 40 ms entre slots; `scale .96→1` + fade, `--ease-spring`). Los switches deslizan el knob (`--dur-2`). El contador anima con interpolación (como L9).

**Copy de FAQ que se agrega (§5.8):**

| Pregunta | Respuesta |
|---|---|
| ¿Cómo funciona la publicación automática en redes? | Conectas Instagram, Facebook o TikTok una vez. Con el póster y los datos de tu evento armamos historias, posts y reels, eliges cuáles y a qué hora, y se publican solos hasta el día de la función. Puedes revisar y editar cada pieza antes de que salga. |
| ¿Tengo que pagar anuncios? | No. Publicar en tus redes no tiene costo. Los anuncios son opcionales: defines un presupuesto diario y los días, y los pausas cuando quieras. |

### 5.5 La venta termina en la puerta

- Eyebrow: `EL DÍA DEL EVENTO`
- H2: **La venta termina en la puerta.**
- Bajada: *Que tu equipo reciba a la gente sin planillas ni listas de último minuto.*
- Layout: izquierda un teléfono con la pantalla de check-in (cámara simulada + resultado `✓ Válida · General · Sebastián P. · 1 de 2`); derecha, lista de 4 ítems (ícono + título + 1 línea):
  - **Check-in desde el celular.** Tu equipo escanea el QR desde el navegador del teléfono. Una entrada usada no vuelve a entrar.
  - **Sigue funcionando sin señal.** Si se cae la conexión, valida con la lista descargada y sincroniza al volver.
  - **Puerta sin contraseñas.** Dale a tu equipo el rol Puerta o un link temporal que vence solo.
  - **Cortesías e invitados.** Las cortesías llegan con su propio QR y se validan igual que una entrada pagada.
- Link: `Cómo funciona el control de acceso con QR →`
- **Animación:** el resultado del escaneo alterna cada 2,4 s entre `✓ Válida` (lima) y `Ya ingresó · 21:42` (gris), con crossfade; solo mientras la sección está en viewport y sin `prefers-reduced-motion` (A14).

### 5.5b Antes, durante y después (ancla `#comunidad`)

> **Funcionalidades que ya existen en producción** (verificado en el repo, oct 2026): video de portada (`events.cover_video`, migración `202610240100_event_videos.sql`), reseñas e invitaciones (`docs/runbooks/resenas-e-invitaciones.md`) y muro de asistentes (`AttendeeFeed.vue`, `attendee-community.mjs`). El copy de esta sección describe solo lo que hacen hoy; si algo cambia, se ajusta el copy, no al revés.

- Eyebrow: `ANTES, DURANTE Y DESPUÉS`
- H2: **Tu evento se ve vivo antes y se recuerda después.**
- Bajada: *Video de portada para que den ganas de ir, un muro donde tu público se encuentra y reseñas que te traen al próximo evento a los que ya fueron.*
- Tres filas alternadas (mockup ↔ texto), 112 px entre filas. Cada fila lleva un rótulo pequeño en Sora 14 px `--text-3`: `ANTES`, `DURANTE`, `DESPUÉS`.

**Fila 1 · ANTES — Portada con video** (mockup izquierda, 55%)
- Mockup: ventana de navegador (barra con `aitickets.cl/eventos/stand-up-de-viernes`) con la portada 16:9 en video real: `autoplay muted loop playsinline`, degradado inferior con fecha y título del evento. Botón redondo 40 px arriba a la derecha (fondo `rgba(0,0,0,.55)`) que alterna sonido: `aria-label` "Activar sonido" / "Silenciar", ícono de parlante tachado / con ondas.
- H3: **Una portada en video vende más que un póster.**
- Texto: *Sube un clip de tu show y reemplaza la imagen arriba de la página del evento. Se reproduce solo y sin sonido, y quien quiera lo activa con un toque.*
- Lista con ✓ lima oscuro (`#4C8A00`):
  - MP4, MOV o WebM de hasta 50 MB, horizontal o vertical.
  - Un cuadro del video queda como imagen para compartir y para los correos.
  - Súbelo desde el panel o pídeselo a tu IA con el link del video.
  - También puedes sumar un video arriba de las fotos de la galería.
- Recomendación de producto (fuera de la landing, para el panel): en el paso Portada, mostrar el video como opción destacada ("Recomendado: sube un clip de 10–20 s").

**Fila 2 · DURANTE — Muro "Quiénes van"** (texto izquierda, mockup derecha)
- H3: **Un muro para que tu público se encuentre.**
- Texto 1: *Quienes tienen entrada reaccionan con un emoji y dejan un mensaje corto que ven los demás asistentes. Se arma la previa, la gente se coordina y llega con ganas. Tú lo moderas desde el panel.*
- Texto 2: *Y si alguien necesita hablar contigo, te escribe desde su entrada: el mensaje te llega al correo y queda guardado en el panel del evento.*
- Mockup (card blanca, radio 20, etiqueta `Datos de ejemplo`):
  - Título `Quiénes van` y fila de conteos por emoji ordenados de mayor a menor (🔥 38 · 🎉 25 · 🙌 19 · ❤️ 12).
  - Bloque "Tu reacción": los 8 emojis reales del producto (🔥 🙌 🎉 ❤️ 😍 🤘 💃 🥳) como `role="radiogroup"`, input de mensaje (`maxlength=280`, placeholder *¡Nos vemos el viernes!*) y botón `Publicar`.
  - Lista de mensajes (avatar = emoji en círculo de color suave, nombre como "Camila R.", tiempo relativo, texto). Ejemplos: *Primera vez que vengo, ¡qué ganas! Alguien más va sola?* · *Vamos 6 de la pega, nos vemos en primera fila 😅* · *La última vez fue buenísima. Repito.*
  - Demo: al publicar, el mensaje "Tú" entra arriba con animación `pop` y el conteo de su emoji hace `bump`. Máximo 3 mensajes en la demo.
- Nota: después del evento el muro se titula **"Así lo vivieron"**; se puede mencionar en el FAQ.

**Fila 3 · DESPUÉS — Reseñas** (mockups izquierda, texto derecha)
- H3: **Reseñas que te traen al próximo evento.**
- Texto: *Entre 24 y 72 horas después de cada función, cada asistente recibe un correo "¿Cómo estuvo?" y califica en segundos, sin crear cuenta. La página del evento terminado muestra el promedio, los comentarios y las fotos que suben tus asistentes.*
- Lista con ✓:
  - Comentario público y un mensaje privado solo para ti.
  - Hasta 6 fotos por asistente, visibles al tiro o con tu revisión.
  - Premio opcional por calificar: un código de descuento para tu próximo evento, sin importar la nota.
  - Con un clic invitas a quienes fueron a tu próximo evento, sin repetir a quienes ya compraron ni a quienes se dieron de baja.
- Botón `Invitar a los asistentes al próximo evento` (demo: cambia a `✓ Invitación enviada a 214` y muestra *Se omitieron 31 que ya compraron y 6 que se dieron de baja.*).
- Mockups (grid 2 columnas):
  1. **Correo** (fondo `--surface-1`): `¿Cómo estuvo Stand-up de Viernes?`, 5 estrellas clicables (`role="radiogroup"`, labels "1 de 5 · Muy malo" … "5 de 5 · Excelente", hover escala 1.15), botón `Enviar reseña` deshabilitado hasta elegir. **Igual que el producto real: las estrellas solo preseleccionan; la reseña se envía con el botón.** Al enviar: *¡Gracias por tu nota!* + código `GRACIAS-7K2QXM` con borde punteado.
  2. **Evento terminado** (card negra): promedio `4,8`, estrellas lima, `86 reseñas`, barras de distribución 5→1 que crecen al entrar en viewport.
  3. **Fotos de los asistentes** (ancho completo): 5 miniaturas cuadradas + 2 comentarios con formato de nombre "María P." y estrellas.
- Todo con etiqueta de ejemplo: estas cifras no son reales.

**Mobile:** sección compacta, en el mismo orden: video 4:5 con botón de sonido + 1 párrafo; card "Quiénes van" con 4 chips de reacción tocables (suman 1 y hacen bump) y 2 mensajes; card negra con promedio, 4 fotos y un comentario; 1 párrafo de cierre.

**Implementación del video (landing y producto):**
- `<video muted playsinline loop autoplay preload="metadata" poster="…">`. Setear `el.muted = true` por JS antes de `play()` (Safari) y atrapar el rechazo de la promesa.
- `IntersectionObserver` (umbral 0.25): `play()` al entrar, `pause()` al salir. Así se comporta también la portada real.
- Si el video falla o hay `prefers-reduced-motion` o `navigator.connection.saveData`, mostrar el poster estático (sin autoplay).
- Asset de la landing: MP4 H.264 720p, ≤ 1,5 MB, 5–8 s en loop limpio, sin audio o con audio opcional; más una versión WebM. Poster en AVIF/WebP.

### 5.6 Todo lo demás, incluido

- H2: **Todo lo demás, incluido.**
- Grid de 6 ítems (3×2 desktop, 1 columna mobile), sin cards: ícono 24 px + título + 1 línea, separados por bordes finos.
  - **Hasta 60 funciones por evento.** Entradas para una función o válidas para todas.
  - **Duplica la próxima semana.** Conserva descripción, imagen, lugar y entradas; solo cambias las fechas.
  - **Cada persona con su rol.** Puerta, Marketing, Finanzas o Solo lectura, por evento.
  - **Asistentes avisados.** QR al instante, recordatorio antes de la función y aviso si cambia algo.
  - **Menos mensajes por Instagram.** Un asistente en tu página responde horarios, lugar y edad mínima.
  - **Tu web de eventos, gratis.** Todos tus eventos en una página, con tu propio dominio.

### 5.7 Tu ticketera, dentro de tu IA

- Eyebrow: `OPCIONAL · CLAUDE Y CHATGPT`
- H2: **Tu ticketera, dentro de tu IA.**
- Texto: *Conecta AI Tickets a Claude o ChatGPT y gestiona tus eventos conversando: cómo van las ventas, códigos de descuento, posts. Publicar, cobrar o enviar mensajes siempre te pide confirmación. No es obligatorio: todo funciona también desde el panel.*
- Tres pasos en línea (texto, sin cards): `1 Crea tu cuenta` → `2 Copia la URL del conector` → `3 Pégala en Claude o ChatGPT`.
- CTA secundario: `Conecta tu IA →` + chips pequeños: `Claude` `ChatGPT` `Claude Code` `Cursor` `n8n / Zapier`.
- Visual (derecha): ventana de chat **en blanco/gris**, no en lima. Burbujas del usuario en `--brand-ink` con texto blanco; respuestas en `--surface-1`. Nombres de herramientas (`get_event_performance ✓`) en mono 11 px `--text-3`.
- **Animación:** al entrar en viewport, los 4 mensajes aparecen en secuencia (cada uno 700 ms después del anterior); antes de cada respuesta, un indicador de "escribiendo" (3 puntos) de 500 ms (A13). Se reproduce una sola vez.
- Altura total de la sección: máx. ~1 pantalla en desktop.

### 5.8 Preguntas frecuentes

H2: **Preguntas frecuentes.** Acordeón (mismo componente que en la página de evento, A21). Una abierta a la vez. Marcar el HTML con `FAQPage` (JSON-LD) para SEO.

| Pregunta | Respuesta |
|---|---|
| ¿Cuánto cuesta usar AI Tickets? | Publicar es gratis y no hay mensualidad. Por cada entrada pagada se cobra un cargo por servicio de 8% más IVA sobre ese cargo, que por defecto paga el comprador. Las entradas gratis no pagan cargo. |
| ¿Cuándo recibo el dinero de mis ventas? | Recibes lo recaudado de cada función 48 horas después del evento. |
| ¿Puedo absorber el cargo por servicio? | Sí, se configura por evento. El comprador ve un precio final y tú recibes el valor menos el cargo y su IVA: en una entrada de $10.000, recibes $9.048. |
| ¿Puedo publicar varias funciones de una misma obra o show? | Sí. Un evento admite hasta 60 funciones, con entradas para una función específica o válidas para todas. Si cambias un horario, avisamos por email a quienes ya compraron. |
| ¿Puedo saber cuántas entradas vende cada promotor? | Sí. Creas un link para cada promotor, comediante o campaña, y en las métricas del evento ves órdenes, entradas e ingresos por link. |
| ¿Cómo funciona la publicación automática en redes? | Conectas Instagram, Facebook o TikTok una vez. Con el póster y los datos de tu evento armamos historias, posts y reels, eliges cuáles y a qué hora, y se publican solos hasta el día de la función. Puedes revisar y editar cada pieza antes de que salga. |
| ¿Tengo que pagar anuncios? | No. Publicar en tus redes no tiene costo. Los anuncios son opcionales: defines un presupuesto diario y los días, y los pausas cuando quieras. |
| ¿Puedo poner un video como portada del evento? | Sí, y te lo recomendamos. Subes un MP4, MOV o WebM de hasta 50 MB y reemplaza la imagen arriba de la página: se reproduce solo, sin sonido, y cada persona puede activarlo. Un cuadro del video queda como imagen para compartir y para los correos. |
| ¿Cómo funcionan las reseñas? | Entre 24 y 72 horas después de cada función, los asistentes reciben un correo para calificar con estrellas, dejar un comentario y subir fotos. Ves todo en el panel, puedes ocultar comentarios y, si quieres, premiar a quien califica con un código de descuento para tu próximo evento. |
| ¿Qué es el muro de asistentes? | Un espacio en la página del evento donde quienes tienen entrada reaccionan con un emoji y dejan un mensaje corto que ven los demás asistentes. Tú lo moderas. Después del evento queda como recuerdo de cómo se vivió. |
| ¿Necesito saber de inteligencia artificial? | No. Todo funciona desde el panel. La IA te ayuda a armar el evento y los posts, y si quieres, puedes gestionar todo conversando con Claude o ChatGPT. |
| ¿Qué pasa si tengo que cambiar o cancelar una función? | Cambias fechas y horarios desde el panel, y a los asistentes les llega un aviso por email. Si cancelas, se devuelve el valor de la entrada y el cargo por servicio (no su IVA), en hasta 20 días hábiles. |
| ¿Me ayudan a publicar mi primer evento? | Sí. Escríbenos por WhatsApp o agenda una demo de 15 minutos y lo publicamos contigo. |

*Revisar con legal/operaciones que las respuestas de dinero y reembolsos coincidan con los términos para productores.*

### 5.9 Cierre (fondo oscuro)

- H2 (64 px): **¿Cuándo es tu próxima función?**
- Bajada: *Publícala hoy. Crear tu cuenta es gratis y no hay costos fijos.*
- CTA primario (lima sobre negro): `Publicar mi próxima función →`
- CTA secundario (borde blanco 24%): `Hablar por WhatsApp`
- Línea: `¿Prefieres verlo antes? Agenda una demo de 15 min · Mira un evento de ejemplo`
- Línea de garantías (13 px, `--text-3` claro): `Sin mensualidad · Sin permanencia · Sin costos fijos`

### 5.10 Footer

Se mantiene el contenido actual (incluidos los links SEO a Stand-up, Teatro, Música en vivo, Talleres, Vender entradas online, Entradas con QR, Guías, Ticketeras en Chile). Ordenar en 4 columnas en desktop: Producto · Para quién · Recursos · Legal. El campo "Únete a la comunidad AI" pasa a la columna Recursos.

---

## 6. Barra CTA mobile

En mobile, cuando el CTA del hero sale del viewport, aparece una barra inferior sticky (misma de la página de evento §4.6): izquierda *Gratis para publicar* + *0% de comisión para ti*; derecha `Publicar función`. Se oculta cuando el cierre (5.9) entra en viewport, para no duplicar el CTA.

---

## 7. Modal de video

- Abre desde `Ver cómo funciona · 1 min` y `Ver el video completo`.
- Overlay negro 80%, video centrado 16:9 con radio `--r-lg`, máx 960 px de ancho, botón cerrar (×) arriba a la derecha, Esc cierra, foco atrapado.
- El `<video>` no se carga hasta abrir el modal (`preload="none"`; poster en `<img>` liviano).
- Subtítulos en español (`<track kind="captions">`) si existen.

---

## 8. Animaciones

Mismos tokens y reglas de `SPEC_evento_checkout_aitickets.md` §10 (solo `transform`/`opacity`, todo respeta `prefers-reduced-motion`). Las de esta página:

| # | Elemento | Disparador | Animación | Duración / easing |
|---|---|---|---|---|
| L1 | H1, bajada, CTAs del hero | Carga | Stagger 60 ms: `opacity 0→1`, `translateY 12px→0` | 480 ms `--ease-out` |
| L2 | Teléfono del hero | Carga | `opacity`, `translateY 24px→0`, delay 200 ms | 600 ms `--ease-out` |
| L3 | Cards flotantes del hero | Carga | Aparecen una a una (delay 500/650/800 ms) con `scale .96→1` + fade; luego flotan ±4 px en Y, 6 s, **máx. 2 ciclos** | 400 ms `--ease-spring` |
| L4 | Barra "142 de 200" | Carga | `scaleX 0→0.71` | 900 ms `--ease-out`, delay 700 ms |
| L5 | Header | Scroll > 8 px | Fondo y borde aparecen | `--dur-2` |
| L6 | CTA del header | CTA del hero sale de pantalla | Fade + `translateY -4px→0` | `--dur-2` |
| L7 | Secciones | Entran en viewport (umbral 20%) | Eyebrow, H2 y contenido: stagger 60 ms, fade + `translateY 16px→0`. **Una sola vez** | 480 ms `--ease-out` |
| L8 | Pasos "Cómo funciona" | Entran en viewport | Stagger 120 ms entre las 3 columnas | 480 ms |
| L9 | Calculadora: total | Cambia precio, entradas o quién paga | Interpolación numérica (como A9) | 300 ms `--ease-out` |
| L10 | Calculadora: segmented control | Cambio | El indicador se desliza a la opción elegida (`translateX`) | `--dur-2` `--ease-in-out` |
| L11 | Calculadora: desglose | Abrir/cerrar | Grid-rows 0fr→1fr | `--dur-2` |
| L12 | Barras de "Quién vende" | Entran en viewport | `scaleX 0→valor`, stagger 80 ms; contadores cuentan 0→valor | 900 ms `--ease-out` |
| L13 | Chat IA | Entra en viewport | Mensajes en secuencia (700 ms entre cada uno) con "escribiendo…" de 500 ms antes de cada respuesta. Una vez | 300 ms por mensaje |
| L14 | Resultado del check-in | En viewport | Crossfade cada 2,4 s entre "Válida" y "Ya ingresó". Se pausa fuera de viewport | 300 ms |
| L15 | Modal de video | Abrir/cerrar | Overlay fade; video `scale .96→1` + fade | `--dur-3` |
| L16 | Barra CTA mobile | Aparece/desaparece | `translateY 100%→0` y vuelta | `--dur-3` |
| L17 | Videos de portada (hero y §5.5b) | En viewport | Reproducen en loop silenciados; `pause()` fuera de viewport. Sin video disponible: poster con zoom lento (Ken Burns, `scale 1.02→1.12`, 9 s, alternado) | — |
| L18 | Muro: publicar | Click en Publicar | Mensaje nuevo entra con `pop` (`translateY 8px→0`, `scale .96→1.02→1`); el chip de su emoji hace `bump` (`scale 1→1.18→1`) | 360 ms / 320 ms `--ease-spring` |
| L19 | Muro: emoji elegido | Click | `scale 1→1.08` y borde negro | 160 ms `--ease-spring` |
| L20 | Estrellas del correo | Hover / click | Estrella en hover `scale 1.15`; relleno lima hasta la elegida; al enviar, el bloque de gracias entra con `msg-in` | 160 ms / 300 ms |
| L21 | Barras de distribución de reseñas | Entran en viewport | `scaleX 0→valor`, stagger 80 ms. Una vez | 900 ms `--ease-out` |

Prohibido: parallax, blobs animados, confetti, loops infinitos (salvo L14 y L17 mientras son visibles), animaciones que se repitan cada vez que se vuelve a hacer scroll.

---

## 9. Accesibilidad y performance

- Un solo `<h1>`; H2 por sección. Contraste AA en texto sobre negro y sobre `--surface-1`.
- Calculadora: inputs con `<label>`, slider con `aria-valuetext="$10.000"`, segmented control como `role="radiogroup"`, resultado total en `aria-live="polite"` con debounce de 400 ms.
- Animaciones de entrada: el contenido debe ser visible y legible sin JS (estado final por defecto; la animación se agrega con una clase cuando JS está listo).
- LCP < 2,5 s en 4G: la composición del hero en imágenes optimizadas (AVIF/WebP con `next/image` o equivalente) o en HTML/CSS. El video del teléfono del hero **no** puede ser el LCP: el poster carga como imagen prioritaria y el `<video>` se monta después de `load` (o con `requestIdleCallback`), con `preload="none"`, ≤ 1,5 MB y sin autoplay con Save-Data o `prefers-reduced-motion`.
- Botón de sonido con `aria-label` que cambia; el video de §5.5b tiene `aria-label` descriptivo y el del hero es decorativo (`aria-hidden`).
- CLS < 0,05: reservar alto de logos, mockups y FAQ.
- Lazy-load de todo lo que está bajo el pliegue.

---

## 10. SEO

- Mantener (o mejorar sin perder keywords) title y description actuales: "ticketera", "vender entradas", "Chile", "0% comisión", "productores".
- H1 sin cambios: "Tu próxima función merece vender más."
- JSON-LD: `Organization`, `SoftwareApplication` (con `offers` de precio 0 y descripción del cargo) y `FAQPage`.
- Mantener todos los links internos a guías y a páginas por categoría (en el footer y en los links de cada sección).

---

## 11. Analítica

| Evento | Cuándo |
|---|---|
| `lp_view` | Carga |
| `lp_cta_click {position: hero|header|mobile_bar|final, label}` | Click en cualquier CTA de publicar |
| `lp_whatsapp_click {position}` | Click en WhatsApp |
| `lp_video_open {position}` / `lp_video_progress {pct: 25|50|75|100}` | Modal de video |
| `lp_calc_change {price, qty, payer}` | Uso de la calculadora (debounce 1 s, una vez por sesión por campo) |
| `lp_section_view {section}` | Cada sección entra en viewport (una vez) |
| `lp_faq_open {question}` | Abre una pregunta |
| `lp_ai_connect_click` | Click en "Conecta tu IA" |
| `lp_mk_toggle {type, on}` | Cambia un switch del calendario de marketing |
| `lp_ads_demo {budget, days}` | Aprieta "Impulsar" en la demo de anuncios |
| `lp_cover_sound {on}` | Activa o silencia el video de portada de la demo |
| `lp_wall_demo {emoji, has_text}` | Publica en la demo del muro |
| `lp_review_demo {stars}` | Envía la reseña de la demo |
| `lp_invite_demo` | Aprieta "Invitar a los asistentes" en la demo |

Embudo a medir: `lp_view → lp_cta_click → cuenta creada → primer evento publicado`. Comparar 2 semanas antes y después.

---

## 12. Fases y criterios de aceptación

### Fase A — Limpieza
- [ ] Fondos reducidos a blanco / `--surface-1` / negro; sin blobs ni gradientes.
- [ ] Badges pill reemplazados por eyebrows de texto; solo en las secciones indicadas.
- [ ] Lima solo en los usos de §3.
- [ ] Contenido duplicado eliminado (cortesías, QR, promotores, cards del hero).
- [ ] Sección de video reemplazada por modal.
- [ ] Plazo de pago unificado en todo el sitio: "48 horas después del evento" (home, landing, FAQ, precios, emails).

### Fase B — Nueva estructura
- [ ] Orden de secciones de §2.
- [ ] Hero con composición de producto y prueba social (oculta si no hay datos reales).
- [ ] "Cómo funciona" con 3 pasos y mockups.
- [ ] Calculadora funcionando; resultados idénticos al backend para $1.000, $4.000, $10.000, $15.990 y $100.000 en ambos modos.
- [ ] Sección IA reducida a ~1 pantalla con chat monocromo.
- [ ] Sección de marketing (§5.4b) con calendario interactivo y card de anuncios; cada capacidad que no exista en producción marcada `Pronto`.
- [ ] Sección "Antes, durante y después" (§5.5b) con video real, demo del muro y demo de reseñas; textos idénticos al comportamiento del producto (24–72 h, 280 caracteres, 8 emojis, 6 fotos, estrellas + Enviar).
- [ ] Teléfono del hero con portada en video, cargada sin afectar el LCP.
- [ ] FAQ con respuestas y JSON-LD.
- [ ] Header sticky con CTA condicional; barra CTA mobile.

### Fase C — Movimiento y pulido
- [ ] Animaciones L1–L21.
- [ ] `prefers-reduced-motion` desactiva todo salvo fades de 1 frame.
- [ ] LCP < 2,5 s, CLS < 0,05 en mobile.
- [ ] Verificado con teclado y VoiceOver (macOS/iOS).

---

## 13. Preguntas abiertas (resolver antes de la Fase A)

**Marketing (§5.4b), resolver antes de la Fase B:**
- ¿Qué está listo hoy en producción: conectar redes (OAuth de Meta/TikTok), programar publicaciones recurrentes, publicar historias y reels de forma automática? Lo que no esté, se muestra `Pronto`. **Anuncios: ya existen** (Facebook/Instagram vía Zernio, junto al reporte semanal con ideas de IA, commit `cd72028`), así que la card de anuncios no lleva `Pronto`; ajustar el copy a lo que permite la integración (presupuesto, duración, redes).
- Restricciones a verificar con la documentación vigente de cada plataforma: la publicación automática en Instagram requiere cuenta profesional (Business/Creator) vinculada; los formatos permitidos vía API (feed, reels, historias) y los límites de publicaciones por día; TikTok exige auditoría de la app para publicar en nombre de usuarios.
- Anuncios: ¿la campaña corre en la cuenta publicitaria del productor (él paga a Meta) o en una cuenta de AI Tickets que cobra al productor? Define el copy de cobro, la factura y quién asume el IVA. Meta pide verificación del negocio y revisión de la app para la API de marketing.
- Política de contenido: el productor debe aprobar cada pieza la primera vez (o activar "publicar sin revisión"), para que nunca salga algo que no vio.


1. ~~Plazo de pago~~ **Resuelto:** 48 horas después del evento, en todo el sitio.
2. **Prueba social:** ¿qué productores autorizan mostrar su logo? ¿Qué cifras reales se pueden publicar (funciones, entradas vendidas, entradas validadas)? Sin datos reales, la fila se oculta.
3. **Testimonios:** si hay 2–3 frases reales de productores (con nombre y productora), se agrega un bloque entre 5.5 y 5.6. No se inventan.
4. **Video:** ¿el video actual dura ~1 minuto y tiene subtítulos? Si dura más, ajustar el texto del CTA.
5. **Video de portada de la landing:** el del prototipo está generado con IA como referencia. Ideal: un clip real de 5–8 s de un show (con permiso del productor y del artista).
6. **Reseñas reales:** cuando haya eventos con suficientes reseñas, se puede reemplazar el mockup por un caso real (con permiso). Mientras tanto, siempre con etiqueta de ejemplo.
5. **Página de precios:** ¿se mantiene `/precios` además de la calculadora en la landing? (Recomendado: sí, por SEO.)

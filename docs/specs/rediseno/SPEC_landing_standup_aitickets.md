# AI Tickets — Landing especializada para productores de stand-up

**Para:** Claude Code (implementación)
**Ruta:** la página de stand-up que ya existe en el footer ("Stand-up"). Si no existe, crear `/stand-up` y enlazarla desde el footer y desde la landing principal.
**Objetivo:** que un productor de comedia sienta que la herramienta está hecha para él: line-ups, open mics, temporadas, puerta y redes. Métrica: visitas → cuentas creadas → primer evento publicado, comparada con `/organizadores`.
**Relación con la landing principal:** `/organizadores` sigue la alternativa A (`SPEC_landing_productores_aitickets.md`). Esta página es la alternativa B: editorial, oscura, con fotos. **Reutiliza** de la spec principal la fórmula de la calculadora (§5.3), el header sticky con CTA (§4), la accesibilidad (§9), la analítica base (§11) y el modal de video (§7). Lo que este documento no define, se toma de ahí.
**Prototipo:** canvas "AI Tickets — Rediseño", página "Landing productores", artboards **Stand-up · Desktop** y **Stand-up · Mobile**. Si hay diferencias, manda este documento.

---

## 0. Antes de empezar (Claude Code)

1. Esta página tiene su **propio tema** (oscuro y cálido). Implementarlo como un tema con scope (`[data-theme="standup"]` o un layout propio), sin tocar los tokens globales.
2. **Fotos:** el prototipo usa fotos generadas con IA solo como referencia de tono. En producción van fotos reales de shows de productores que usen AI Tickets, con autorización escrita. Mientras no existan, usar las de referencia **solo en staging**.
3. **Testimonio:** la cita del productor es un espacio para una cita real con nombre, productora y foto autorizada. Si no hay, **se oculta la sección completa**. Nunca se inventa.
4. **Marketing (§4.4):** igual que en la spec principal, toda capacidad que no esté en producción se muestra con etiqueta `Pronto`.
5. Las fases (§10) son commits dentro del **PR único del rediseño** (ver `README.md`).

---

## 1. Sistema visual (tema stand-up)

```css
[data-theme="standup"] {
  --sb-ground: #0E0B09;        /* fondo principal (negro cálido) */
  --sb-surface: #17120F;       /* secciones alternas, cards */
  --sb-surface-2: #241D18;     /* burbujas, inputs */
  --sb-line: rgba(244,237,228,.12);
  --sb-text-1: #F4EDE4;        /* crema */
  --sb-text-2: #CFC5BA;
  --sb-text-3: #B5ABA0;        /* eyebrows, meta (≥ 4.5:1 sobre ground) */
  --sb-accent-serif: #E9DCCB;  /* palabras en cursiva serif */
  --sb-paper: #F4EDE4;         /* secciones claras (precio, anuncios) */
  --brand-lime: (el lima actual de marca);
}
```

- **Tipografía:** display actual (en el prototipo, Sora 700–800) para titulares, combinada con una **serif cursiva** para la segunda mitad de cada titular (prototipo: Fraunces italic 400, Google Fonts). Ejemplo: "Tú haz el show. *Del resto nos encargamos.*" Cuerpo: la sans actual.
- **Escala desktop:** H1 96/92 (línea serif 88), H2 64/66, H3 44/48, cuerpo 18/29. **Mobile:** H1 48/48 (serif 42), H2 34/38, H3 26/30, cuerpo 16/25.
- **Lima:** botones primarios, la barra de progreso de lectura, asientos vendidos, estados "Válida" y "Publicado", y los labels de día de la semana. Nada más.
- **Radios:** fotos 28 px (22 en mobile), cards 18–24 px, botones pill (999 px).
- **Fotos:** siempre `object-fit: cover`. Overlay de legibilidad (gradiente vertical a `--sb-ground`) solo donde hay texto encima.

---

## 2. Estructura

| # | Sección | Fondo |
|---|---|---|
| 1 | Hero a pantalla completa con foto | foto + overlay |
| 2 | Franja de formatos (marquee) | ground |
| 3 | "Una semana con AI Tickets" — 4 capítulos | ground |
| 4 | Marketing en piloto automático (redes + anuncios) | ground |
| 5 | "Mira cómo se llena" — mapa de sala | surface |
| 6 | "Del open mic a la gira" — galería de formatos | ground |
| 7 | Precio | paper (claro) |
| 8 | Testimonio (solo si es real) | ground |
| 9 | IA (opcional) | surface, card |
| 10 | Preguntas frecuentes | ground |
| 11 | Cierre a pantalla completa con foto | foto + overlay |
| 12 | Footer | ground |

---

## 3. Header y progreso

- Header `position: fixed`, transparente sobre el hero; tras 40 px de scroll: `rgba(14,11,9,.82)` + `backdrop-filter: blur(14px)` + borde `--sb-line`.
- Links: `Eventos` · `Marketing` (ancla `#redes`) · `Precio` (ancla `#precio`) · `Ingresar` · botón lima `Publicar función`.
- **Barra de progreso de lectura:** 2 px lima, fija arriba, `transform: scaleX(progreso)`.
- Mobile: logo + botón de menú circular sobre el hero; barra flotante tipo pill abajo (`Gratis para publicar · 0% de comisión para ti` + `Publicar función`) que aparece después del hero y se oculta al llegar al cierre.

---

## 4. Secciones

### 4.1 Hero
- Altura 900 px desktop / 720 px mobile. Foto de un comediante en escena con público (prototipo: `aitk-hero-standup`), `object-position: 50% 30%`.
- Eyebrow: `PARA PRODUCTORES DE STAND-UP`
- H1: **Tú haz el show.** / *Del resto nos encargamos.* (segunda línea en serif cursiva, color `--sb-accent-serif`)
- Bajada: *Entradas para cada función, un link por comediante del line-up, tu show en redes todos los días y tu plata 48 horas después del evento. 0% de comisión para ti.*
- CTAs: lima `Publicar mi próxima función →` y pill con borde `▶ Míralo en 1 minuto` (abre el modal de video).
- Card flotante a la derecha (300 px, vidrio oscuro): `● Vendiendo ahora · ejemplo`, `Stand-up de Viernes`, `Vie 23 oct · 21:00 · Providencia`, mini mapa de 100 asientos (71 en lima) y `Vendidas 71 de 100`. **Etiqueta "ejemplo" obligatoria.** En mobile no se muestra.

### 4.2 Franja de formatos
Texto display 34 px (22 en mobile), `--sb-text-3` oscurecido (`#6F655B`), separado por puntos lima: `OPEN MIC · NOCHE DE COMEDIA · SHOW SOLISTA · LINE-UP · IMPRO · ROAST · TEMPORADA EN SALA · GIRA`. Desplazamiento continuo de 38 s, se pausa al pasar el mouse, `aria-hidden`. Con `prefers-reduced-motion`: estática.

### 4.3 Una semana con AI Tickets
- Intro: eyebrow `UNA SEMANA CON AI TICKETS`; H2 **Del lunes en que publicas al domingo en que** *cobras.*
- Cuatro capítulos en 2 columnas que alternan foto/texto (en mobile, foto arriba y texto abajo), con una línea vertical fina al centro en desktop. Cada foto (4:5) lleva una card de producto encima:

| Día (lima, 14 px, tracking .18em) | Título (H3 + cursiva) | Texto | Foto | Card sobre la foto |
|---|---|---|---|---|
| LUNES | Publicas todas tus fechas *en una sola tarde.* | Hasta 60 funciones en un evento, con entradas para una función o para todas. La próxima temporada la duplicas y solo cambias las fechas. | Productor backstage con su teléfono | `Evento creado · Stand-up de Viernes · 6 funciones` + chips de fechas |
| MIÉRCOLES | Cada comediante con su link. *Y sabes quién vende.* | Cada compra queda asociada al link con que llegó el comprador. Sin capturas de pantalla ni planillas: lo ves por canal, en pesos y entradas. | Line-up riéndose backstage frente a un teléfono | `Ventas por link · ejemplo` con 3 barras lima que crecen |
| VIERNES · 20:45 | La fila avanza *sin listas en papel.* | Tu equipo escanea con su celular, aunque se caiga la señal. Una entrada usada no vuelve a entrar, y las cortesías se validan igual que las pagadas. | Staff escaneando un QR en la puerta | Card lima `✓ Válida · General · Entrada 1 de 2 · Puerta 20:47` |
| DOMINGO · 21:00 | 48 horas después, *la plata es tuya.* | Recibes lo recaudado de cada función 48 horas después del evento. Sin esperar a fin de mes ni perseguir a nadie. | Público riendo y aplaudiendo | Card crema con check y monto que cuenta hasta `$1.296.000` (`Función del viernes · ejemplo`) |

### 4.4 Marketing en piloto automático (ancla `#redes`)
- Eyebrow: `MARKETING EN PILOTO AUTOMÁTICO`
- H2: **Tu show, en redes** *todos los días.*
- Bajada (a la derecha del H2 en desktop): *Conecta tus redes una vez. Con el póster y los datos de tu evento armamos historias, posts y reels, y se publican solos hasta el día de la función.*

**Layout desktop:** grid `300px 1fr`, gap 48.

**Columna izquierda: historia de ejemplo** (teléfono 300×600, marco negro, radio 40):
- Foto vertical del show; 3 barras de progreso arriba (la segunda se llena en 5 s, en loop mientras está visible); avatar + `risaseria · programada 19:00` (nombre de productora ficticia); texto grande `HOY / 21:00`; sticker blanco girado −3° `Quedan 23 entradas`; sticker lima con ícono de link `aitickets.cl/standup-viernes`.
- Es un **mockup genérico**: no copiar la interfaz exacta de Instagram ni usar sus logos.

**Columna derecha, card 1: calendario semanal** (fondo `--sb-surface`, radio 24):
- Header: `Esta semana · Stand-up de Viernes` + chips `● Instagram · conectado`, `● Facebook · conectado` (borde lima), `+ Conectar TikTok` (gris).
- 7 columnas (LUN 19 … DOM 25). Hoy (mié) con borde lima. Días con función (vie y sáb) con tag crema `FUNCIÓN 21:00`.
- Slots: `Post 12:00` (lun, mié, vie), `Historia 19:00` (todos los días), `Reel 20:00` (jue y vie). Estados: pasado `Publicado ✓` (lima 16% de opacidad), hoy `Hoy 19:00` (lima sólido, texto oscuro), futuro con la hora (crema 7% de opacidad).
- 3 switches: `Historia diaria`, `Post lun · mié · vie`, `Reel antes de la función`. Agregan o quitan slots en vivo. Contador `{n} publicaciones esta semana` (7 + 3 + 2 = 12 con todo activo).
- Nota: *Cada publicación lleva su propio link con seguimiento: ves cuántas entradas vendió cada historia. Puedes revisar y editar todo antes de que salga.*

**Columna derecha, card 2: anuncios** (fondo `--sb-paper`, texto oscuro):
- Badge naranjo suave: `QUEDAN 23 ENTRADAS · FALTAN 3 DÍAS`.
- H3: **¿Necesitas un empujón?** *Impulsa con anuncios.*
- Texto: *Lanza una campaña en Instagram y Facebook desde tu panel, con el público de tu ciudad al que le gusta la comedia. Tú decides cuánto invertir y la pausas cuando quieras.*
- Mini formulario (card blanca): slider `Presupuesto diario` ($3.000–$50.000), slider `Días` (1–7), chips de público (`Santiago`, `20–45 años`, `Comedia y stand-up`) y botón `Impulsar · {total} en total`. En la landing es una demo: al apretarlo, muestra `✓ Campaña activa · {días} días` y `Pausar`. **Sin alcance ni resultados estimados.**

**Mobile:** historia de ejemplo (150 px) a la izquierda y los 3 switches apilados a la derecha con el contador; debajo, la card de anuncios con un slider y el botón `Impulsar 3 días · {total}`.

### 4.5 Mira cómo se llena
- Eyebrow `EN TIEMPO REAL`; H2 **Mira cómo** *se llena.*; texto *Cada entrada vendida aparece al instante en tu panel, con el link que la trajo. Si una función se afloja, lo ves a tiempo para lanzar un código de última semana.*
- Contador grande (88 px) `{n}` + `de 200 entradas`.
- Mapa: "ESCENARIO" arriba (arco), 10 filas × 20 asientos con pasillo central. Al entrar en viewport, se llenan en orden aleatorio estable (4 asientos cada 40 ms) en lima con `scale .86→1`. Al llegar a 200 aparece el badge `Función agotada · 100% vendido` con pop.
- Mobile: 8 filas × 12 asientos (96).
- Es una ilustración: `role="img"` con `aria-label` que dice cuántos asientos están vendidos.

### 4.6 Del open mic a la gira
- H2 **Del open mic** *a la gira.*; texto a la derecha: *Funciona igual para el open mic de los martes que para un solista con temporada en sala.*
- 3 tiles 3:4 con foto, gradiente inferior y texto; al pasar el mouse, la foto escala 1.06 y el texto sube 6 px:
  - **Open mic** · Entradas baratas o gratis, cupos y lista de espera
  - **Line-up** · Un link por comediante y ves quién vende
  - **Show solista** · Temporadas de muchas funciones en sala
- Cada tile enlaza a una guía o a un evento de ejemplo de ese formato.

### 4.7 Precio (fondo claro, ancla `#precio`)
- H2 dinámico: **Tú recibes {recv}.** / *Tu público paga {pays}.* (cambia en vivo con la calculadora).
- Texto: *Para ti, 0% de comisión. El comprador paga un cargo por servicio de 8% más IVA sobre ese cargo. Si prefieres un precio final redondo, lo absorbes tú. Las entradas gratis no pagan nada.*
- Línea: `Sin mensualidad · Sin permanencia · Pago 48 h después del evento`.
- Calculadora (card blanca): slider de precio ($1.000–$60.000) + segmented pill `Paga el público / Lo absorbo yo` + desglose. **Misma fórmula que la spec principal §5.3.**

### 4.8 Testimonio
Comillas lima grandes, cita en serif cursiva 46/58, foto circular, nombre y productora. **Solo con una cita real autorizada.** Si no existe, no se renderiza.

### 4.9 IA (opcional)
Card con borde: eyebrow `OPCIONAL · CLAUDE Y CHATGPT`; H2 **¿Prefieres conversar?** *Tu ticketera también.*; texto corto; link lima `Conecta tu IA →`; tres burbujas de ejemplo (usuario en crema, respuesta en `--sb-surface-2`).

### 4.10 Preguntas frecuentes
Las de la spec principal, más estas dos (ya incluidas en el prototipo):
- **¿Cómo funciona la publicación automática en redes?** — Conectas Instagram, Facebook o TikTok una vez. Con el póster y los datos de tu evento armamos historias, posts y reels, eliges cuáles y a qué hora, y se publican solos hasta el día de la función. Puedes revisar y editar cada pieza antes de que salga.
- **¿Tengo que pagar anuncios?** — No. La publicación en tus redes no tiene costo. Los anuncios son opcionales: si quieres impulsar una función, defines un presupuesto diario y los días, y la pausas cuando quieras.

### 4.11 Cierre
Foto a pantalla completa (open mic) con overlay radial oscuro; H2 88 px **¿Cuándo es tu** *próxima función?*; bajada *Publícala hoy. Crear tu cuenta es gratis y no hay costos fijos.*; CTA lima + `Hablar por WhatsApp` + `Agenda una demo de 15 min`.

---

## 5. Animaciones

Mismas reglas que la spec principal (solo `transform`/`opacity`/`clip-path`, todo se apaga con `prefers-reduced-motion`).

| # | Elemento | Animación |
|---|---|---|
| S1 | Foto del hero | Ken Burns: `scale 1.08→1`, 2,4 s, una vez |
| S2 | H1 | Cada línea sube 40 px con fade, stagger 160 ms |
| S3 | Bajada y CTAs | Fade, delay 700–850 ms |
| S4 | Card "Vendiendo ahora" | Entra a los 1,1 s (`translateY 20px`, `scale .96→1`); el punto lima pulsa |
| S5 | Franja de formatos | Desplazamiento continuo 38 s; pausa en hover |
| S6 | Fotos de capítulos | Revelado con `clip-path: inset(12% … round 28px) → inset(0)` (1 s) + la imagen pasa de `scale 1.12` a 1 (1,4 s) |
| S7 | Texto de capítulos | Fade + `translateY 24px→0`, 700 ms |
| S8 | Barras de links (miércoles) | `scaleX 0→valor`, 1,1 s, stagger 120 ms |
| S9 | Monto del domingo | Cuenta de $0 a $1.296.000 en 1,4 s |
| S10 | Historia de ejemplo | Barra de progreso de 5 s, en loop solo mientras está visible |
| S11 | Slots del calendario | Pop con stagger (70 ms por día, 40 ms por slot) |
| S12 | Switches | Knob desliza 200 ms; los slots aparecen o desaparecen |
| S13 | Anuncios | Al impulsar: cambio de estado con pop del check |
| S14 | Mapa de sala | Llenado aleatorio estable + badge "agotada" con pop |
| S15 | Tiles de galería | Hover: foto `scale 1.06`, texto `translateY -6px` |
| S16 | Barra de progreso de lectura | `scaleX` según scroll |

---

## 6. Rendimiento

- El hero es el LCP: servir la foto en AVIF/WebP, `fetchpriority="high"`, ancho máximo 2400 px, con `srcset`.
- Resto de fotos con `loading="lazy"` y `srcset`; los tamaños reservados con `aspect-ratio` (CLS < 0,05).
- Fraunces: cargar solo `ital 400` y `display=swap`.
- El mapa de 200 asientos es DOM liviano (divs) o un `<canvas>`; no usar 200 nodos con sombras.

---

## 7. SEO

- Title: *Vende entradas para stand-up en Chile · 0% de comisión | AI Tickets*. Description orientada a "ticketera para stand-up", "vender entradas para shows de comedia", "open mic".
- H1 visible sin JS. JSON-LD `FAQPage`. Links internos a `/organizadores`, guías de promotores y check-in con QR.
- Fotos con `alt` descriptivo (las del prototipo ya lo traen).

---

## 8. Analítica

Usar los eventos de la spec principal con prefijo `su_` (`su_view`, `su_cta_click {position}`, `su_video_open`, `su_faq_open`), más:
- `su_mk_toggle {type, on}`, `su_ads_demo {budget, days}`, `su_tile_click {format}`, `su_section_view {section}`.

---

## 9. Componentes

`StandupHero`, `FormatMarquee`, `WeekChapter` (foto + card + texto, prop `side`), `StoryMockup`, `MarketingWeek` (calendario + switches), `AdsBoostDemo`, `SeatMap` (prop `rows`, `cols`, `aisleIndex`), `FormatTiles`, `PriceSentence` (H2 dinámico + calculadora compartida con la landing principal), `Testimonial` (no renderiza sin datos), `FaqAccordion` (compartido), `ReadingProgress`.

---

## 10. Fases

**Fase 1 — Página y tema:** tema `standup`, hero, franja, capítulos, galería, precio, FAQ, cierre, footer; fotos de staging. Criterio: Lighthouse móvil ≥ 90 en performance y accesibilidad.
**Fase 2 — Marketing:** sección §4.4 con datos del backend real (redes conectadas, tipos de publicación disponibles) o con `Pronto` donde falte.
**Fase 3 — Movimiento:** S1–S16 y `prefers-reduced-motion`.
**Fase 4 — Contenido real:** fotos de shows reales autorizadas, testimonio real, video con subtítulos.

---

## 11. Preguntas abiertas

1. **Fotos reales:** ¿qué productores de stand-up pueden aportar fotos de sus shows con autorización de uso?
2. **Testimonio:** ¿quién da la primera cita (nombre, productora, foto)?
3. **Marketing:** las mismas preguntas de la spec principal §13 (qué existe hoy, cuentas profesionales de Instagram, auditoría de TikTok, quién paga los anuncios y cómo se factura).
4. **Ruta:** ¿la página de stand-up ya existe? Si existe y tiene tráfico SEO, mantener la URL y redirigir lo que cambie.
5. **Otras verticales:** si esta página funciona mejor que `/organizadores`, replicar el patrón para teatro, música en vivo y talleres con sus propias fotos y capítulos.

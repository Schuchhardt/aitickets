# Sitios de productoras: plantillas por nicho y editor visual

Estado: implementado (nov 2026). Código: `src/lib/siteTemplates.ts`, `src/lib/sitePresets.ts`,
`src/components/sites/` y `src/components/dashboard/site/`.

## Qué cambió

1. **Plantillas completas por tipo de página.** Cada una junta copy, layout y tema: textos y secciones, tipo de menú
   con el diseño de cada sección, y paleta y tipografía. Hay 2 o 3 por nicho (25 en total) y salen de la investigación
   de abajo. El productor aplica una plantilla y después la edita, o le pide los cambios a la IA ("hazlo como un
   festival").
2. **Componentes nuevos:**
   - **Navegación.** Barra superior, centrada o menú lateral (sidebar), con opción de menú fijo. En el celular se
     abre un panel lateral.
   - **Pestañas** (tabs).
   - **Personas** (elenco, artistas, expositores, profes) con su bio en una ventana modal.
   - **Imagen y texto.**
   - **Galería** en grilla con fotos en grande (lightbox), en carrusel o como logos.
   - **Opiniones** en carrusel.
   - **Botones** que abren una ventana con más información (reservas, condiciones, cotizaciones).
   - **Videos subidos** en la portada (de fondo), en la sección Video y en Imagen y texto.
   - Cualquier sección se puede poner en el menú.
3. **Editor visual a pantalla completa** (`/dashboard/sitio/editor`). Tiene cuatro paneles: Secciones, Plantillas,
   Estilo e IA. La vista previa se puede ver como computador, tablet o celular, y los textos se editan haciendo clic
   sobre ellos en la vista previa. Al hacer clic en una sección se abren sus ajustes (fotos, videos, ítems, diseño,
   botón, menú). Deshacer y rehacer cubren todo y funcionan con atajos. La página `/dashboard/sitio` queda para los
   ajustes: estado, dirección, nombre y redes, SEO, banners, contacto y dominio.
4. **Fotos y videos con límite, optimizados como los del evento** (ver "Medios").

## Investigación: tipos de página por nicho

Sitios revisados con WebSearch/WebFetch en noviembre de 2026. Para cada nicho: qué tipos de página encontramos y qué
plantilla quedó para cada uno.

| Nicho | Tipo de página | Referencias | Lo que tomamos | Plantilla |
|---|---|---|---|---|
| Teatro | Compañía | La Mona Ilustre, Complicité | Obras, elenco, prensa, funciones para colegios ("Contrata una función") | `teatro-compania` |
| Teatro | Sala / centro cultural | GAM, Timbre 4 | Hoy y próximamente, planifica tu visita, accesibilidad, logos de aliados, menú tipo drawer | `teatro-sala` (menú lateral) |
| Teatro | Festival | Teatro a Mil | Programación con pestañas por día, auspiciadores por categoría, convocatoria | `teatro-festival` |
| Música | Banda / artista | Arctic Monkeys | Foto a todo el ancho, fechas de gira, videos, booking | `musica-banda` |
| Música | Sala / productora | La Trastienda, Santander Arena | Cartelera, planifica tu visita (cómo llegar, estacionamiento, objetos), slider | `musica-productora` |
| Música | Festival | Lollapalooza Chile, Cosquín Rock | Line-up, entradas siempre visibles (menú fijo), aftermovie, info práctica, sponsors | `musica-festival` |
| Fiestas | Marca recurrente | Bresh | Manifiesto, "revive la fiesta" (galería + aftermovie), DJs | `fiestas-productora` |
| Fiestas | Fiesta temática | I Love Reggaeton | Página única con anclas (tickets, line-up, video, recinto) | `fiestas-tematica` |
| Fiestas | Universitarias / privadas | (inferido; vive en Instagram + ticketera) | Paquetes, requisitos en acordeón, cotización | `fiestas-privadas` |
| Clubs | Discoteca | Club La Feria, fabric, Berghain | Noches de la semana, residentes, mesas y cumpleaños, política de entrada | `clubs-discoteca` |
| Clubs | Colectivo / sello | Keinemusik | Minimal y con imágenes: fechas, crew, sets | `clubs-colectivo` (menú lateral) |
| Clubs | Bar con DJ | Public Records | El lugar, horarios, agenda, reservas | `clubs-bar` |
| Stand-up | Comediante | José Ramones | Fechas, clips, prensa, bio, contrataciones | `standup-comediante` |
| Stand-up | Club / ciclo | Comedy Cellar | Cartelera semanal, formatos (open mic, estelar), comediantes, condiciones de la sala | `standup-club` |
| Stand-up | Productora | Boom Chicago | Shows, elenco, empresas, grupos, clases, reseñas | `standup-productora` |
| Seminarios | Congreso anual | Nerdearla, Web Summit, Congreso Futuro | Speakers, programa por día, sede, sponsors por nivel, FAQ, "Quiero ser sponsor" | `seminarios-congreso` |
| Seminarios | Ciclo / meetup | JavaScript Chile (Luma), DevFest Santiago | Próximas charlas, speakers, charlas grabadas, "Postula tu charla" | `seminarios-ciclo` |
| Seminarios | Corporativo | Cumbre SONAMI | Programas, formatos, clientes, solicitar propuesta (tono formal) | `seminarios-corporativo` |
| Talleres | Tallerista | Experiencias de Airbnb | Lo que harás, quién enseña, trabajos, requisitos | `talleres-tallerista` |
| Talleres | Espacio con varios talleres | Fuentetaja, Timbre 4 (escuela) | Disciplinas en pestañas, calendario, profes, el espacio, empresas | `talleres-estudio` (menú lateral) |
| Talleres | Para empresas | Mud Gang, ClassBento, Adecco | Beneficios, formatos por tamaño de grupo, clientes, cotizar | `talleres-empresas` |
| Academias | Baile | Broadway Dance Center | Horarios por nivel en pestañas, profes, clase de prueba, FAQ para nuevos | `academias-baile` |
| Academias | Música | Projazz | Admisión, instrumentos, docentes, muestras, "Quiero información" | `academias-musica` |
| Academias | Cursos | Coderhouse, Desafío Latam | Catálogo, programa por módulos, metodología, docentes, testimonios en carrusel | `academias-cursos` |

Más `general-productora` (estilo Clásico) para productoras multiformato.

Se omitieron a propósito, porque obligarían a inventar datos o a sumar integraciones:

- contadores de cifras ("+500 eventos");
- cuentas regresivas;
- merch;
- newsletter;
- mapas embebidos.

## Reglas del copy (no inventar)

El copy que trae una plantilla se limita a lo que es cierto para cualquier productora que vende con AI Tickets:

- cómo se compra;
- la entrada por correo con QR;
- la acreditación con QR;
- los certificados de asistencia;
- las listas de invitados;
- el formulario de contacto.

Lo que solo sabe el productor va vacío: nombres, bios, horarios, edad mínima, dress code, opiniones, fotos y logos.
Así se comporta lo vacío:

- En la vista previa del editor se ve con un texto de ayuda, junto con el aviso "complétala para que se vea en tu
  sitio".
- Se guarda tal cual, para que el productor lo termine después (`sanitizeSections(..., { keepEmpty: true })`).
- El sitio público no lo muestra hasta que esté completo (`itemIsFilled` y `isComplete` en `SitePage.vue`).

Los tests de `tests/unit/site-presets.test.mjs` revisan que ninguna plantilla traiga personas ni opiniones inventadas.
También exigen que el contraste entre texto y fondo de cada paleta sea de al menos 7:1.

## Arquitectura

```
src/lib/siteTemplates.ts     tipos de sección, variantes de diseño (SECTION_LAYOUTS), menú (SITE_NAV_STYLES),
                             saneamiento, límites de medios, applyTextEdit (edición en la vista previa)
src/lib/sitePresets.ts       las 25 plantillas completas y applyPreset
src/components/sites/SitePage.vue + sections/Sn*.vue
                             render del sitio (SSR, sin hidratar) y vista previa en vivo (hidratada, live)
src/lib/siteInteractions.js  pestañas, carruseles, <dialog>, menú del celular y videos por delegación (sin Vue)
src/lib/siteLiveEditing.js   edición de textos con contenteditable dentro de la vista previa
src/components/dashboard/site/SiteBuilder.vue + builder/*
                             editor visual (lista, inspector, plantillas, estilo, campos de foto y video)
src/pages/api/sites/video.ts subida de videos del sitio (URL firmada + verificación)
```

El sitio público se renderiza en el servidor sin hidratar. Las interacciones (pestañas, carruseles, ventanas, menú del
celular) funcionan con atributos `data-sn-*` y un solo script con delegación de eventos, así que no se manda Vue al
visitante. La vista previa del editor sí se hidrata (`client:load`), redibuja con el borrador y usa el mismo script.

### Protocolo editor ↔ vista previa (postMessage, mismo origen)

| Dirección | Mensaje | Para qué |
|---|---|---|
| vista previa → editor | `site-preview-ready` | pedir el borrador |
| vista previa → editor | `site-edit { target, value }` | texto editado (`applyTextEdit`) |
| vista previa → editor | `site-select { sectionId }` | abrir los ajustes de la sección |
| vista previa → editor | `site-shortcut { action }` | deshacer, rehacer o guardar con el foco en la vista previa |
| editor → vista previa | `site-draft { draft }` | redibujar |
| editor → vista previa | `site-select { sectionId, scroll }` | resaltar la sección |
| editor → vista previa | `site-open-dialog { id }` | mostrar la ventana de un botón |

Cada texto editable lleva `data-edit="<destino>"`: `site.title`, `<sección>.<campo>` o `<sección>.items.<n>.<campo>`.
Además tiene un solo nodo de texto, para que Vue pueda reemplazarlo sin chocar con lo que escribió el productor. La
vista previa aplica la edición a su copia del borrador antes de avisar al editor, así nunca se desincroniza aunque el
productor deshaga muy rápido.

## Medios: límites y optimización

| | Límite | Optimización |
|---|---|---|
| Fotos de las secciones | 60 por sitio (`MAX_SITE_IMAGES`), 24 por galería, 16 personas, 5 MB por archivo (30 MB de origen) | Se achican en el navegador (`prepareImageForUpload`, lado mayor 2400 px). El servidor (`storeOptimizedImage`) corrige la orientación, quita metadatos y GPS, acota el lado mayor según el uso (retrato 1200 px, galería 2000 px) y recomprime con mozjpeg. Se sirven con Netlify Image CDN y `srcset`. |
| Videos | 3 por sitio (`MAX_SITE_VIDEOS`), 50 MB y 3 min cada uno | Mismo flujo que el video del evento: URL firmada directa a Storage, verificación de tipo y peso en el servidor, póster sacado del video y optimizado, reproducción sin sonido solo mientras se ve en pantalla. |

El límite se revisa en dos momentos:

- **En el editor:** muestra el contador "n/60 fotos · n/3 videos" y no deja subir más.
- **Al guardar (`PUT /api/sites`):** responde 400 si se pasa el límite. También descarta videos que no estén en la
  carpeta de la productora (`site-videos/<org>/`) y pósters que no sean del bucket. Además borra del Storage los
  videos que ya no usa ninguna sección.

## IA

`/api/sites/ai` le pasa a la IA estos elementos:

- las plantillas completas;
- los tipos de menú;
- las variantes de diseño;
- los campos nuevos (pestañas, personas, botón con ventana, menú).

Si el productor pide una plantilla, la IA devuelve su key en `preset` y el servidor la aplica con `applyPreset`. Esa
plantilla reemplaza secciones, estilo y menú, y conserva el logo, la portada y "Sobre nosotros".

La IA no ve ni puede inventar videos: cada sección conserva el suyo. Las imágenes siguen restringidas a las que ya
estaban en el borrador.

## Pruebas

- `tests/unit/site-templates.test.mjs`: saneamiento de los componentes nuevos, `keepEmpty`, `applyTextEdit`, videos,
  límites y menú.
- `tests/unit/site-presets.test.mjs`: las 25 plantillas (cobertura por nicho, secciones válidas, anclas, nada
  inventado, contraste).
- `tests/unit/sites-routes.test.mjs`: guardado parcial, propiedad de los videos, límites, borrado de videos sin uso,
  `/api/sites/video` e IA con plantillas, menú y videos.
- `tests/e2e/site-builder.spec.ts`: sobre las páginas de prueba sin BD `/__e2e/sitios/<plantilla>` y
  `/__e2e/sitio-editor` (solo en `astro dev` con `E2E_FIXTURES=1`). Cubre pestañas, carrusel, ventanas, menú del
  celular, contenido incompleto oculto y el flujo del editor (aplicar plantilla, editar en la vista previa,
  seleccionar, deshacer y rehacer, guardar).

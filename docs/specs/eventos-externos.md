# Spec: eventos externos, mapa de mercado y modelo de fechas

| | |
| --- | --- |
| Estado | **Implementado v1** (2026-11-20): `src/lib/market/`, `src/lib/admin-api/tools/market.ts`, migración `202611200100_external_events.sql` (productoras, lugares, eventos, funciones y calendario) |
| Dónde se ve | MCP de administración. Desde 2026-11-27 los eventos externos (solo nombre, descripción, afiche, funciones, precios y link) se publican en **/panoramas** ([`panoramas.md`](panoramas.md)); productoras enlazadas, notas, fuentes y el mapa de mercado siguen siendo solo del MCP |
| Relacionado | `docs/specs/mcp-admin.md`, `docs/api/admin.md`, leads (`src/lib/admin-api/tools/leads.ts`) |

## 0. Para qué

1. **Mapear el mercado**: qué eventos hay, de qué categoría y nicho, quién los produce, dónde (lugar y ciudad),
   cuándo (una o varias funciones, temporadas y giras), si usan ticketera y cuál (o si venden por DM/transferencia) y
   a qué precio.
2. **Encontrar oportunidades**: productoras con varios eventos en otra ticketera, o sin ticketera, que todavía no
   son productores de AI Tickets (con su lead si ya existe y el nicho de lead sugerido).
3. **Empezar el módulo de estadística**: un modelo que dice si una fecha es buena para una categoría (y nicho) en
   una ciudad y recomienda fechas. Se alimenta de los eventos externos **y** de los eventos publicados de AI Tickets.

## 1. Datos

```
productora 1 ── n evento 1 ── n función n ── 1 lugar
(aitickets_external_producers)  (…_events)  (…_event_dates)  (…_venues)
```

Una **temporada o una gira es UN evento con varias funciones**; cada función tiene su día, hora, lugar y ciudad,
y su propio estado y resultado. Así una gira por Santiago, Viña y Concepción cuenta como un evento en el mapa, pero
compite en cada ciudad en su fecha.

### `aitickets_external_producers` (productoras)

`name`, `instagram`, `website`, `city`/`city_key`/`region`, `organization_id` (si ya es productor de AI Tickets),
`lead_id` (si es lead), `notes`. **`producer_key` UNIQUE** = `ig:<handle>` si se conoce el Instagram, si no
`name:<nombre normalizado>`. Al registrar se busca por Instagram, luego por nombre normalizado y luego por nombre
exacto (una productora registrada con @ se reconoce cuando llega solo con el nombre). Si una productora registrada
por nombre aparece después con su Instagram, se completa y su clave pasa a `ig:`.

### `aitickets_external_venues` (lugares)

`name`, `address`, `commune`, `city`/`city_key`/`region`, `capacity`, `notes`. **`venue_key` UNIQUE** = nombre
normalizado + ciudad normalizada. La capacidad del lugar pesa en la competencia si la función no trae la suya.

### `aitickets_external_events` (eventos)

| Grupo | Columnas |
| --- | --- |
| Qué | `name`, `name_key` (normalizado), `category` (taxonomía fija), `niche` (segmento normalizado), `tags` |
| Quién | `producer_id` |
| Ticketera | `ticketing_platform` (slug; `none` = sin ticketera; `own_site` = venta propia; NULL = no se sabe), `ticketing_url`, `price_min`, `price_max`, `is_free` |
| Origen | `source`, `source_url`, `external_id` (UNIQUE parcial con `source`), `announced_at`, `notes` |

**Categoría vs nicho.** La categoría es la taxonomía fija que usa el modelo (concierto, festival, fiesta, club,
stand_up, teatro, danza, infantil, conferencia, taller, deportes, feria, cine, otro). El nicho es el segmento dentro
de ella, texto libre normalizado con alias para no fragmentarse (`Tecno` → `techno`, `Reguetón` → `reggaeton`,
`Música urbana` → `urbano`). Al registrar un nicho que no existe en esa categoría se avisa con los ya usados. Cada
evento trae también su `lead_niche` (el nicho del pipeline de leads que corresponde a su categoría), para crear el
lead de su productora con `create_lead`.

### `aitickets_external_event_dates` (funciones)

`event_id` (CASCADE), `event_date` (día en Chile), `start_time`, `end_date` (función de varios días),
`venue_id` (SET NULL), `city`/`city_key`/`commune`/`region` (del lugar o indicadas), `capacity`, `status`
(scheduled, postponed, cancelled, completed), resultado (`sold_out`, `sold_out_at`, `sold_pct`, `attendance`),
`ticketing_url`, `notes`. **`(event_id, slot_key)` UNIQUE** con `slot_key = día | hora | lugar (o ciudad)`.

### Duplicados

- **Evento**: el mismo si llega con `event_id`, con el mismo `source + external_id`, o con el mismo nombre
  normalizado y productora (o sin productora en uno de los dos) y alguna función a ≤ 120 días. Un evento anual del
  mismo nombre, un año después, es otro evento. Al fusionar se completa (las etiquetas se suman, las notas se
  agregan) y el nombre guardado no se pisa con otra grafía.
- **Función**: la misma si coincide día, hora y lugar (o ciudad); una sin hora y otra con hora el mismo día en el
  mismo lugar también (se completa la hora).
- **Productoras y lugares duplicados** (p. ej. "Caupolicán" y "Teatro Caupolicán") se fusionan con
  `update_external_producer` / `update_external_venue` y `merge_into_id`.

**Ciudades.** Las comunas del Gran Santiago se agrupan en `santiago`; Viña, Valparaíso, Concón, Quilpué y Villa
Alemana en `gran_valparaiso`; lo mismo con Gran Concepción y La Serena/Coquimbo. La región se infiere de la ciudad.

### `aitickets_market_calendar`

Fechas que el modelo no puede calcular: `holiday` (feriado regional o especial), `bridge_holiday` (interferiado),
`no_holiday` (anula un feriado calculado), `school_vacation`, `election` (ley seca), `mega_event`, `high_demand`,
`low_demand`, `blackout`, `other`. Alcance opcional por región, ciudad y `categories`; `impact` = multiplicador
(0.1 a 2; vacío = el de su tipo).

Los **feriados nacionales se calculan** en `src/lib/market/calendar.ts` según la ley: fijos, Semana Santa (Pascua),
Pueblos Indígenas (solsticio; tabla 2022-2030 y fórmula aproximada fuera de ella), San Pedro y San Pablo y Encuentro
de Dos Mundos trasladados (Ley 19.668), 17 de septiembre si es lunes y 20 si es viernes, Iglesias Evangélicas
(Ley 20.299) y 2 de enero si es lunes. Los interferiados y feriados regionales se cargan a mano.

### Eventos de AI Tickets

`loadInternalMarketEvents` lleva los eventos **publicados** (sin demo ni cancelados) al mismo formato: una fila por
función y ciudad, categoría desde `category_tags`, ciudad y capacidad desde el recinto, precios desde
`event_tickets`, productora = la organización y, si ya pasó y tiene una sola función con capacidad conocida, el %
vendido. Se marcan como ticketera `aitickets`. Si un evento de AI Tickets también se registró como externo, se
cuenta una vez.

## 2. Herramientas (MCP de admin)

| Herramienta | Qué hace |
| --- | --- |
| `register_external_events` | Alta masiva (1-50 eventos, cada uno con 1-200 funciones): crea o reutiliza productora y lugares, evita duplicados (`merge`/`skip`), `dry_run`, advertencias por ítem (ticketera nueva, nicho nuevo, sin productora) |
| `list_external_events` / `get_external_event` | Listar con resumen de funciones (cuántas, primera/última/próxima, ciudades, lugares, si es gira) y filtros (categoría, nicho, ciudad, ticketera, productora, lugar, solo giras…); detalle con todas las funciones y los otros eventos de esas noches |
| `update_external_event` | Editar el evento (null borra), cambiar o desvincular la productora, `add_dates` / `update_dates` / `remove_date_ids`, `set_status_all_dates`, `add_note` |
| `delete_external_events` | Borra eventos con sus funciones, con confirmación en dos pasos |
| `list_external_producers` / `update_external_producer` | Productoras con su actividad (eventos, funciones, categorías, nichos, ticketeras, ciudades); editar, enlazar a productor o lead, fusionar duplicados o borrar |
| `list_external_venues` / `update_external_venue` | Lugares con su actividad; editar (un cambio de ciudad se propaga a sus funciones), fusionar duplicados o borrar |
| `get_market_map` | Panorama: participación por ticketera, categorías con sus nichos, ciudades, lugares, giras, precios, días, productoras, oportunidades y calidad de datos |
| `evaluate_event_date` | Nota 0-100, veredicto, factores, competidores (con productora, nicho y ticketera), calendario, precio vs mercado y alternativas |
| `recommend_event_dates` | Ranking de fechas en un rango (máx. 180 días) y mejor fecha por semana; para una gira, por ciudad |
| `list_market_calendar` / `upsert_market_calendar` / `delete_market_calendar_entries` | Feriados calculados, fines de semana largos y fechas especiales |

Prompts: `mapear_eventos` (cargar desde una fuente con `dry_run` primero) y `evaluar_fecha`.

## 3. El modelo de fechas (v1)

**Es heurístico y explicable, no ML.** Con decenas de eventos, un modelo entrenado sobreajusta y no se puede
auditar. Este parte de supuestos razonables (priors) y los corrige con los datos registrados mediante *shrinkage*:
con 0 datos manda el supuesto, con cientos mandan los datos. Cada factor devuelve su multiplicador y una explicación.

```
nota = 100 × día_semana^0.6 × temporada × calendario × competencia × quincena × resultados × anticipación
```

| Factor | Cómo se calcula |
| --- | --- |
| Día de la semana | Preferencia de la categoría por día: prior por categoría (`CATEGORY_INFO.weekday`) + días observados de la categoría en la ciudad (o Chile si hay < 15), con fuerza de prior 25. **Día efectivo**: la víspera de un día libre se comporta como viernes para eventos de noche, un feriado seguido de otro libre como sábado, el último libre como domingo (con 10% de descuento; para formación el feriado sí castiga). Una función antes de las 06:00 cuenta como la noche anterior |
| Temporada | Prior por mes y categoría (verano bajo en Santiago, festivales al aire libre en verano, conferencias bajas en enero-febrero). Los destinos de verano suben en enero y febrero |
| Calendario | Fin de semana largo (×0.88 en ciudades que se vacían, ×1.1 en destinos), Fiestas Patrias, Nochebuena, Navidad, 26-30 dic, 31 dic (×1.15 fiestas, ×0.35 el resto), 1 de enero y las entradas de `aitickets_market_calendar` |
| Competencia | Presión = Σ afinidad × ciudad × cercanía en días (1, 0.3, 0.12, 0.05) × tamaño (√(capacidad/400), 0.5 a 4), con cada **función** en su ciudad (una gira compite en cada ciudad en su fecha; un evento nunca compite consigo mismo). Afinidad: misma categoría = 1; con nicho conocido en ambos, mismo nicho = 1 y otro nicho de la misma categoría = 0.6 (una fiesta techno y una de reggaetón se quitan menos público); entre categorías afines (fiesta-club 0.8, stand_up-teatro 0.5…) el mismo nicho suma ×1.3. Un evento de 8.000+ personas el mismo día compite aunque sea de otra categoría. Se compara con la **mediana del mismo día de la semana ±8 semanas** (piso 1): ratio ≤ 0.6 = sin castigo; más arriba baja hasta ×0.3 |
| Anunciados | Una fecha lejana tiene menos eventos anunciados: la presión futura se divide por la fracción anunciada a esa distancia (prior 95% a 7 días … 20% a 180+, corregido con `announced_at`) |
| Quincena | ×1.04 cerca del pago de sueldos (días 28-7), ×0.97 en la segunda quincena (15-24). Solo ocio |
| Resultados | Con ≥ 8 funciones de la categoría con resultado: tasa de agotados ese día vs la general, con shrinkage (×0.85 a ×1.15) |
| Anticipación | Muy poco tiempo para vender baja la nota (conciertos y festivales necesitan más) |

Veredicto: ≥ 75 buena, 60-74 aceptable, 40-59 riesgosa, < 40 mala. **Confianza** (alta, media, baja) según cuántos
eventos del tipo hay en la ciudad, cuántos registrados esa semana y cuánto falta.

### Supuestos y límites (decirlos siempre)

- Los priors son supuestos de dominio, no medidos. Se corrigen solos a medida que hay datos.
- **Cobertura**: si solo se registran algunos eventos, la competencia está subestimada. El modelo compara contra
  semanas con datos, pero no puede ver lo que nadie registró.
- **Sesgo de registro**: contar eventos por mes depende de cuándo se mapeó; por eso la temporada usa priors (y
  tasas de agotados, no conteos) y la competencia se mide relativa a semanas cercanas.
- "Muchos eventos un sábado" significa demanda (los productores eligen donde hay público) **y** competencia: el
  modelo lo separa en día de la semana (demanda) y competencia (relativa a lo normal para ese día).
- Sin resultados (`sold_out`, `sold_pct`, `attendance`) el modelo no aprende qué fechas funcionaron. Registrar
  resultados es lo que más lo mejora.

## 4. Próximos pasos

1. **Carga sistemática**: un importador programado desde Passline/Puntoticket/Ticketplus (ya existe
   `scripts/passline-watch-local.mjs` para leads) que llame a la misma normalización y deduplicación. La tarea
   programada propuesta (con `description` e `image_url` para /panoramas) está en [`panoramas.md`](panoramas.md) §6.
2. **Observaciones en el tiempo**: guardar disponibilidad por tanda cada N días → velocidad de venta y fecha de
   agotado, el mejor indicador de demanda.
3. **Calibrar** los priors con los datos acumulados (backtesting: ¿las fechas con nota alta se agotaron más?) y
   recién ahí pasar a un modelo estadístico (p. ej. regresión logística de "agotó" con los mismos factores).
4. Cuando el modelo esté calibrado, decidir si se muestra a los productores (p. ej. al elegir la fecha en el panel).

# Spec: eventos externos, mapa de mercado y modelo de fechas

| | |
| --- | --- |
| Estado | **Implementado v1** (2026-11-20): `src/lib/market/`, `src/lib/admin-api/tools/market.ts`, migración `202611200100_external_events.sql` |
| Dónde se ve | **Solo en el MCP de administración.** No hay página, panel ni API pública que lo muestre |
| Relacionado | `docs/specs/mcp-admin.md`, `docs/api/admin.md`, leads (`src/lib/admin-api/tools/leads.ts`) |

## 0. Para qué

1. **Mapear el mercado**: qué eventos hay, de qué tipo, en qué ciudad, si usan ticketera y cuál (o si venden por
   DM/transferencia), a qué precio y quién los organiza.
2. **Encontrar oportunidades**: organizadores con varios eventos en otra ticketera, o sin ticketera, que todavía no
   son productores de AI Tickets (con su lead si ya existe).
3. **Empezar el módulo de estadística**: un modelo que dice si una fecha es buena para un tipo de evento en una
   ciudad y recomienda fechas. Se alimenta de los eventos externos **y** de los eventos publicados de AI Tickets.

## 1. Datos

### `aitickets_external_events`

Una fila por **función y día** (una temporada de teatro de 8 funciones = 8 filas con el mismo `series_key`).

| Grupo | Columnas |
| --- | --- |
| Qué | `name`, `event_type` (taxonomía en código), `genre`, `tags` |
| Cuándo | `event_date` (día en Chile), `start_time` (hora local), `end_date` (festivales de varios días) |
| Dónde | `city`, `city_key` (normalizada), `commune`, `region`, `venue_name`, `capacity` |
| Quién | `organizer_name`, `organizer_instagram`, `organizer_website`, `organizer_key` (normalizada), `organization_id` (si es productor de AI Tickets), `lead_id` |
| Ticketera | `ticketing_platform` (slug; `none` = sin ticketera; `own_site` = venta propia; NULL = no se sabe), `ticketing_url`, `price_min`, `price_max`, `is_free` |
| Resultado | `status` (scheduled, postponed, cancelled, completed), `sold_out`, `sold_out_at`, `sold_pct`, `attendance` |
| Origen | `source`, `source_url`, `external_id`, `announced_at` |
| Control | `dedupe_key` (UNIQUE), `notes`, `created_at`, `updated_at` |

**Duplicados.** `dedupe_key = nombre normalizado | día | ciudad normalizada` (UNIQUE) y un índice único parcial
`(source, external_id)`. Registrar dos veces el mismo evento desde fuentes distintas lo **completa** en vez de
duplicarlo (`on_duplicate = merge`). Dos funciones del mismo show el mismo día quedan como una (para el mapa y la
competencia es lo correcto).

**Ciudades.** Las comunas del Gran Santiago se agrupan en `santiago`; Viña, Valparaíso, Concón, Quilpué y Villa
Alemana en `gran_valparaiso`; lo mismo con Gran Concepción y La Serena/Coquimbo. La región se infiere de la ciudad.

### `aitickets_market_calendar`

Fechas que el modelo no puede calcular: `holiday` (feriado regional o especial), `bridge_holiday` (interferiado),
`no_holiday` (anula un feriado calculado), `school_vacation`, `election` (ley seca), `mega_event`, `high_demand`,
`low_demand`, `blackout`, `other`. Alcance opcional por región, ciudad y tipos de evento; `impact` = multiplicador
(0.1 a 2; vacío = el de su tipo).

Los **feriados nacionales se calculan** en `src/lib/market/calendar.ts` según la ley: fijos, Semana Santa (Pascua),
Pueblos Indígenas (solsticio; tabla 2022-2030 y fórmula aproximada fuera de ella), San Pedro y San Pablo y Encuentro
de Dos Mundos trasladados (Ley 19.668), 17 de septiembre si es lunes y 20 si es viernes, Iglesias Evangélicas
(Ley 20.299) y 2 de enero si es lunes. Los interferiados y feriados regionales se cargan a mano.

### Eventos de AI Tickets

`loadInternalMarketEvents` lleva los eventos **publicados** (sin demo ni cancelados) al mismo formato: una fila por
función, tipo desde `category_tags`, ciudad y capacidad desde el recinto, precios desde `event_tickets` y, si ya
pasó y tiene una sola función con capacidad conocida, el % vendido. Se marcan como ticketera `aitickets`. Si un
evento de AI Tickets también se registró como externo, se cuenta una vez.

## 2. Herramientas (MCP de admin)

| Herramienta | Qué hace |
| --- | --- |
| `register_external_events` | Alta masiva (1-100), con `dry_run`, duplicados (`merge`/`skip`) y advertencias por ítem |
| `list_external_events` / `get_external_event` | Listar con filtros y conteos; detalle con funciones hermanas y eventos de esa noche |
| `update_external_event` | Editar (null borra), registrar el resultado, `add_note`, enlazar productor o lead |
| `delete_external_events` | Borrado con confirmación en dos pasos |
| `get_market_map` | Panorama: participación por ticketera, tipos, ciudades, precios, días, organizadores, oportunidades, calidad de datos |
| `evaluate_event_date` | Nota 0-100, veredicto, factores, competidores, calendario, precio vs mercado y alternativas |
| `recommend_event_dates` | Ranking de fechas en un rango (máx. 180 días) y mejor fecha por semana |
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
| Día de la semana | Preferencia del tipo por día: prior por tipo (`TYPE_INFO.weekday`) + días observados del tipo en la ciudad (o Chile si hay < 15), con fuerza de prior 25. **Día efectivo**: la víspera de un día libre se comporta como viernes para eventos de noche, un feriado seguido de otro libre como sábado, el último libre como domingo (con 10% de descuento; para formación el feriado sí castiga). Una función antes de las 06:00 cuenta como la noche anterior |
| Temporada | Prior por mes y tipo (verano bajo en Santiago, festivales al aire libre en verano, conferencias bajas en enero-febrero). Los destinos de verano suben en enero y febrero |
| Calendario | Fin de semana largo (×0.88 en ciudades que se vacían, ×1.1 en destinos), Fiestas Patrias, Nochebuena, Navidad, 26-30 dic, 31 dic (×1.15 fiestas, ×0.35 el resto), 1 de enero y las entradas de `aitickets_market_calendar` |
| Competencia | Presión = Σ afinidad de tipo × ciudad × cercanía en días (1, 0.3, 0.12, 0.05) × tamaño (√(capacidad/400), 0.5 a 4). Un evento de 8.000+ personas el mismo día compite aunque sea de otro tipo. Se compara con la **mediana del mismo día de la semana ±8 semanas** (piso 1): ratio ≤ 0.6 = sin castigo; más arriba baja hasta ×0.3 |
| Anunciados | Una fecha lejana tiene menos eventos anunciados: la presión futura se divide por la fracción anunciada a esa distancia (prior 95% a 7 días … 20% a 180+, corregido con `announced_at`) |
| Quincena | ×1.04 cerca del pago de sueldos (días 28-7), ×0.97 en la segunda quincena (15-24). Solo ocio |
| Resultados | Con ≥ 8 eventos del tipo con resultado: tasa de agotados ese día vs la general, con shrinkage (×0.85 a ×1.15) |
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
   `scripts/passline-watch-local.mjs` para leads) que llame a la misma normalización.
2. **Observaciones en el tiempo**: guardar disponibilidad por tanda cada N días → velocidad de venta y fecha de
   agotado, el mejor indicador de demanda.
3. **Calibrar** los priors con los datos acumulados (backtesting: ¿las fechas con nota alta se agotaron más?) y
   recién ahí pasar a un modelo estadístico (p. ej. regresión logística de "agotó" con los mismos factores).
4. Cuando el modelo esté calibrado, decidir si se muestra a los productores (p. ej. al elegir la fecha en el panel).

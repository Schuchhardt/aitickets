# Leads desde Passline (seguimiento diario + contacto manual)

Objetivo: saber qué productoras y recintos están vendiendo hoy en Passline (Chile), juntar sus datos de
contacto **públicos** y dejarlos como leads para escribirles a mano desde Gmail.

Código: `netlify/lib/leads/passline-watch.mjs` (librería), `netlify/lib/firecrawl.mjs` (búsqueda),
`netlify/functions/passline-watch` (programada) y `netlify/functions/passline-watch-background` (trabajo).
Migración: `db/migrations/202609300100_competitor_events.sql`.

## Restricción legal y técnica (no negociable)

- `passline.com` y **todos** sus subdominios están detrás de un desafío anti-bots de Cloudflare
  (`cf-mitigated: challenge`). Visitarlos con un bot sería evadir esa protección.
- Por eso **nunca** se visita ninguna URL de passline: ni `fetch`, ni Firecrawl scrape/crawl/map/extract, ni
  navegadores headless, ni proxies. Los eventos se descubren **solo** con resultados de búsqueda web (título,
  snippet y URL que devuelve el buscador) usando `POST https://api.firecrawl.dev/v2/search` **sin**
  `scrapeOptions`.
- Guardias en el código (con tests en `tests/unit/passline-leads.test.mjs`):
  - `firecrawl.mjs` → `assertNoForbiddenFetch` lanza si una llamada pide `scrapeOptions` en la búsqueda o
    cualquier otro endpoint con una URL de passline.
  - `domains.mjs` → `NEVER_FETCH_HOSTS = ['passline.com']`; `enrich.mjs` rechaza passline en cada salto de
    redirección y `crawlSite` nunca visita ticketeras.
- El enriquecimiento solo visita el **sitio propio** del productor (robots.txt según RFC 9309, anti-SSRF,
  máx. 5 páginas, User-Agent `AITicketsBot` con opt-out en `/bot`). De Instagram solo se usa el handle que
  aparece en la URL de un resultado de búsqueda (no se visita Instagram).
- Cada dato de contacto guarda su fuente (`contact_sources`: campo, valor, URL, fecha). Se respetan las
  listas de supresión (`aitickets_suppressions`) por correo y por dominio.

## Qué hace cada corrida

1. Corre las consultas configuradas (`LEADS_PASSLINE_QUERIES` o la lista por defecto: stand-up, comedia,
   teatro y música en vivo en Santiago, Providencia, Ñuñoa, Valparaíso, Viña, Quilpué y Concepción).
2. Se queda solo con URLs `passline.com/eventos/<slug>`; extrae título, recinto, comuna, fecha y categoría con
   regex y, para los eventos nuevos, con **una** llamada batch a Claude (`ANTHROPIC_MODEL_FAST`, por defecto
   `claude-haiku-4-5`, con tope de tokens por corrida). El productor solo se guarda si el snippet lo nombra
   explícitamente; nunca se adivina.
3. `aitickets_competitor_events`: una fila por URL (`times_seen`, `first_seen_at`, `last_seen_at`).
4. Agrupa por productor; si no se conoce, el recinto pasa a ser el lead (`lead_type = 'venue'`). Upsert en
   `aitickets_leads` con `source = 'passline_search'`, `status = 'new'`, `manual_only = true`, cantidad de
   eventos (`events_on_passline`) y último evento (`last_passline_event`). **Nunca** cambia el `status` de un
   lead existente (contactado, suprimido, convertido...).
5. Enriquece hasta `LEADS_ENRICH_PER_RUN` (15) leads sin contactos: busca `"<nombre>" contacto` y
   `"<nombre>" instagram`, toma el primer sitio cuyo dominio corresponde al nombre (nunca ticketeras, redes,
   prensa ni agregadores), visita ese sitio para encontrar correo y WhatsApp públicos.
6. Resumen a Slack (`SLACK_WEBHOOK_URL`) si hubo novedades o errores.

`manual_only = true` hace que el outreach automático (enriquecimiento, secuencias de Instantly,
`aitickets_claim_outreach_batch`) **nunca** tome estos leads. No se envía ningún correo automático.

## Configuración (Netlify → Environment variables, contexto Production)

| Variable | Default | Uso |
|---|---|---|
| `LEADS_PASSLINE_ENABLED` | `false` | Interruptor de la corrida diaria |
| `FIRECRAWL_API_KEY` | — | Obligatoria; sin ella la corrida se omite |
| `LEADS_PASSLINE_QUERIES` | lista por defecto | Consultas separadas por `;` |
| `LEADS_ENRICH_PER_RUN` | `15` | Leads a enriquecer por corrida |
| `LEADS_FIRECRAWL_CREDITS_PER_RUN` | `150` | Tope de créditos de Firecrawl |
| `LEADS_PASSLINE_TOKENS_PER_RUN` | `60000` | Tope de tokens de Claude |
| `ANTHROPIC_MODEL_FAST` | `claude-haiku-4-5` | Modelo de extracción |

La fila `passline_search` de `aitickets_lead_sources` también apaga la fuente (`enabled = false`), y ahí
queda `last_run_at` / `last_result` de cada corrida.

Horario: `0 11 * * *` (11:00 UTC ≈ 08:00 en Chile). Disparo manual en producción:

```bash
curl -X POST "https://aitickets.cl/.netlify/functions/passline-watch-background" \
  -H "x-internal-secret: $INTERNAL_API_SECRET"
```

## Correr en local

```bash
# Simulación: busca, extrae y enriquece, pero NO escribe en la BD (solo la lee: lista de supresión y leads
# existentes). Guarda el plan en leads/dry-run-<fecha>.json
node --env-file=.env scripts/passline-watch-local.mjs --dry-run

# De verdad (escribe en la BD compartida de producción: usar con cuidado)
node --env-file=.env scripts/passline-watch-local.mjs

# Cargar el archivo local passline_rm.json (sin búsquedas ni Claude; agrupa por recinto y guarda el id
# numérico del productor como producer_ref)
node --env-file=.env scripts/passline-watch-local.mjs --seed-json passline_rm.json --dry-run
node --env-file=.env scripts/passline-watch-local.mjs --seed-json passline_rm.json
```

Opciones: `--no-enrich`, `--out <archivo.json>`. En local no hace falta `LEADS_PASSLINE_ENABLED` (correr el
script ya es la decisión), pero sí `FIRECRAWL_API_KEY` (salvo `--seed-json`) y siempre `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` (en `--dry-run` solo para leer la lista de supresión y detectar duplicados).
Sin `ANTHROPIC_API_KEY` se usa solo la heurística.

Supresión y duplicados: si el dominio o el correo encontrado está en `aitickets_suppressions`, el lead pasa a
`suppressed` y no sale en el CSV. Si otro lead (outreach automático, contactado, perdido o cliente) ya tiene ese
dominio o correo, el lead de Passline se funde en él (eventos, `source_refs`, último evento) sin tocar su status
y queda `invalid` con `invalid_reason = 'duplicate_of:<id>'`.

## Exportar el CSV de leads

```bash
node --env-file=.env scripts/export-leads.mjs                       # desde la BD → leads/leads-<fecha>.csv
node --env-file=.env scripts/export-leads.mjs --all                 # incluye suprimidos, inválidos y duplicados
node --env-file=.env scripts/export-leads.mjs --input leads/dry-run-<fecha>.json   # desde un dry-run
```

Antes de escribir el CSV, el script vuelve a revisar cada lead (solo lecturas) contra `aitickets_suppressions` y
contra los demás leads con el mismo dominio/correo, y los omite. Un plan de dry-run generado sin revisar la lista
de supresión (`suppressionChecked: false`) no se exporta.

`leads/` está en `.gitignore` (contiene datos de contacto: nunca al repo). Columnas: `prioridad, nombre, tipo,
ciudad, eventos_passline, ultimo_evento, fecha_ultimo_evento, url_evento_passline, web, instagram, email,
whatsapp, fuentes, estado, notas`.

Prioridad (0-100) = recencia (evento en los próximos 60 días: 40) + frecuencia (5 por evento, máx. 30) +
categoría (stand-up/comedia/teatro: 30; música en vivo: 15; otras: 5).

Al escribir desde Gmail: identificarse, decir de dónde salió el dato (su sitio o Instagram público), ofrecer
darse de baja, y registrar en la BD cualquier "no me escriban más" como supresión.

## Diferenciador para productores que ya venden en Passline

Para el productor, Passline y AI Tickets se ven iguales: ninguno le cobra comisión. El mensaje no puede ser
"somos gratis". Usa solo lo aprobado en `netlify/lib/outreach/sales-kb.mjs` y lo que puedas verificar:

1. **Su propia web de eventos, gratis y lista al registrarse** (`aitickets.cl/o/<productora>`, con plantillas,
   banner, formulario de contacto y cartelera con venta integrada). Es lo más concreto para una productora de
   stand-up o teatro que hoy vende desde el link de Passline en la bio de Instagram.
2. **Plata antes**: transferencia 48 a 72 horas después de cada función. Antes de usarlo como comparación,
   confirmar a mano el plazo de liquidación de Passline (en `src/data/comparisons.ts` está marcado como
   `TODO(verificar)`).
3. **Cargo al público más bajo y transparente**: 8% + IVA sobre la entrada (≈ 9,5% en total). Según tarifas
   vigentes de Passline informadas a productores (sep 2026), Passline cobra al comprador 15%, y 13% en entradas
   de menos de $15.000 (`src/data/competitor-fees.mjs`). Ej.: entrada de $10.000 → Passline $11.300,
   AI Tickets $10.952. Cita siempre la fuente y la fecha; si el productor tiene otra tarifa negociada, usa la suya.
4. **QR y check-in desde el celular**, sin equipos extra.

Personaliza con el dato del CSV: "vi que tienes *<último evento>* el *<fecha>*".

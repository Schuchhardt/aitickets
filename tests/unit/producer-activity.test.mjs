// Bitácora de uso del panel de productores: saneamiento de textos y lotes del navegador, registro de páginas en el
// layout, endpoint /api/dashboard/journal, análisis (sesiones, tiempo por sección, fricción) y las herramientas del
// MCP de admin get_producer_activity y list_dashboard_issues. Supabase falso.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
let session

vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e) }))
vi.mock('../../src/lib/supabaseServer', () => ({
  getSessionContext: async () => session,
  jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}))

const { redactText, MAX_BATCH_EVENTS } = await import('../../src/lib/activityShared.js')
const { sanitizeActivityBatch, recordDashboardPageView, deviceFromUserAgent, cleanQuery, eventIdFromPath } = await import('../../src/lib/producerActivity.ts')
const { buildSessions, detectFriction, summarizeSession, aggregateSections, groupErrors, timeline, fmtDuration } = await import('../../src/lib/producerActivityAnalysis.ts')
const journal = await import('../../src/pages/api/dashboard/journal.ts')
const { runAdminTool } = await import('../../src/lib/admin-api/registry.ts')
const { getAdminTool } = await import('../../src/lib/admin-api/tools/index.ts')
const { adminToolsList, ADMIN_PROMPTS } = await import('../../src/lib/admin-api/mcp.ts')

const SITE = 'https://aitickets.cl'
const PV = '11111111-1111-4111-8111-111111111111'
const PV2 = '22222222-2222-4222-8222-222222222222'
const MIN = 60_000

const SESSION = { authUser: { id: 'auth-1' }, dbUser: { id: 1, name: 'Ana', organization_id: 7, role: 'producer', active: true } }

beforeEach(() => {
  session = SESSION
  db = createFakeSupabase({
    tables: {
      organizations: [
        { id: 7, public_name: 'Productora Siete' },
        { id: 8, public_name: 'Ocho Eventos' },
      ],
      users: [
        { id: 1, name: 'Ana', organization_id: 7, role: 'producer', last_access_at: '2026-10-25T12:00:00.000Z', login_count: 4 },
        { id: 2, name: 'Beto', organization_id: 7, role: 'editor' },
        { id: 3, name: 'Oscar', organization_id: 8, role: 'producer' },
      ],
      aitickets_producer_activity: [],
      aitickets_admin_audit: [],
    },
  })
})

afterEach(() => {
  delete process.env.PRODUCER_ACTIVITY_ENABLED
})

describe('redactText', () => {
  it('quita correos, RUT, teléfonos, tokens y números largos; deja montos y texto de la interfaz', () => {
    expect(redactText('Enviar a ana.perez@gmail.com')).toBe('Enviar a [correo]')
    expect(redactText('RUT 12.345.678-9 y 9876543-K')).toBe('RUT [rut] y [rut]')
    expect(redactText('Llama al +56 9 1234 5678 o 912345678')).toBe('Llama al [teléfono] o [teléfono]')
    expect(redactText('Llave aitk_Xq3vB9kLm2Np8Rt5Wz7Yc4Df6Gh1Jk0 creada')).toBe('Llave [id] creada')
    expect(redactText('Orden 01a14c2e-5b7d-7f10-9a3e-2c4d6b8f1e05 no encontrada')).toBe('Orden [id] no encontrada')
    expect(redactText('Cuenta 0012345678901')).toBe('Cuenta [número]')
    expect(redactText('Ver https://aitickets.cl/eventos/x?preview=abc123')).toBe('Ver aitickets.cl/…')
    expect(redactText('Retirar $1.250.000')).toBe('Retirar $1.250.000')
    expect(redactText('concierto-de-primavera-2296')).toBe('concierto-de-primavera-2296')
    expect(redactText('  Guardar\n  cambios  ')).toBe('Guardar cambios')
    expect(redactText('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`)
    expect(redactText(null)).toBe('')
  })
})

describe('sanitizeActivityBatch', () => {
  const batch = (events, extra = {}) => ({ v: 1, pv: PV, route: '/dashboard/events/[id]', path: '/dashboard/events/812', search: '?tab=entradas&q=juan', sent_at: 1_000_000, events, ...extra })

  it('rechaza lotes mal formados', () => {
    expect(sanitizeActivityBatch(null).ok).toBe(false)
    expect(sanitizeActivityBatch(batch([], { pv: 'no-uuid' })).ok).toBe(false)
    expect(sanitizeActivityBatch(batch([], { path: '/api/mcp' })).ok).toBe(false)
    expect(sanitizeActivityBatch(batch('x')).ok).toBe(false)
  })

  it('descarta tipos desconocidos (y page_view, que solo escribe el servidor), campos de data no permitidos y endpoints inválidos', () => {
    const r = sanitizeActivityBatch(
      batch([
        { type: 'click', at: 1_000_000, label: 'Publicar evento', target: 'Estado del evento', data: { kind: 'button', value: 'secreto', href: '/dashboard/events' } },
        { type: 'page_view', at: 1_000_000 },
        { type: 'keylog', at: 1_000_000, label: 'hola' },
        { type: 'api_error', at: 1_000_000, target: 'POST https://evil.com/x', status: 500 },
        { type: 'api_error', at: 1_000_000, target: 'POST /api/events/update', status: 400, label: 'Escribe a soporte@aitickets.cl', duration_ms: 1234, data: { method: 'POST' } },
      ]),
      1_000_000,
    )
    expect(r.ok).toBe(true)
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ type: 'click', page_view_id: PV, path: '/dashboard/events/812', route: '/dashboard/events/[id]', event_id: 812, label: 'Publicar evento', data: { kind: 'button', href: '/dashboard/events' } })
    expect(r.rows[0].data).not.toHaveProperty('value')
    expect(r.rows[1]).toMatchObject({ type: 'api_error', target: 'POST /api/events/update', status: 400, duration_ms: 1234, label: 'Escribe a [correo]' })
    expect(r.rows.every((row) => !('organization_id' in row) && !('user_id' in row))).toBe(true)
  })

  it('corrige el reloj del navegador con sent_at y acota las horas', () => {
    const now = Date.parse('2026-10-26T20:00:00.000Z')
    // El reloj del navegador va 1 h atrasado
    const sent = now - 3600_000
    const r = sanitizeActivityBatch(batch([{ type: 'click', at: sent - 5000 }, { type: 'click', at: sent + 99 * 3600_000 }, { type: 'click', at: 'x' }], { sent_at: sent }), now)
    expect(r.rows.map((x) => x.occurred_at)).toEqual([new Date(now - 5000).toISOString(), new Date(now).toISOString(), new Date(now).toISOString()])
  })

  it(`corta el lote en ${MAX_BATCH_EVENTS} hechos y guarda solo los parámetros permitidos de la URL`, () => {
    const many = Array.from({ length: 80 }, () => ({ type: 'click', at: 1 }))
    expect(sanitizeActivityBatch(batch(many)).rows).toHaveLength(MAX_BATCH_EVENTS)
    expect(cleanQuery('?tab=ads&q=juan%40mail.com&error=oauth_failed&token=abc')).toEqual({ tab: 'ads', error: 'oauth_failed' })
    expect(eventIdFromPath('/dashboard/tickets', { event: '44' })).toBe(44)
    expect(eventIdFromPath('/dashboard/events/12/edit')).toBe(12)
    expect(eventIdFromPath('/dashboard/events/create')).toBeNull()
  })
})

describe('page_view en el layout', () => {
  const astro = (url, headers = {}) => ({ url: new URL(url), request: new Request(url, { headers }), routePattern: '/dashboard/events/[id]', locals: {} })

  it('registra la página con la organización y el usuario de la sesión, la ruta, el evento, el dispositivo y de dónde llegó', async () => {
    const out = await recordDashboardPageView(
      astro('https://aitickets.cl/dashboard/events/812?tab=entradas&q=juan', {
        referer: 'https://aitickets.cl/dashboard/events',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      }),
      SESSION,
    )
    expect(out).toMatchObject({ route: '/dashboard/events/[id]' })
    const [row] = db.tables.aitickets_producer_activity
    expect(row).toMatchObject({
      organization_id: 7,
      user_id: 1,
      page_view_id: out.id,
      type: 'page_view',
      path: '/dashboard/events/812',
      event_id: 812,
      data: { query: { tab: 'entradas' }, from: '/dashboard/events', role: 'producer', device: 'mobile', browser: 'Safari', os: 'iOS' },
    })
  })

  it('apagada, sin sesión o si la tabla no existe: no rompe la página', async () => {
    process.env.PRODUCER_ACTIVITY_ENABLED = 'false'
    expect(await recordDashboardPageView(astro('https://aitickets.cl/dashboard'), SESSION)).toBeNull()
    delete process.env.PRODUCER_ACTIVITY_ENABLED
    expect(await recordDashboardPageView(astro('https://aitickets.cl/dashboard'), null)).toBeNull()
    db.failOn('aitickets_producer_activity', 'insert', { code: '42P01', message: 'no existe' })
    expect(await recordDashboardPageView(astro('https://aitickets.cl/dashboard'), SESSION)).not.toBeNull()
  })

  it('usa waitUntil de Netlify cuando existe', async () => {
    const waitUntil = vi.fn()
    const a = astro('https://aitickets.cl/dashboard')
    a.locals = { netlify: { context: { waitUntil } } }
    await recordDashboardPageView(a, SESSION)
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('precarga (Sec-Purpose: prefetch;prerender): devuelve el id pero no registra la visita todavía', async () => {
    const out = await recordDashboardPageView(astro('https://aitickets.cl/dashboard/events', { 'sec-purpose': 'prefetch;prerender' }), SESSION)
    expect(out).toMatchObject({ deferred: true })
    expect(out.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(db.tables.aitickets_producer_activity || []).toHaveLength(0)
    expect(await recordDashboardPageView(astro('https://aitickets.cl/dashboard/events'), SESSION)).toMatchObject({ deferred: false })
  })

  it('reconoce dispositivo y navegador', () => {
    expect(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toEqual({ device: 'desktop', browser: 'Chrome', os: 'Windows' })
    expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toMatchObject({ device: 'mobile', os: 'Android' })
  })
})

describe('POST /api/dashboard/journal', () => {
  const post = (body, raw) =>
    journal.POST({ request: new Request('https://aitickets.cl/api/dashboard/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) }) })
  const valid = { v: 1, pv: PV, route: '/dashboard', path: '/dashboard', sent_at: Date.now(), events: [{ type: 'click', at: Date.now(), label: 'Crear evento' }] }

  it('sin sesión: 401; apagada: 410', async () => {
    session = null
    expect((await post(valid)).status).toBe(401)
    session = SESSION
    process.env.PRODUCER_ACTIVITY_ENABLED = 'false'
    expect((await post(valid)).status).toBe(410)
  })

  it('guarda con la organización y el usuario de la SESIÓN, aunque el cuerpo diga otra cosa', async () => {
    const res = await post({ ...valid, organization_id: 8, user_id: 3, events: [{ ...valid.events[0], organization_id: 8 }] })
    expect(res.status).toBe(204)
    expect(db.tables.aitickets_producer_activity).toHaveLength(1)
    expect(db.tables.aitickets_producer_activity[0]).toMatchObject({ organization_id: 7, user_id: 1, type: 'click', label: 'Crear evento' })
  })

  it('JSON inválido o lote mal formado: 400; demasiado grande: 413; lote sin hechos válidos: 204 sin escribir', async () => {
    expect((await post(null, '{no json')).status).toBe(400)
    expect((await post({ ...valid, pv: 'x' })).status).toBe(400)
    expect((await post(null, JSON.stringify({ ...valid, junk: 'x'.repeat(70 * 1024) }))).status).toBe(413)
    expect((await post({ ...valid, events: [{ type: 'otro' }] })).status).toBe(204)
    expect(db.tables.aitickets_producer_activity).toHaveLength(0)
  })

  it('página precargada que se abrió (page_view: true): registra la visita con los datos de la sesión', async () => {
    const res = await journal.POST({
      url: new URL('https://aitickets.cl/api/dashboard/journal'),
      request: new Request('https://aitickets.cl/api/dashboard/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
        body: JSON.stringify({ ...valid, path: '/dashboard/events/812', search: '?tab=entradas', events: [], page_view: true, referrer: 'https://aitickets.cl/dashboard/events', organization_id: 8 }),
      }),
    })
    expect(res.status).toBe(204)
    expect(db.tables.aitickets_producer_activity).toHaveLength(1)
    expect(db.tables.aitickets_producer_activity[0]).toMatchObject({
      organization_id: 7,
      user_id: 1,
      page_view_id: PV,
      type: 'page_view',
      path: '/dashboard/events/812',
      event_id: 812,
      data: { query: { tab: 'entradas' }, from: '/dashboard/events', role: 'producer', device: 'desktop', browser: 'Chrome' },
    })
  })

  it('tabla inexistente (deploy sin migrar): 204 igual', async () => {
    db.failOn('aitickets_producer_activity', 'insert', { code: '42P01', message: 'no existe' })
    expect((await post(valid)).status).toBe(204)
  })
})

// ---------------------------------------------------------------------------
// Análisis
// ---------------------------------------------------------------------------

const T0 = Date.parse('2026-10-26T21:00:00.000Z')
let nextId = 1
const row = (minute, type, fields = {}) => ({
  id: nextId++,
  occurred_at: new Date(T0 + minute * MIN).toISOString(),
  organization_id: 7,
  user_id: 1,
  page_view_id: PV,
  type,
  path: '/dashboard',
  route: '/dashboard',
  event_id: null,
  label: null,
  target: null,
  status: null,
  duration_ms: null,
  data: {},
  ...fields,
})
const editPage = (pv) => ({ page_view_id: pv, path: '/dashboard/events/812/edit', route: '/dashboard/events/[id]/edit', event_id: 812 })

function frustratedSession() {
  nextId = 1
  return [
    row(0, 'page_view', { data: { device: 'desktop', browser: 'Chrome', os: 'macOS', role: 'producer' } }),
    row(0.5, 'click', { label: 'Mis eventos', target: 'Menú lateral', data: { kind: 'link', href: '/dashboard/events' } }),
    row(0.6, 'page_time', { duration_ms: 30_000, data: { active_ms: 30_000, visible_ms: 36_000, final: true } }),
    row(1, 'page_view', editPage(PV2)),
    row(2, 'form_start', { ...editPage(PV2), label: 'Datos del evento', data: { fields: 12 } }),
    row(3, 'rage_click', { ...editPage(PV2), label: 'Guardar', target: 'Datos del evento', data: { count: 4 } }),
    row(3.1, 'api_error', { ...editPage(PV2), target: 'POST /api/events/update', status: 400, label: 'La fecha de término debe ser posterior al inicio', data: { method: 'POST' } }),
    row(4, 'api_error', { ...editPage(PV2), target: 'POST /api/events/update', status: 400, label: 'La fecha de término debe ser posterior al inicio', data: { method: 'POST' } }),
    row(4.5, 'ui_message', { ...editPage(PV2), label: 'Error al guardar', data: { source: 'alert', level: 'error' } }),
    row(5, 'js_error', { ...editPage(PV2), label: "Cannot read properties of undefined (reading 'id')", data: { kind: 'error', source: '/_astro/EventForm.js' } }),
    row(9, 'page_time', { ...editPage(PV2), duration_ms: 420_000, data: { active_ms: 420_000, visible_ms: 480_000, fields_touched: 3 } }),
  ]
}

describe('sesiones y tiempo por sección', () => {
  it('corta sesiones con pausas de más de 30 min y une el page_time tardío a su página', () => {
    const rows = frustratedSession()
    // Pestaña de Resumen que quedó abierta: su page_time llega 3 h después y no abre otra sesión
    rows.push(row(180, 'page_time', { duration_ms: 31_000, data: { active_ms: 31_000, visible_ms: 40_000, final: true } }))
    // Otra visita al día siguiente
    rows.push(row(24 * 60, 'page_view', { page_view_id: '33333333-3333-4333-8333-333333333333' }))
    const sessions = buildSessions(rows)
    expect(sessions).toHaveLength(2)
    const [later, first] = sessions
    expect(later.pages).toHaveLength(1)
    expect(first.id).toBe('1-1')
    expect(first.pages.map((p) => [p.section, p.active_ms])).toEqual([
      ['Resumen', 31_000],
      ['Editar evento #812', 420_000],
    ])
    // El page_time de 3 h después no alarga la sesión
    expect(Date.parse(first.ended_at) - Date.parse(first.started_at)).toBe(9 * MIN)
  })

  it('estima el tiempo de una página sin datos del navegador con la página siguiente', () => {
    nextId = 1
    const sessions = buildSessions([row(0, 'page_view'), row(4, 'page_view', editPage(PV2))])
    expect(sessions[0].pages[0]).toMatchObject({ time_estimated: true, time_ms: 4 * MIN, has_client_data: false })
    expect(summarizeSession(sessions[0]).tracking).toMatch(/parcial: 2 de 2/)
  })

  it('resume la sesión y agrega por sección', () => {
    const [s] = buildSessions(frustratedSession())
    const summary = summarizeSession(s)
    expect(summary).toMatchObject({ session_id: '1-1', pages_visited: 2, active_minutes: 7.5, device: 'desktop · Chrome · macOS', role: 'producer', actions_ok: 0, errors: 4, tracking: 'completo' })
    expect(summary.path).toBe('Resumen (30 s) → Editar evento #812 (7 min)')
    const sections = aggregateSections([s])
    expect(sections[0]).toMatchObject({ route: '/dashboard/events/[id]/edit', section: 'Editar evento', visits: 1, total_minutes: 7, errors: 4 })
    expect(sections[0].friction_points).toBeGreaterThan(0)
  })
})

describe('fricción', () => {
  it('detecta clics repetidos, guardado que falla sin lograrlo, error de JS, mensaje de error y no marca el formulario como abandonado', () => {
    const [s] = buildSessions(frustratedSession())
    const f = detectFriction(s)
    const kinds = f.map((x) => `${x.severity}:${x.kind}`)
    expect(kinds).toEqual(expect.arrayContaining(['high:rage_click', 'high:repeated_error', 'high:js_error', 'medium:error_message']))
    // Hubo un error de la API después de empezar el formulario: el abandono ya está explicado por el error
    expect(kinds).not.toContain('medium:form_abandon')
    expect(f[0].severity).toBe('high')
    expect(f.find((x) => x.kind === 'repeated_error').summary).toBe(
      'Falló 2 veces POST /api/events/update en Editar evento #812 y no lo logró: "La fecha de término debe ser posterior al inicio" (400)',
    )
  })

  it('guardado que falló y luego funcionó: medium; formulario abandonado; sesión vencida; vuelta en círculos; acción lenta; confirmación cancelada', () => {
    nextId = 1
    const pv = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`
    const rows = [
      row(0, 'page_view', { ...editPage(pv(1)) }),
      row(1, 'api_error', { ...editPage(pv(1)), target: 'POST /api/events/update', status: 400, label: 'Falta el lugar', data: { method: 'POST' } }),
      row(1.5, 'api_error', { ...editPage(pv(1)), target: 'POST /api/events/update', status: 400, label: 'Falta el lugar', data: { method: 'POST' } }),
      row(2, 'api_call', { ...editPage(pv(1)), target: 'POST /api/events/update', status: 200, duration_ms: 9000, data: { method: 'POST' } }),
      row(3, 'page_view', { page_view_id: pv(2), path: '/dashboard/settings', route: '/dashboard/settings' }),
      row(3.5, 'form_start', { page_view_id: pv(2), path: '/dashboard/settings', route: '/dashboard/settings', label: 'Datos bancarios' }),
      row(5, 'page_time', { page_view_id: pv(2), path: '/dashboard/settings', route: '/dashboard/settings', data: { active_ms: 120_000, fields_touched: 2 } }),
      row(6, 'page_view', { page_view_id: pv(3), path: '/dashboard/team', route: '/dashboard/team' }),
      row(6.5, 'api_error', { page_view_id: pv(3), path: '/dashboard/team', route: '/dashboard/team', target: 'POST /api/team/add', status: 401, data: { method: 'POST' } }),
      row(6.8, 'ui_message', { page_view_id: pv(3), path: '/dashboard/team', route: '/dashboard/team', label: '¿Eliminar a Beto del equipo?', data: { source: 'confirm', level: 'info', result: 'cancelled' } }),
      ...[7, 8, 9, 10].map((m, i) => row(m, 'page_view', { page_view_id: pv(10 + i), path: '/dashboard/finance', route: '/dashboard/finance' })),
    ]
    const f = detectFriction(buildSessions(rows)[0])
    const byKind = Object.fromEntries(f.map((x) => [x.kind, x]))
    expect(byKind.repeated_error).toMatchObject({ severity: 'medium', count: 2 })
    expect(byKind.repeated_error.summary).toMatch(/antes de lograrlo/)
    expect(byKind.slow_action).toMatchObject({ severity: 'low', target: 'POST /api/events/update' })
    expect(byKind.form_abandon).toMatchObject({ severity: 'medium', label: 'Datos bancarios' })
    expect(byKind.form_abandon.summary).toBe('Empezó a completar "Datos bancarios" en Configuración y salió sin guardar (2 campo(s) tocados, 2 min activo)')
    expect(byKind.session_expired).toMatchObject({ severity: 'medium', section: 'Equipo' })
    expect(byKind.confirm_cancelled).toMatchObject({ severity: 'low' })
    expect(byKind.loop).toMatchObject({ count: 4, section: 'Ingresos' })
  })

  it('mucho tiempo en una página de edición sin guardar: long_dwell (no en páginas de lectura)', () => {
    nextId = 1
    const rows = [
      row(0, 'page_view', editPage(PV2)),
      row(8, 'page_time', { ...editPage(PV2), data: { active_ms: 6 * MIN } }),
      row(9, 'page_view', { page_view_id: PV, path: '/dashboard/finance', route: '/dashboard/finance' }),
      row(20, 'page_time', { page_view_id: PV, path: '/dashboard/finance', route: '/dashboard/finance', data: { active_ms: 10 * MIN } }),
    ]
    const f = detectFriction(buildSessions(rows)[0])
    expect(f.map((x) => x.kind)).toEqual(['long_dwell'])
    expect(f[0].summary).toBe('Pasó 6 min activo en Editar evento #812 sin guardar nada')
  })

  it('línea de tiempo legible y errores agrupados', () => {
    const [s] = buildSessions(frustratedSession())
    const t = timeline(s)
    expect(t.entries.map((e) => e.text)).toEqual([
      'Abrió Resumen — 30 s activo',
      'Clic en "Mis eventos" (Menú lateral) → /dashboard/events',
      'Abrió Editar evento #812 — 7 min activo',
      'Empezó a completar "Datos del evento" (12 campos)',
      'Clics repetidos (4) en "Guardar" (Datos del evento)',
      'POST /api/events/update → error 400: "La fecha de término debe ser posterior al inicio"',
      'POST /api/events/update → error 400: "La fecha de término debe ser posterior al inicio"',
      'Alerta de error: "Error al guardar"',
      "Error de JavaScript: Cannot read properties of undefined (reading 'id') (/_astro/EventForm.js)",
    ])
    const groups = groupErrors(s.rows)
    expect(groups[0]).toMatchObject({ kind: 'api', where: 'POST /api/events/update', count: 2 })
    expect(groups).toHaveLength(3)
    expect(fmtDuration(65_000)).toBe('1 min 5 s')
    expect(fmtDuration(3_900_000)).toBe('1 h 5 min')
  })
})

// ---------------------------------------------------------------------------
// MCP de admin
// ---------------------------------------------------------------------------

const actx = (keyKind = 'full') => ({ supabase: db, origin: SITE, requestUrl: new URL(`${SITE}/api/admin/mcp`), keyKind, fingerprint: 'abcd1234', ipHash: 'f'.repeat(64) })
const run = async (name, args = {}, keyKind) => {
  const out = await runAdminTool(getAdminTool(name), args, actx(keyKind))
  if (!out.ok) throw new Error(`${name}: ${out.code} ${out.message}`)
  return out.result
}

/** Filas recientes (dentro de los 7 días por defecto) de la sesión frustrada + otra organización. */
function seedActivity() {
  const shift = Date.now() - 2 * 86400000 - T0
  const rows = frustratedSession().map((r) => ({ ...r, occurred_at: new Date(Date.parse(r.occurred_at) + shift).toISOString() }))
  nextId = 100
  const other = [
    row(0, 'page_view', { organization_id: 8, user_id: 3, page_view_id: '55555555-5555-4555-8555-555555555555', path: '/dashboard/events/30/edit', route: '/dashboard/events/[id]/edit', event_id: 30 }),
    row(1, 'api_error', { organization_id: 8, user_id: 3, page_view_id: '55555555-5555-4555-8555-555555555555', path: '/dashboard/events/30/edit', route: '/dashboard/events/[id]/edit', event_id: 30, target: 'POST /api/events/update', status: 400, label: 'La fecha de término debe ser posterior al inicio', data: { method: 'POST' } }),
    row(1.2, 'click', { organization_id: 8, user_id: 3, page_view_id: '55555555-5555-4555-8555-555555555555', label: 'Guardar' }),
  ].map((r) => ({ ...r, occurred_at: new Date(Date.parse(r.occurred_at) + shift).toISOString() }))
  db.tables.aitickets_producer_activity.push(...rows, ...other)
}

describe('get_producer_activity', () => {
  it('sesiones, equipo, secciones, fricción y errores de la productora (sin datos de otras)', async () => {
    seedActivity()
    const r = await run('get_producer_activity', { organization_id: 7 })
    expect(r.organization).toEqual({ id: 7, name: 'Productora Siete' })
    expect(r.totals).toMatchObject({ sessions: 1, users: 1, page_views: 2, errors: 4, active_minutes: 7.5 })
    expect(r.totals.high_severity_friction).toBeGreaterThanOrEqual(3)
    expect(r.team[0]).toMatchObject({ user: { id: 1, name: 'Ana', role: 'producer' }, sessions: 1, login_count: 4 })
    expect(r.sections[0]).toMatchObject({ section: 'Editar evento', visits: 1 })
    expect(r.friction[0]).toMatchObject({ severity: 'high', user: 'Ana', session_id: '1-1' })
    expect(r.errors[0]).toMatchObject({ kind: 'api', where: 'POST /api/events/update', count: 2, statuses: [400] })
    expect(r.sessions[0]).toMatchObject({ session_id: '1-1', user: { id: 1, name: 'Ana' } })
    expect(r.sessions[0]).not.toHaveProperty('timeline')
    const all = JSON.stringify(r)
    expect(all).not.toContain('Oscar')

    const withTimeline = await run('get_producer_activity', { organization_id: 7, include_timeline: true })
    expect(withTimeline.sessions[0].timeline.entries.length).toBeGreaterThan(5)
  })

  it('session_id: detalle de páginas, fricción y línea de tiempo; otra organización o sesión inexistente: not_found', async () => {
    seedActivity()
    const r = await run('get_producer_activity', { organization_id: 7, session_id: '1-1' })
    expect(r.session.pages.map((p) => p.section)).toEqual(['Resumen', 'Editar evento #812'])
    expect(r.session.pages[1]).toMatchObject({ active_seconds: 420, errors: 4 })
    expect(r.session.timeline.entries[0].text).toBe('Abrió Resumen — 30 s activo')
    expect(r.session.friction_detail[0]).toHaveProperty('at_local')

    const wrongOrg = await runAdminTool(getAdminTool('get_producer_activity'), { organization_id: 8, session_id: '1-1' }, actx())
    expect(wrongOrg).toMatchObject({ ok: false, code: 'not_found' })
    const missing = await runAdminTool(getAdminTool('get_producer_activity'), { organization_id: 7, session_id: '1-999' }, actx())
    expect(missing).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('sin actividad, período inválido y organización inexistente', async () => {
    const empty = await run('get_producer_activity', { organization_id: 7 })
    expect(empty.totals.sessions).toBe(0)
    expect(empty.note).toMatch(/Sin actividad registrada/)
    const tooLong = await runAdminTool(getAdminTool('get_producer_activity'), { organization_id: 7, since: '2026-01-01T00:00:00Z', until: '2026-10-01T00:00:00Z' }, actx())
    expect(tooLong).toMatchObject({ ok: false, code: 'invalid_input' })
    const nope = await runAdminTool(getAdminTool('get_producer_activity'), { organization_id: 404 }, actx())
    expect(nope).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('tabla inexistente (deploy sin migrar): responde vacío', async () => {
    db.failOn('aitickets_producer_activity', 'select', { code: '42P01', message: 'no existe' }, { once: false })
    const r = await run('get_producer_activity', { organization_id: 7 })
    expect(r.totals.sessions).toBe(0)
  })
})

describe('list_dashboard_issues', () => {
  it('agrupa errores entre productores, puntos de fricción, acciones que fallan, uso por sección y productores con más fricción', async () => {
    seedActivity()
    const r = await run('list_dashboard_issues', {})
    expect(r.totals).toMatchObject({ organizations_active: 2, sessions: 2 })
    const updateError = r.errors.find((e) => e.where === 'POST /api/events/update')
    expect(updateError).toMatchObject({ kind: 'api', count: 3, organizations: 2, users: 2 })
    expect(updateError.organizations_sample.map((o) => o.name).sort()).toEqual(['Ocho Eventos', 'Productora Siete'])
    expect(r.failing_actions[0]).toMatchObject({ endpoint: 'POST /api/events/update', failures: 3, successes: 0, failure_rate_pct: 100, statuses: { 400: 3 } })
    expect(r.failing_actions[0].top_messages[0]).toEqual({ message: 'La fecha de término debe ser posterior al inicio', count: 3 })
    expect(r.friction_hotspots.length).toBeGreaterThan(0)
    expect(r.usage_by_section[0]).toMatchObject({ section: 'Editar evento', organizations: 2 })
    expect(r.organizations_with_most_friction[0].organization).toEqual({ id: 7, name: 'Productora Siete' })
    // Los clics simples no se leen entre organizaciones
    expect(db.calls.some((c) => c.table === 'aitickets_producer_activity' && c.filters.some((f) => f.op === 'neq' && f.value === 'click'))).toBe(true)
  })

  it('sections filtra la respuesta y organization_id la acota', async () => {
    seedActivity()
    const r = await run('list_dashboard_issues', { organization_id: 8, sections: ['errors'] })
    expect(r).toHaveProperty('errors')
    expect(r).not.toHaveProperty('friction_hotspots')
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].organizations_sample).toEqual([{ id: 8, name: 'Ocho Eventos' }])
  })
})

describe('catálogo del MCP de admin', () => {
  it('las dos herramientas son de lectura, las ve la llave de solo lectura y quedan en la bitácora', async () => {
    const names = adminToolsList({ keyKind: 'readonly' }).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_producer_activity', 'list_dashboard_issues']))
    await run('get_producer_activity', { organization_id: 7 }, 'readonly')
    expect(db.tables.aitickets_admin_audit.at(-1)).toMatchObject({ tool: 'get_producer_activity', read_only: true, ok: true, organization_id: 7 })
    expect(ADMIN_PROMPTS.find((p) => p.name === 'diagnosticar_panel').render({ organizacion: 'Siete' })).toMatch(/get_producer_activity/)
    expect(ADMIN_PROMPTS.find((p) => p.name === 'diagnosticar_panel').render({})).toMatch(/list_dashboard_issues/)
  })
})

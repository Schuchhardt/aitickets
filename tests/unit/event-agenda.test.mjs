// Agenda con expositores y salas (PENDIENTES_pronto ítem 17): validación y orden de los bloques, agrupación por día
// para la página del evento, guardado (aitickets_event_agenda), las herramientas get/update_event_agenda (las que usa
// el panel) y el contexto del asistente de la página. Sin red ni BD.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const lib = await import('../../src/lib/eventAgenda.mjs')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { agendaTools } = await import('../../src/lib/producer-api/tools/agenda.ts')
const { getTool } = await import('../../src/lib/producer-api/tools/index.ts')
const { resolveModules } = await import('../../src/lib/eventModules.ts')
const { buildSystemPrompt } = await import('../../netlify/functions/ai-assistant/index.mjs')

const tool = (name) => agendaTools.find((t) => t.name === name)
const DATES = [
  { id: 501, date: '2026-12-03', start_time: '09:00:00', end_time: '18:00:00' },
  { id: 502, date: '2026-12-04', start_time: '09:00:00', end_time: '13:30:00' },
]

function seed() {
  db = createFakeSupabase({
    tables: {
      events: [
        { id: 10, organization_id: 7, name: 'Congreso RRHH', slug: 'congreso', status: 'published' },
        { id: 20, organization_id: 8, name: 'Ajeno', slug: 'ajeno', status: 'published' },
      ],
      event_dates: DATES.map((d) => ({ ...d, event_id: 10 })),
      aitickets_event_agenda: [],
      aitickets_api_audit: [],
    },
  })
}
beforeEach(seed)

const ctx = (over = {}) => ({
  supabase: db,
  actor: { keyId: null, userId: 1, orgId: 7, role: 'producer', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'write'], eventIds: null, ...over },
  origin: 'https://aitickets.test',
  requestUrl: new URL('https://aitickets.test/api/events/agenda'),
  channel: 'dashboard',
})

describe('normalizeAgenda', () => {
  it('limpia, valida horas y ordena por día y hora (los de todos los días primero)', () => {
    const out = lib.normalizeAgenda(
      [
        { function_id: 502, start: '10:00', end: '11:30', title: '  Panel  de cierre ', speakers: 'Ana Pérez', room: 'Sala 2' },
        { function_id: 501, start: '9:30', title: 'Keynote' },
        { function_id: null, start: '08:30', end: '', title: 'Acreditación', room: '' },
        { function_id: 501, start: '09:00:00', end: '09:30', title: 'Bienvenida' },
      ],
      [501, 502],
    )
    expect(out.map((b) => [b.function_id, b.start, b.title])).toEqual([
      [null, '08:30', 'Acreditación'],
      [501, '09:00', 'Bienvenida'],
      [501, '09:30', 'Keynote'],
      [502, '10:00', 'Panel de cierre'],
    ])
    expect(out[0]).toMatchObject({ end: null, room: null, speakers: null, position: 0 })
    expect(out[3]).toMatchObject({ end: '11:30', speakers: 'Ana Pérez', room: 'Sala 2', position: 3 })
  })

  it.each([
    [[{ start: '09:00', title: '' }], 'Al bloque 1 le falta el título.'],
    [[{ start: '25:00', title: 'X' }], 'La hora de inicio del bloque 1 no es válida (usa HH:MM).'],
    [[{ start: '10:00', end: '09:00', title: 'X' }], 'En el bloque 1 la hora de término debe ser después del inicio.'],
    [[{ start: '10:00', end: 'mañana', title: 'X' }], 'La hora de término del bloque 1 no es válida (usa HH:MM).'],
    [[{ start: '10:00', title: 'X', function_id: 999 }], 'La función del bloque 1 no es de este evento.'],
    [[{ start: '10:00', title: 'X', room: 'S'.repeat(81) }], 'La sala del bloque 1 es muy larga (máximo 80 caracteres).'],
    ['nada', 'La agenda debe ser una lista de bloques.'],
  ])('rechaza %j', (raw, message) => {
    expect(() => lib.normalizeAgenda(raw, [501, 502])).toThrow(message)
  })

  it(`hasta ${lib.MAX_AGENDA_BLOCKS} bloques`, () => {
    const many = Array.from({ length: lib.MAX_AGENDA_BLOCKS + 1 }, () => ({ start: '09:00', title: 'X' }))
    expect(() => lib.normalizeAgenda(many, [])).toThrow(`hasta ${lib.MAX_AGENDA_BLOCKS} bloques`)
  })
})

describe('agendaGroups (página del evento)', () => {
  const blocks = [
    { id: 1, function_id: 502, start: '10:00', end: '11:30', title: 'Panel', speakers: 'Ana', room: 'Sala 2', position: 2 },
    { id: 2, function_id: 501, start: '09:30', end: null, title: 'Keynote', speakers: null, room: null, position: 1 },
    { id: 3, function_id: null, start: '08:30', end: null, title: 'Acreditación', speakers: null, room: 'Hall', position: 0 },
    // Función que ya no existe: va con los de todos los días
    { id: 4, function_id: 999, start: '08:00', end: null, title: 'Huérfano', speakers: null, room: null, position: 3 },
  ]

  it('un grupo por día con "Día N", y primero lo de todos los días', () => {
    const groups = lib.agendaGroups(blocks, DATES)
    expect(groups.map((g) => g.title)).toEqual(['Todos los días', 'Día 1 · Jue 3 dic', 'Día 2 · Vie 4 dic'])
    expect(groups[0].blocks.map((b) => b.title)).toEqual(['Huérfano', 'Acreditación'])
    expect(groups[2].blocks[0]).toEqual({ id: 1, start: '10:00', end: '11:30', title: 'Panel', speakers: 'Ana', room: 'Sala 2' })
  })

  it('con una sola función, un grupo sin título', () => {
    const groups = lib.agendaGroups(blocks, [DATES[0]])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBeNull()
    expect(groups[0].blocks.map((b) => b.start)).toEqual(['08:00', '08:30', '09:30', '10:00'])
  })

  it('dos funciones el mismo día se distinguen por la hora', () => {
    const sameDay = [{ id: 1, date: '2026-12-03', start_time: '09:00' }, { id: 2, date: '2026-12-03', start_time: '15:00' }]
    const groups = lib.agendaGroups([{ function_id: 2, start: '15:00', title: 'Tarde' }], sameDay)
    expect(groups[0].title).toBe('Jue 3 dic · 15:00')
  })

  it('sin bloques no hay agenda; en texto, una línea por bloque', () => {
    expect(lib.agendaGroups([], DATES)).toEqual([])
    expect(lib.agendaText(lib.agendaGroups(blocks.slice(0, 1), DATES))).toBe('Día 2 · Vie 4 dic:\n- 10:00 – 11:30 Panel · Ana · Sala 2')
  })
})

describe('get_event_agenda / update_event_agenda', () => {
  it('guarda la agenda completa, la reemplaza y la devuelve como la ve el público', async () => {
    const first = await runTool(tool('update_event_agenda'), {
      event_id: 10,
      blocks: [
        { function_id: 501, start: '09:00', end: '10:00', title: 'Keynote', speakers: 'Diego Mardones', room: 'Auditorio' },
        { function_id: 502, start: '11:00', title: 'Panel de cierre' },
      ],
    }, ctx())
    expect(first.ok).toBe(true)
    expect(first.result.total_blocks).toBe(2)
    expect(db.tables.aitickets_event_agenda.map((r) => [r.event_id, r.event_date_id, r.starts_at, r.title])).toEqual([
      [10, 501, '09:00', 'Keynote'],
      [10, 502, '11:00', 'Panel de cierre'],
    ])
    expect(first.result.as_text).toContain('Día 1 · Jue 3 dic:\n- 09:00 – 10:00 Keynote · Diego Mardones · Auditorio')

    const second = await runTool(tool('update_event_agenda'), { event_id: 10, blocks: [{ start: '08:30', title: 'Café' }] }, ctx())
    expect(second.ok).toBe(true)
    expect(db.tables.aitickets_event_agenda.map((r) => r.title)).toEqual(['Café'])
    // Queda en la bitácora
    expect(db.tables.aitickets_api_audit.at(-1)).toMatchObject({ tool: 'update_event_agenda' })

    const read = await runTool(tool('get_event_agenda'), { event_id: 10 }, ctx())
    expect(read.result.blocks).toEqual([{ function_id: null, start: '08:30', end: null, title: 'Café', speakers: null, room: null }])
    expect(read.result.functions.map((f) => f.id)).toEqual([501, 502])

    const cleared = await runTool(tool('update_event_agenda'), { event_id: 10, blocks: [] }, ctx())
    expect(cleared.result.total_blocks).toBe(0)
    expect(db.tables.aitickets_event_agenda).toHaveLength(0)
  })

  it('valida, respeta la organización y el rol', async () => {
    expect(await runTool(tool('update_event_agenda'), { event_id: 10, blocks: [{ start: '10:00', end: '09:00', title: 'X' }] }, ctx()))
      .toMatchObject({ ok: false, code: 'invalid_input', message: 'En el bloque 1 la hora de término debe ser después del inicio.' })
    expect(await runTool(tool('update_event_agenda'), { event_id: 20, blocks: [] }, ctx())).toMatchObject({ ok: false, code: 'not_found' })
    expect(await runTool(tool('update_event_agenda'), { event_id: 10, blocks: [] }, ctx({ role: 'viewer' }))).toMatchObject({ ok: false, code: 'forbidden' })
    expect((await runTool(tool('get_event_agenda'), { event_id: 10 }, ctx({ role: 'viewer' }))).ok).toBe(true)
    expect(db.tables.aitickets_event_agenda).toHaveLength(0)
  })

  it('sin la tabla: la agenda está vacía y guardar avisa que aún no está disponible', async () => {
    db.failOn('aitickets_event_agenda', 'select', { code: '42P01', message: 'relation "aitickets_event_agenda" does not exist' }, { once: false })
    expect(await lib.loadAgenda(db, 10)).toEqual([])
    expect(await runTool(tool('update_event_agenda'), { event_id: 10, blocks: [] }, ctx())).toMatchObject({ ok: false, code: 'unavailable' })
  })

  it('están en el catálogo de la API', () => {
    expect(getTool('get_event_agenda')).toBeTruthy()
    expect(getTool('update_event_agenda')).toBeTruthy()
  })
})

describe('panel y asistente de la página', () => {
  const moduleCtx = { profile: 'formacion', status: 'published', functionCount: 2, ticketTypeCount: 2, phase: 'before', waitlistCount: 0, hasAttendees: false, isMassive: false }
  it('la agenda va en la pestaña Página, sugerida para talleres y seminarios', () => {
    const byId = (mods) => Object.fromEntries(mods.map((m) => [m.id, m]))
    expect(byId(resolveModules(moduleCtx)).agenda).toMatchObject({ tab: 'pagina', enabled: true })
    expect(byId(resolveModules({ ...moduleCtx, profile: 'noche' })).agenda).toMatchObject({ enabled: false, suggested: false })
  })

  it('el asistente de la página recibe la agenda', () => {
    const prompt = buildSystemPrompt({
      event: { id: 10, name: 'Congreso RRHH', description: '', location: 'Santiago' },
      isDemo: false,
      dates: DATES,
      tickets: [],
      faqs: [],
      agenda: '- 11:00 Panel de cierre · Ana Pérez · Sala 2',
    })
    expect(prompt).toContain('Agenda (hora, título, expositores y sala):\n- 11:00 Panel de cierre · Ana Pérez · Sala 2')
    expect(buildSystemPrompt({ event: { id: 10, name: 'X', description: '' }, isDemo: false, dates: [], tickets: [], faqs: [] })).not.toContain('Agenda')
  })
})

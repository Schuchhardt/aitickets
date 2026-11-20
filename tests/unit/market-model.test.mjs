// Mapa de mercado y modelo de fechas (src/lib/market): taxonomía, feriados de Chile, fines de semana largos y la nota
// de una fecha. Funciones puras: sin base ni red.
import { describe, expect, it } from 'vitest'

const { chileHolidays, easterSunday, makeCalendar, addDays } = await import('../../src/lib/market/calendar.ts')
const { buildDateModel, nightDate, verdictFor } = await import('../../src/lib/market/dateModel.ts')
const { cityInfo, normalizePlatform, normalizeInstagram, producerKey, venueKey, slotKey, normalizeNiche, leadNicheFor, categoryFromTag, affinity, usesTicketing } = await import('../../src/lib/market/taxonomy.ts')

const holidayDates = (year) => chileHolidays(year).map((h) => h.date)

let seq = 0
const ev = (over = {}) => {
  const id = ++seq
  const date = over.date || '2026-06-13'
  return {
    key: `ext:${id}:${date}`, source: 'external', id, name: `Evento ${id}`, category: 'fiesta', niche: null, date,
    night_date: nightDate(date, over.start_time ?? null), start_time: null, city_key: 'santiago', city: 'Santiago', region: 'metropolitana',
    venue_name: null, capacity: null, producer_key: null, producer_name: null, ticketing_platform: 'passline', price_min: null, price_max: null,
    is_free: null, status: 'scheduled', sold_out: null, sold_pct: null, announced_at: null, show_key: `ext:${id}`, organization_id: null, lead_id: null,
    ...over,
  }
}

describe('feriados de Chile', () => {
  it('Pascua', () => {
    expect(easterSunday(2024)).toBe('2024-03-31')
    expect(easterSunday(2025)).toBe('2025-04-20')
    expect(easterSunday(2026)).toBe('2026-04-05')
  })

  it('2026: fijos, Semana Santa y Pueblos Indígenas', () => {
    const d = holidayDates(2026)
    for (const x of ['2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21', '2026-06-21', '2026-06-29', '2026-07-16', '2026-08-15', '2026-09-18', '2026-09-19', '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25']) {
      expect(d, x).toContain(x)
    }
    // 17 de septiembre de 2026 es jueves y el 20 domingo: no son feriado
    expect(d).not.toContain('2026-09-17')
    expect(d).not.toContain('2026-09-20')
  })

  it('traslados por ley (2017-2025)', () => {
    expect(holidayDates(2018)).toContain('2018-07-02') // San Pedro y San Pablo: viernes 29 → lunes siguiente
    expect(holidayDates(2018)).not.toContain('2018-06-29')
    expect(holidayDates(2018)).toContain('2018-10-15') // Encuentro de Dos Mundos: viernes 12 → lunes 15
    expect(holidayDates(2018)).toContain('2018-11-02') // Iglesias Evangélicas: miércoles 31 → viernes 2
    expect(holidayDates(2017)).toContain('2017-10-27') // martes 31 → viernes 27
    expect(holidayDates(2018)).toContain('2018-09-17') // 17 de septiembre lunes
    expect(holidayDates(2019)).toContain('2019-09-20') // 20 de septiembre viernes
    expect(holidayDates(2023)).toContain('2023-01-02') // 2 de enero lunes
    expect(holidayDates(2025)).toContain('2025-06-20') // Pueblos Indígenas 2025
  })

  it('fines de semana largos, vísperas y entradas del calendario', () => {
    const cal = makeCalendar()
    const scl = { cityKey: 'santiago', region: 'metropolitana' }
    expect(cal.longWeekend('2026-04-04', scl)).toMatchObject({ start: '2026-04-03', end: '2026-04-05', days: 3 })
    expect(cal.longWeekend('2026-06-13', scl)).toBeNull() // fin de semana normal
    // Jueves 21 de mayo feriado, viernes 22 hábil: el miércoles 20 se comporta como viernes para la noche
    expect(cal.effectiveDow('2026-05-20', 'noche', scl)).toBe(5)
    expect(cal.effectiveDow('2026-05-13', 'noche', scl)).toBe(3)
    expect(cal.effectiveDow('2026-05-21', 'noche', scl)).toBe(0) // feriado antes de volver al trabajo
    expect(cal.effectiveDow('2026-05-21', 'formacion', scl)).toBe(0)
    expect(cal.longWeekend('2026-05-21', scl)).toBeNull()

    // Interferiado el viernes 22: arma un fin de semana largo de 4 días (solo donde aplica)
    const withBridge = makeCalendar([{ id: 1, kind: 'bridge_holiday', label: 'Interferiado', date_from: '2026-05-22', date_to: '2026-05-22', region: 'metropolitana' }])
    expect(withBridge.longWeekend('2026-05-23', scl)).toMatchObject({ start: '2026-05-21', end: '2026-05-24', days: 4 })
    expect(withBridge.longWeekend('2026-05-23', { cityKey: 'temuco', region: 'araucania' })).toBeNull()
    expect(withBridge.effectiveDow('2026-05-21', 'noche', scl)).toBe(6)

    // no_holiday anula un feriado calculado
    const without = makeCalendar([{ kind: 'no_holiday', label: 'x', date_from: '2026-12-08', date_to: '2026-12-08' }])
    expect(without.holidayName('2026-12-08', scl)).toBeNull()
    expect(cal.holidayName('2026-12-08', scl)).toBe('Inmaculada Concepción')
  })

  it('factores: Fiestas Patrias, Año Nuevo, fin de semana largo y entradas por tipo', () => {
    const cal = makeCalendar([{ id: 9, kind: 'election', label: 'Elección', date_from: '2026-11-15', date_to: '2026-11-15' }])
    const scl = { cityKey: 'santiago', region: 'metropolitana', destination: false }
    expect(cal.factors('2026-09-18', 'conferencia', scl)[0].multiplier).toBe(0.6)
    expect(cal.factors('2026-12-31', 'fiesta', scl)[0].multiplier).toBe(1.15)
    expect(cal.factors('2026-12-31', 'teatro', scl)[0].multiplier).toBe(0.35)
    expect(cal.factors('2026-04-04', 'concierto', scl)[0]).toMatchObject({ multiplier: 0.88 })
    expect(cal.factors('2026-04-04', 'concierto', { cityKey: 'gran_valparaiso', region: 'valparaiso', destination: true })[0]).toMatchObject({ multiplier: 1.1 })
    expect(cal.factors('2026-11-15', 'fiesta', scl)).toEqual([expect.objectContaining({ multiplier: 0.5, source: 'calendar', entry_id: 9 })])
  })
})

describe('taxonomía', () => {
  it('ciudades: comunas → ciudad, región y destinos', () => {
    expect(cityInfo('Providencia')).toMatchObject({ key: 'santiago', region: 'metropolitana', destination: false })
    expect(cityInfo('Ñuñoa').key).toBe('santiago')
    expect(cityInfo('Viña del Mar')).toMatchObject({ key: 'gran_valparaiso', region: 'valparaiso', destination: true })
    expect(cityInfo('Zoom').key).toBe('online')
    expect(cityInfo('Pueblo Chico', 'maule')).toMatchObject({ key: 'pueblo_chico', region: 'maule' })
    expect(cityInfo('')).toMatchObject({ key: null })
  })

  it('ticketeras, Instagram y claves', () => {
    expect(normalizePlatform('Punto Ticket')).toEqual({ slug: 'puntoticket', known: true })
    expect(normalizePlatform('https://www.passline.com/eventos/x')).toEqual({ slug: 'passline', known: true })
    expect(normalizePlatform('DM')).toEqual({ slug: 'none', known: true })
    expect(normalizePlatform('Ticketera Nueva')).toEqual({ slug: 'ticketera_nueva', known: false })
    expect(normalizePlatform('')).toEqual({ slug: null, known: true })
    expect(usesTicketing('none')).toBe(false)
    expect(usesTicketing('passline')).toBe(true)
    expect(usesTicketing(null)).toBeNull()
    expect(normalizeInstagram('https://instagram.com/Mi.Productora/?hl=es')).toBe('mi.productora')
    expect(normalizeInstagram('@fiestas_x')).toBe('fiestas_x')
    expect(producerKey('Fiestas X', '@fiestas_x')).toBe('ig:fiestas_x')
    expect(producerKey('Fiestas X', null)).toBe('name:fiestas_x')
    expect(venueKey('Teatro Caupolicán', 'santiago')).toBe('teatro_caupolican|santiago')
    expect(slotKey('2026-06-13', '21:00:00', 12, 'santiago')).toBe('2026-06-13|21:00|v12')
    expect(slotKey('2026-06-13', null, null, 'temuco')).toBe('2026-06-13|-|temuco')
  })

  it('nichos: normalizados con alias, y nicho de lead por categoría', () => {
    expect(normalizeNiche('Tecno')).toBe('techno')
    expect(normalizeNiche(' TECHNO ')).toBe('techno')
    expect(normalizeNiche('Reguetón')).toBe('reggaeton')
    expect(normalizeNiche('Música urbana')).toBe('urbano')
    expect(normalizeNiche('Stand Up Comedy')).toBe('stand_up')
    expect(normalizeNiche('Cerámica')).toBe('ceramica')
    expect(normalizeNiche('')).toBeNull()
    expect(leadNicheFor('concierto')).toBe('musica_en_vivo')
    expect(leadNicheFor('fiesta')).toBe('fiestas')
    expect(leadNicheFor('conferencia')).toBe('seminarios')
    expect(leadNicheFor('feria')).toBe('otro')
  })

  it('categorías de AI Tickets → categoría y afinidad', () => {
    expect(categoryFromTag('Festival de música')).toBe('festival')
    expect(categoryFromTag('Stand Up')).toBe('stand_up')
    expect(categoryFromTag('Música')).toBe('concierto')
    expect(categoryFromTag(null)).toBe('otro')
    expect(affinity('fiesta', 'club')).toBe(0.8)
    expect(affinity('club', 'fiesta')).toBe(0.8)
    expect(affinity('fiesta', 'conferencia')).toBe(0)
  })
})

describe('modelo de fechas', () => {
  it('sin datos: el supuesto inicial ordena los días por tipo', () => {
    const m = buildDateModel({ events: [], today: '2026-03-01' })
    const sat = m.evaluate('2026-06-13', { category: 'fiesta', city: 'Santiago' })
    const mon = m.evaluate('2026-06-15', { category: 'fiesta', city: 'Santiago' })
    expect(sat.score).toBeGreaterThan(80)
    expect(mon.score).toBeLessThan(30)
    expect(sat.verdict).toBe('buena')
    expect(mon.verdict).toBe('mala')
    expect(sat.confidence.level).toBe('baja')
    const wed = m.evaluate('2026-06-17', { category: 'conferencia', city: 'Santiago' })
    const satConf = m.evaluate('2026-06-13', { category: 'conferencia', city: 'Santiago' })
    expect(wed.score).toBeGreaterThan(satConf.score)
    expect(verdictFor(75)).toBe('buena')
    expect(verdictFor(39)).toBe('mala')
  })

  it('víspera de feriado: un miércoles antes de un jueves feriado vale como viernes para una fiesta', () => {
    const m = buildDateModel({ events: [], today: '2026-03-01' })
    const eve = m.evaluate('2026-05-20', { category: 'fiesta', city: 'Santiago' })
    const normal = m.evaluate('2026-05-13', { category: 'fiesta', city: 'Santiago' })
    expect(eve.score).toBeGreaterThan(normal.score + 30)
    expect(eve.factors.find((f) => f.factor === 'dia_semana').detail).toMatch(/viernes/)
    expect(eve.calendar.next_day_holiday).toBe('Día de las Glorias Navales')
  })

  it('competencia: un sábado con 6 fiestas vale menos que los sábados normales (1 fiesta) y lista a los competidores', () => {
    const events = []
    for (let k = -8; k <= 8; k++) {
      const date = addDays('2026-06-13', 7 * k)
      const n = k === 0 ? 6 : 1
      for (let i = 0; i < n; i++) events.push(ev({ date, name: `Fiesta ${date} ${i}` }))
    }
    // Un club en otra ciudad y una conferencia el mismo día no compiten
    events.push(ev({ date: '2026-06-13', city_key: 'temuco', region: 'araucania', city: 'Temuco' }))
    events.push(ev({ date: '2026-06-13', category: 'conferencia' }))
    const m = buildDateModel({ events, today: '2026-12-01' })
    const busy = m.evaluate('2026-06-13', { category: 'fiesta', city: 'Providencia' })
    const quiet = m.evaluate('2026-06-20', { category: 'fiesta', city: 'Providencia' })
    const comp = busy.factors.find((f) => f.factor === 'competencia')
    expect(comp.multiplier).toBeLessThan(0.6)
    expect(busy.score).toBeLessThan(quiet.score)
    expect(busy.competition.same_day).toBe(6)
    expect(busy.competition.normal_for_weekday).toBe(1)
    expect(busy.competition.events.every((e) => e.category === 'fiesta')).toBe(true)
    expect(busy.alternatives.length).toBeGreaterThan(0)
    expect(busy.alternatives[0].score).toBeGreaterThan(busy.score)
    // Excluir un evento lo saca de la competencia
    const excl = m.evaluate('2026-06-13', { category: 'fiesta', city: 'Santiago', exclude_keys: [`ext:${busy.competition.events[0].external_event_id}`] })
    expect(excl.competition.same_day).toBe(5)
  })

  it('un evento grande del mismo día pesa aunque sea de otro tipo', () => {
    const m = buildDateModel({ events: [ev({ date: '2026-06-13', category: 'concierto', capacity: 50000, name: 'Estadio' })], today: '2026-12-01' })
    const r = m.evaluate('2026-06-13', { category: 'teatro', city: 'Santiago' })
    expect(r.competition.events[0]).toMatchObject({ name: 'Estadio', weight: 1.6 })
  })

  it('fecha lejana: corrige por eventos aún no anunciados; fecha cercana: castiga la poca anticipación', () => {
    const m = buildDateModel({ events: [ev({ date: '2026-10-10' })], today: '2026-06-01' })
    const far = m.evaluate('2026-10-10', { category: 'fiesta', city: 'Santiago' })
    expect(far.competition.pressure).toBeGreaterThan(1)
    expect(far.factors.find((f) => f.factor === 'competencia').detail).toMatch(/anunciado/)
    expect(far.confidence.reasons.join(' ')).toMatch(/aún no se anuncian/)
    const soon = m.evaluate('2026-06-06', { category: 'fiesta', city: 'Santiago' })
    expect(soon.factors.find((f) => f.factor === 'anticipacion')).toMatchObject({ multiplier: 0.8 })
  })

  it('la noche: una fiesta del sábado a la 01:00 cuenta como viernes', () => {
    expect(nightDate('2026-06-13', '01:00')).toBe('2026-06-12')
    expect(nightDate('2026-06-13', '22:00')).toBe('2026-06-13')
    const m = buildDateModel({ events: [ev({ date: '2026-06-13', start_time: '01:00' })], today: '2026-12-01' })
    expect(m.evaluate('2026-06-12', { category: 'fiesta', city: 'Santiago' }).competition.same_day).toBe(1)
    expect(m.evaluate('2026-06-13', { category: 'fiesta', city: 'Santiago' }).competition.same_day).toBe(0)
  })

  it('los datos corrigen el supuesto del día de la semana y los resultados ajustan la nota', () => {
    const events = []
    // 60 stand-up registrados los martes en Santiago
    for (let i = 0; i < 60; i++) events.push(ev({ category: 'stand_up', date: addDays('2025-01-07', 7 * i), name: `Impro ${i}` }))
    const m = buildDateModel({ events, today: '2026-12-01' })
    const r = m.evaluate('2027-03-02', { category: 'stand_up', city: 'Santiago' })
    expect(r.factors[0].detail).toMatch(/60 eventos registrados/)
    const prior = buildDateModel({ events: [], today: '2026-12-01' }).evaluate('2027-03-02', { category: 'stand_up', city: 'Santiago' })
    expect(r.factors[0].multiplier).toBeGreaterThan(prior.factors[0].multiplier)

    // Resultados: los viernes se agotan, los jueves no
    const outcomes = []
    for (let i = 0; i < 10; i++) outcomes.push(ev({ category: 'teatro', date: addDays('2026-01-02', 7 * i), sold_out: true, name: `V${i}` }))
    for (let i = 0; i < 10; i++) outcomes.push(ev({ category: 'teatro', date: addDays('2026-01-01', 7 * i), sold_out: false, name: `J${i}` }))
    const mo = buildDateModel({ events: outcomes, today: '2026-12-01' })
    const fri = mo.evaluate('2027-03-05', { category: 'teatro', city: 'Santiago' })
    const thu = mo.evaluate('2027-03-04', { category: 'teatro', city: 'Santiago' })
    expect(fri.factors.find((f) => f.factor === 'resultados').multiplier).toBeGreaterThan(1)
    expect(thu.factors.find((f) => f.factor === 'resultados').multiplier).toBeLessThan(1)
  })

  it('nicho: el mismo nicho compite de lleno; otro nicho de la misma categoría compite menos', () => {
    const events = [ev({ date: '2026-06-13', niche: 'techno', name: 'T' }), ev({ date: '2026-06-13', niche: 'reggaeton', name: 'R' })]
    const m = buildDateModel({ events, today: '2026-12-01' })
    const r = m.evaluate('2026-06-13', { category: 'fiesta', niche: 'techno', city: 'Santiago' })
    const w = Object.fromEntries(r.competition.events.map((e) => [e.name, e.weight]))
    expect(w.T).toBe(1)
    expect(w.R).toBe(0.6)
    // Sin nicho en la consulta, ambos pesan igual
    const any = m.evaluate('2026-06-13', { category: 'fiesta', city: 'Santiago' })
    expect(any.competition.events.map((e) => e.weight)).toEqual([1, 1])
  })

  it('gira: compite en cada ciudad de sus funciones y un evento no compite consigo mismo', () => {
    const tour = [
      ev({ id: 500, key: 'ext:500:2026-06-12:santiago', show_key: 'ext:500', date: '2026-06-12', category: 'concierto', name: 'Gira' }),
      ev({ id: 500, key: 'ext:500:2026-06-13:gran_valparaiso', show_key: 'ext:500', date: '2026-06-13', category: 'concierto', city_key: 'gran_valparaiso', region: 'valparaiso', name: 'Gira' }),
    ]
    const m = buildDateModel({ events: tour, today: '2026-12-01' })
    expect(m.evaluate('2026-06-13', { category: 'concierto', city: 'Viña del Mar' }).competition.same_day).toBe(1)
    expect(m.evaluate('2026-06-12', { category: 'concierto', city: 'Santiago' }).competition.same_day).toBe(1)
    expect(m.evaluate('2026-06-13', { category: 'concierto', city: 'Viña del Mar', exclude_keys: ['ext:500'] }).competition.same_day).toBe(0)
  })

  it('precio vs mercado', () => {
    const events = [10000, 15000, 20000, 25000].map((p, i) => ev({ category: 'concierto', price_min: p, price_max: p * 2, name: `C${i}` }))
    const r = buildDateModel({ events, today: '2026-12-01' }).evaluate('2027-03-06', { category: 'concierto', city: 'Santiago', price: 18000 })
    expect(r.price_check).toMatchObject({ n: 4, median_price_min: 17500, percentile: 50 })
  })

  it('recomienda fechas: ranking, filtro por día y mejor fecha por semana', () => {
    const m = buildDateModel({ events: [], today: '2026-03-01' })
    const r = m.recommend({ category: 'fiesta', city: 'Santiago' }, { from: '2026-06-01', to: '2026-06-28', top: 5 })
    expect(r.evaluated_dates).toBe(28)
    expect(r.top).toHaveLength(5)
    expect(r.top.map((t) => t.score)).toEqual([...r.top.map((t) => t.score)].sort((a, b) => b - a))
    expect(['viernes', 'sábado']).toContain(r.top[0].weekday)
    expect(r.best_per_week.length).toBe(4)
    const fridays = m.recommend({ category: 'fiesta', city: 'Santiago' }, { from: '2026-06-01', to: '2026-06-28', weekdays: [5] })
    expect(fridays.top.every((t) => t.weekday === 'viernes')).toBe(true)
    expect(fridays.evaluated_dates).toBe(4)
  })
})

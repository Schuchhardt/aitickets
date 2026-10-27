// Rediseño de la página del evento y del checkout: helpers puros de presentación (fechas es-CL, estados de
// la card de acción, modelo del checkout, estado en la URL), sugerencia de typo de email, tinte del póster y
// división del nombre en el servidor.
import { describe, expect, it } from 'vitest'

import {
  formatLongDate,
  formatShortDate,
  formatTimeRange,
  miniCalendar,
  cardState,
  stockSummary,
  checkoutFunctions,
  ticketRowsFor,
  readCheckoutParams,
  writeCheckoutParams,
  parseEntradas,
  serializeEntradas,
  multiplePlacesLabel,
  placesOf,
  firstNameOf,
  initialsOf,
  ticketMax,
  formatSaleStart,
  cardLabel,
  cardFunctionChips,
  formatChipDate,
  formatWaitingDate,
  attendeeFeedUrl,
  functionListModel,
  formatMonthLabel,
  groupByMonth,
  FUNCTION_LIST_LIMIT,
} from '../../src/components/event/eventView.js'
import { suggestEmail, levenshtein } from '../../src/components/event/emailSuggest.js'
import { dominantColor, pastelTint, tintContrast } from '../../src/lib/eventTint.js'
import { splitFullName } from '../../netlify/lib/buyer-name.mjs'

const NOW = new Date('2026-10-13T15:00:00Z')
const future = (date, id, venue = { name: 'Sala Agustín Siré', city: 'Providencia' }) => ({
  id,
  date,
  start_time: '21:00:00',
  end_time: null,
  end_iso: `${date}T23:59:00-03:00`,
  venue,
})

describe('fechas en es-CL', () => {
  it('"Domingo 8 de noviembre" sin "De" con mayúscula', () => {
    expect(formatLongDate('2026-11-08', { now: NOW })).toBe('Domingo 8 de noviembre')
    expect(formatLongDate('2027-01-02', { now: NOW })).toBe('Sábado 2 de enero de 2027')
  })
  it('formato corto y mini-calendario', () => {
    expect(formatShortDate('2026-10-25')).toBe('Dom 25 oct')
    expect(miniCalendar('2026-11-08')).toEqual({ month: 'NOV', day: '8', weekday: 'DOM' })
  })
  it('rango de horas con guion largo y "Desde las"', () => {
    expect(formatTimeRange({ start_time: '12:00:00', end_time: '15:00:00' })).toBe('12:00 – 15:00')
    expect(formatTimeRange({ start_time: '20:00' })).toBe('Desde las 20:00')
  })
  it('apertura de venta en hora de Chile', () => {
    expect(formatSaleStart('2026-10-20T13:00:00Z')).toBe('20 oct, 10:00')
  })
})

describe('estado de la card de acción', () => {
  const base = { dates: [future('2026-11-08', 1)], unavailable_tickets: [] }
  it('gratis, pagado simple y pagado con varias entradas', () => {
    expect(cardState({ ...base, sale_state: 'on_sale', tickets: [{ id: 1, price: 0 }] }, NOW)).toBe('free')
    expect(cardState({ ...base, sale_state: 'on_sale', tickets: [{ id: 1, price: 4000 }] }, NOW)).toBe('paid_simple')
    expect(cardState({ ...base, sale_state: 'on_sale', tickets: [{ id: 1, price: 4000 }, { id: 2, price: 0 }] }, NOW)).toBe('paid_multi')
  })
  it('agotado: lleno si era gratis, agotado si era pagado', () => {
    expect(cardState({ ...base, sale_state: 'sold_out', tickets: [], unavailable_tickets: [{ price: 0, reason: 'sold_out' }] }, NOW)).toBe('free_full')
    expect(cardState({ ...base, sale_state: 'sold_out', tickets: [], unavailable_tickets: [{ price: 5000, reason: 'sold_out' }] }, NOW)).toBe('sold_out')
  })
  it('venta por abrir, terminado y vista previa', () => {
    expect(cardState({ ...base, sale_state: 'upcoming', tickets: [] }, NOW)).toBe('upcoming')
    expect(cardState({ dates: [{ ...future('2026-10-01', 1), end_iso: '2026-10-01T23:00:00-03:00' }], sale_state: 'closed', tickets: [] }, NOW)).toBe('ended')
    expect(cardState({ ...base, is_preview: true, status: 'draft', sale_state: 'on_sale', tickets: [{ id: 1, price: 0 }] }, NOW)).toBe('preview')
  })
  it('"Quedan N" con ≤ 10 o ≤ 15 % del total', () => {
    expect(stockSummary({ tickets: [{ remaining: 8, total_quantity: 200 }] })).toEqual({ remaining: 8, total: 200, few: true })
    expect(stockSummary({ tickets: [{ remaining: 14, total_quantity: 100 }] }).few).toBe(true)
    expect(stockSummary({ tickets: [{ remaining: 40, total_quantity: 100 }] }).few).toBe(false)
    expect(stockSummary({ tickets: [{ remaining: null }] })).toBeNull()
  })
})

describe('card de acción v2: rótulo de estado (§4.4b)', () => {
  const base = { dates: [future('2026-11-08', 1)], unavailable_tickets: [] }
  const label = (event, state, opts = {}) => cardLabel(event, state, { now: NOW, ...opts })
  const free = { ...base, sale_state: 'on_sale', tickets: [{ id: 1, price: 0, remaining: null }] }
  const paid = { ...base, sale_state: 'on_sale', tickets: [{ id: 1, price: 4000, remaining: null }] }

  it('gratis: con cupos, pocos cupos, confirmado, ya inscrito y lleno', () => {
    expect(label(free, 'free')).toEqual({ text: 'Gratis', tone: 'neutral' })
    const few = { ...free, tickets: [{ id: 1, price: 0, remaining: 8, total_quantity: 100 }] }
    expect(label(few, 'free')).toEqual({ text: 'Gratis · Quedan 8 cupos', tone: 'warning' })
    expect(label({ ...free, tickets: [{ id: 1, price: 0, remaining: 1, total_quantity: 100 }] }, 'free').text).toBe('Gratis · Queda 1 cupo')
    expect(label(free, 'free', { rsvpStatus: 'confirmed' })).toEqual({ text: 'Asistencia confirmada', tone: 'positive' })
    expect(label(free, 'free', { rsvpStatus: 'success' })).toEqual({ text: 'Asistencia confirmada', tone: 'positive' })
    expect(label(free, 'free', { rsvpStatus: 'already' })).toEqual({ text: 'Ya estás inscrito', tone: 'neutral' })
    expect(label(free, 'free', { rsvpStatus: 'full' }).text).toBe('Gratis · Cupos llenos')
    expect(label({ ...base, tickets: [] }, 'free_full', { rsvpStatus: 'full' }).text).toBe('Gratis · Cupos llenos')
    expect(label({ ...base, tickets: [] }, 'free_full', { rsvpStatus: 'waitlist_ok' }).text).toBe('Gratis · Cupos llenos')
  })

  it('pagado: el precio abre la card salvo últimas entradas o varias funciones', () => {
    expect(label(paid, 'paid_simple')).toBeNull()
    const multiTypes = { ...paid, tickets: [{ id: 1, price: 4000, remaining: null }, { id: 2, price: 9000, remaining: null }] }
    expect(label(multiTypes, 'paid_multi')).toBeNull()
    const lastOnes = { ...paid, tickets: [{ id: 1, price: 4000, remaining: 5, total_quantity: 100 }] }
    expect(label(lastOnes, 'paid_simple')).toEqual({ text: 'Últimas entradas', tone: 'warning' })
    const nunoa = { name: 'Teatro Ñuñoa', city: 'Ñuñoa' }
    const tour = { ...multiTypes, dates: [future('2026-10-24', 1), future('2026-10-25', 2), future('2026-11-01', 3, nunoa)] }
    expect(label(tour, 'paid_multi')).toEqual({ text: '3 funciones · 2 lugares', tone: 'neutral' })
    expect(label({ ...tour, dates: tour.dates.slice(0, 2) }, 'paid_multi').text).toBe('2 funciones')
  })

  it('sin venta: abre, agotado, finalizado, vista previa y cerrada', () => {
    expect(label({ ...base, sale_starts_at: '2026-10-20T13:00:00Z' }, 'upcoming').text).toBe('Venta abre el 20 oct, 10:00')
    expect(label(base, 'upcoming').text).toBe('Venta próximamente')
    expect(label(base, 'sold_out')).toEqual({ text: 'Agotado', tone: 'neutral' })
    expect(label(base, 'ended').text).toBe('Evento finalizado')
    expect(label(base, 'preview').text).toBe('Vista previa')
    expect(label(base, 'closed').text).toBe('Venta cerrada')
  })
})

describe('card de acción v2: chips de próximas funciones', () => {
  const nunoa = { name: 'Teatro Ñuñoa', city: 'Ñuñoa' }
  const dates = [future('2026-10-23', 1), future('2026-10-24', 2), future('2026-10-30', 3, nunoa), future('2026-10-31', 4, nunoa), future('2026-11-06', 5, nunoa)]
  const tied = (id, extra = {}) => ({ id: 100 + id, price: 4000, event_date_id: id, remaining: null, ...extra })

  it('hasta 3 próximas disponibles, sin agotadas, con el lugar si hay varios y "+ N"', () => {
    const event = {
      dates,
      tickets: [tied(2, { remaining: 4 }), tied(3), tied(4), tied(5)],
      unavailable_tickets: [{ id: 101, price: 4000, event_date_id: 1, reason: 'sold_out' }],
    }
    const { chips, more } = cardFunctionChips(event, { now: NOW })
    expect(chips).toEqual([
      { id: '2', label: 'Sáb 24 · 21:00', place: 'Providencia', few: true },
      { id: '3', label: 'Vie 30 · 21:00', place: 'Ñuñoa', few: false },
      { id: '4', label: 'Sáb 31 · 21:00', place: 'Ñuñoa', few: false },
    ])
    expect(more).toBe(1)
  })

  it('un solo lugar: sin lugar en el chip', () => {
    const event = { dates: dates.slice(0, 2), tickets: [tied(1), tied(2)], unavailable_tickets: [] }
    expect(cardFunctionChips(event, { now: NOW }).chips.map((c) => c.place)).toEqual(['', ''])
  })

  it('entradas válidas para cualquier función (o una sola función): sin chips', () => {
    expect(cardFunctionChips({ dates, tickets: [{ id: 1, price: 4000 }], unavailable_tickets: [] }, { now: NOW })).toEqual({ chips: [], more: 0 })
    expect(cardFunctionChips({ dates: dates.slice(0, 1), tickets: [tied(1)], unavailable_tickets: [] }, { now: NOW })).toEqual({ chips: [], more: 0 })
  })

  it('formatos de fecha de chips y "Te esperamos…"', () => {
    expect(formatChipDate({ date: '2026-10-24', start_time: '21:00:00' })).toBe('Sáb 24 · 21:00')
    expect(formatWaitingDate({ date: '2026-10-24', start_time: '20:00:00' }, { now: NOW })).toBe('el sábado 24, 20:00')
    expect(formatWaitingDate({ date: '2026-11-08', start_time: '20:00:00' }, { now: NOW })).toBe('el domingo 8 de noviembre, 20:00')
    expect(formatWaitingDate({ date: '2026-11-08' }, { now: NOW })).toBe('el domingo 8 de noviembre')
  })

  it('"Ver quiénes van": la orden más reciente de este navegador con id', () => {
    expect(attendeeFeedUrl([{ orderId: 'a' }, { orderId: 'b' }, { amount: 0 }])).toBe('/order/b#quienes-van')
    expect(attendeeFeedUrl([])).toBe('')
    expect(attendeeFeedUrl(undefined)).toBe('')
  })
})

describe('sección Funciones v2 (§4.9b)', () => {
  const nunoa = { name: 'Teatro Ñuñoa', address: 'Av. Irarrázaval 1564', city: 'Ñuñoa' }
  const sire = { name: 'Sala Agustín Siré', address: 'Morandé 750', city: 'Providencia' }
  const tied = (id, extra = {}) => ({ id: 100 + id, price: 4000, final_price: 4381, event_date_id: id, remaining: null, ...extra })

  it('agrupa por lugar con dirección, con estado y desde-precio solo si difiere del general', () => {
    const event = {
      sale_state: 'on_sale',
      dates: [future('2026-10-24', 1, sire), future('2026-10-25', 2, sire), future('2026-11-01', 3, nunoa), future('2026-11-02', 4, nunoa)],
      tickets: [
        tied(1),
        tied(2, { remaining: 3 }),
        tied(3, { price: 6000, final_price: 6571 }),
        tied(3, { id: 203, price: 9000, final_price: 9856 }),
      ],
      unavailable_tickets: [{ id: 104, price: 4000, event_date_id: 4, reason: 'sold_out' }],
    }
    const m = functionListModel(event, { now: NOW })
    expect(m.total).toBe(4)
    expect(m.manyPlaces).toBe(true)
    expect(m.groups.map((g) => [g.title, g.address])).toEqual([
      ['Providencia · Sala Agustín Siré', 'Morandé 750'],
      ['Ñuñoa · Teatro Ñuñoa', 'Av. Irarrázaval 1564'],
    ])
    const rows = m.groups.flatMap((g) => g.months.flatMap((mo) => mo.items))
    expect(rows.map((r) => [r.id, r.label, r.status, r.price, r.order])).toEqual([
      [1, 'Sáb 24 oct · 21:00', 'available', '', 0],
      [2, 'Dom 25 oct · 21:00', 'few', '', 1],
      [3, 'Dom 1 nov · 21:00', 'available', 'Desde $6.571', 2],
      [4, 'Lun 2 nov · 21:00', 'sold_out', '', 3],
    ])
  })

  it('más de 8 funciones en un lugar: por mes; sin venta abierta no hay estado', () => {
    const days = ['2026-10-20', '2026-10-22', '2026-10-24', '2026-10-27', '2026-10-29', '2026-10-31', '2026-11-03', '2026-11-05', '2026-11-07']
    const event = { sale_state: 'upcoming', dates: days.map((d, i) => future(d, i + 1)), tickets: [], unavailable_tickets: days.map((_, i) => ({ id: 300 + i, price: 4000, event_date_id: i + 1, reason: 'upcoming' })) }
    const m = functionListModel(event, { now: NOW })
    expect(m.manyPlaces).toBe(false)
    expect(m.groups[0].months.map((mo) => [mo.label, mo.items.length])).toEqual([['Octubre', 6], ['Noviembre', 3]])
    expect(m.groups[0].months[0].items.every((r) => r.status === null)).toBe(true)
    expect(m.total > FUNCTION_LIST_LIMIT).toBe(true)
  })

  it('entradas válidas para cualquier función: sin estado ni precio por función (no se elige); agotado, todas agotadas', () => {
    const event = { sale_state: 'on_sale', dates: [future('2026-10-24', 1), future('2026-10-25', 2)], tickets: [{ id: 1, price: 4000, final_price: 4381, event_date_id: null }] }
    const rows = functionListModel(event, { now: NOW }).groups[0].months[0].items
    expect(rows.map((r) => [r.status, r.price])).toEqual([[null, ''], [null, '']])
    const soldOut = { ...event, sale_state: 'sold_out', tickets: [], unavailable_tickets: [{ id: 1, price: 4000, event_date_id: null, reason: 'sold_out' }] }
    expect(functionListModel(soldOut, { now: NOW }).groups[0].months[0].items.map((r) => r.status)).toEqual(['sold_out', 'sold_out'])
  })

  it('función cuyas entradas aún no salen a la venta: "upcoming" con la fecha, no agotada', () => {
    const event = {
      sale_state: 'on_sale',
      timezone: 'America/Santiago',
      dates: [future('2026-10-24', 1), future('2026-10-25', 2)],
      tickets: [{ id: 101, price: 4000, final_price: 4381, event_date_id: 1, remaining: null }],
      unavailable_tickets: [{ id: 102, price: 4000, event_date_id: 2, reason: 'upcoming', sales_start: '2026-10-20T13:00:00Z' }],
    }
    const fns = checkoutFunctions(event, NOW).functions
    expect(fns.map((f) => [f.id, f.status, f.salesStart])).toEqual([[1, 'available', null], [2, 'upcoming', '2026-10-20T13:00:00Z']])
    const rows = functionListModel(event, { now: NOW }).groups[0].months[0].items
    expect(rows.map((r) => [r.status, r.opens])).toEqual([['available', ''], ['upcoming', '20 oct, 10:00']])
    // Los chips de la card solo muestran funciones con entradas a la venta
    expect(cardFunctionChips(event, { now: NOW }).chips.map((c) => c.id)).toEqual(['1'])
  })

  it('evento mixto: la función sin entradas propias no tiene estado (el checkout no la ofrece)', () => {
    const event = {
      sale_state: 'on_sale',
      dates: [future('2026-10-24', 1), future('2026-10-25', 2)],
      tickets: [{ id: 101, price: 4000, final_price: 4381, event_date_id: 1, remaining: null }],
    }
    const rows = functionListModel(event, { now: NOW }).groups[0].months[0].items
    expect(rows.map((r) => [r.id, r.status])).toEqual([[1, 'available'], [2, null]])
  })

  it('encabezados de mes', () => {
    expect(formatMonthLabel('2026-11-08', { now: NOW })).toBe('Noviembre')
    expect(formatMonthLabel('2027-01-02', { now: NOW })).toBe('Enero de 2027')
    expect(groupByMonth([{ date: '2026-10-30' }, { date: '2026-11-01' }], { now: NOW }).map((g) => g.label)).toEqual(['Octubre', 'Noviembre'])
  })
})

describe('modelo del checkout (paso 1)', () => {
  it('sin entradas amarradas a una función no se elige función', () => {
    const event = { dates: [future('2026-10-24', 1), future('2026-10-25', 2)], tickets: [{ id: 10, price: 5000, event_date_id: null }] }
    expect(checkoutFunctions(event, NOW)).toEqual({ needsFunction: false, functions: [], places: [] })
  })
  it('2 lugares / funciones con estado (agotada = sin entradas a la venta)', () => {
    const nunoa = { name: 'Teatro Ñuñoa', city: 'Ñuñoa' }
    const event = {
      dates: [future('2026-10-24', 1), future('2026-10-25', 2), future('2026-11-01', 3, nunoa)],
      tickets: [
        { id: 10, price: 5000, event_date_id: 1, remaining: 50 },
        { id: 11, price: 5000, event_date_id: 2, remaining: 3 },
      ],
      unavailable_tickets: [{ id: 12, price: 5000, event_date_id: 3, reason: 'sold_out' }],
    }
    const m = checkoutFunctions(event, NOW)
    expect(m.needsFunction).toBe(true)
    expect(m.functions.map((f) => [f.id, f.status])).toEqual([[1, 'available'], [2, 'few'], [3, 'sold_out']])
    expect(m.places.map((p) => p.key)).toEqual(['Sala Agustín Siré', 'Teatro Ñuñoa'])
    expect(multiplePlacesLabel(placesOf(event.dates))).toBe('2 lugares · Providencia y Ñuñoa')
  })
  it('filas por función: amarradas + válidas para cualquiera + no disponibles atenuadas', () => {
    const event = {
      tickets: [
        { id: 10, price: 5000, event_date_id: 1 },
        { id: 11, price: 9000, event_date_id: null },
        { id: 12, price: 5000, event_date_id: 2 },
      ],
      unavailable_tickets: [{ id: 13, price: 4000, event_date_id: null, reason: 'upcoming', sales_start: '2026-11-01T12:00:00Z' }],
    }
    expect(ticketRowsFor(event, '1').map((r) => [r.id, r.status])).toEqual([[10, 'available'], [11, 'available'], [13, 'upcoming']])
  })
  it('máximo por compra limitado por el stock', () => {
    expect(ticketMax({ max_quantity: 10, remaining: 3 })).toBe(3)
    expect(ticketMax({ max_quantity: null, remaining: null })).toBe(10)
  })
})

describe('estado del checkout en la URL', () => {
  it('ida y vuelta de ?checkout=1&paso=2&funcion=679&entradas=82:2,83:1', () => {
    const params = new URLSearchParams('utm_source=ig&code=PROMO10')
    writeCheckoutParams(params, { open: true, step: 2, functionId: '679', selection: { 82: 2, 83: 1, 84: 0 } })
    expect(params.toString()).toBe('utm_source=ig&code=PROMO10&checkout=1&paso=2&funcion=679&entradas=82%3A2%2C83%3A1')
    expect(readCheckoutParams(params)).toMatchObject({ open: true, step: 2, functionId: '679', selection: { 82: 2, 83: 1 }, code: 'PROMO10' })
    writeCheckoutParams(params, { open: false })
    expect(params.toString()).toBe('utm_source=ig&code=PROMO10')
  })
  it('ignora basura en entradas', () => {
    expect(parseEntradas('82:2,x:1,83:0,84:999')).toEqual({ 82: 2, 84: 50 })
    expect(serializeEntradas({ 1: 0, 2: 3 })).toBe('2:3')
  })
})

describe('sugerencia de typo de email', () => {
  it('sugiere el dominio conocido más cercano (distancia ≤ 2)', () => {
    expect(suggestEmail('seba@gmial.com')).toBe('seba@gmail.com')
    expect(suggestEmail('seba@hotmial.cl')).toBe('seba@hotmail.cl')
    expect(suggestEmail('ana@outlok.com')).toBe('ana@outlook.com')
  })
  it('no sugiere si el dominio es correcto, desconocido o incompleto', () => {
    expect(suggestEmail('seba@gmail.com')).toBe('')
    expect(suggestEmail('seba@empresa.cl')).toBe('')
    expect(suggestEmail('seba@gm')).toBe('')
    expect(suggestEmail('seba')).toBe('')
  })
  it('levenshtein', () => {
    expect(levenshtein('gmial.com', 'gmail.com')).toBe(2)
  })
})

describe('tinte del póster', () => {
  it('toma el color más frecuente con saturación y luminosidad razonables', () => {
    // 6 píxeles negros (sin saturación) + 4 naranjos: gana el naranjo
    const px = []
    for (let i = 0; i < 6; i++) px.push(10, 10, 10)
    for (let i = 0; i < 4; i++) px.push(232, 87, 42)
    const { color } = dominantColor(Uint8Array.from(px), 3)
    expect(color).toBe('#e8572a')
  })
  it('sin candidatos (todo gris) => sin color', () => {
    expect(dominantColor(Uint8Array.from([128, 128, 128, 120, 120, 120]), 3).color).toBeNull()
  })
  it('tinte pastel: saturación ≤ 30 %, luminosidad 95 % y texto secundario AA', () => {
    const tint = pastelTint('#e8572a')
    expect(tint).toBe('14 30% 95%')
    expect(tintContrast(tint)).toBeGreaterThan(4.5)
  })
})

describe('nombre del comprador', () => {
  it('primer token => nombre, resto => apellido', () => {
    expect(splitFullName('  Sebastián   Pérez Soto ')).toEqual({ firstName: 'Sebastián', lastName: 'Pérez Soto' })
    expect(splitFullName('Seba')).toEqual({ firstName: 'Seba', lastName: '' })
    expect(splitFullName('')).toEqual({ firstName: '', lastName: '' })
  })
  it('primer nombre e iniciales para la UI', () => {
    expect(firstNameOf('seba pérez')).toBe('Seba')
    expect(initialsOf('Club Surco')).toBe('CS')
  })
})

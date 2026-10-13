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

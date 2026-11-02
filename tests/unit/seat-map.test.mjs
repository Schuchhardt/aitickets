import { describe, it, expect } from 'vitest'
import {
  SEAT_MAP_TEMPLATES,
  seatMapFromTemplate,
  normalizeSeatMap,
  listSeats,
  seatLabel,
  seatCountBySection,
  totalSeats,
  rowLabel,
  assignSeatsToLines,
  seatedTicketCapacity,
  missingSeats,
  normalizeSeatSections,
  MAX_SEATS,
  pickBestSeats,
} from '../../src/lib/seatMap.mjs'
import { validateSeatSelection } from '../../netlify/lib/seats.mjs'
import { buildAttendeeRows } from '../../netlify/lib/tickets.mjs'
import { checkoutFunctions, cardState } from '../../src/components/event/eventView.js'

describe('plantillas', () => {
  it('todas producen un mapa válido con asientos', () => {
    for (const tpl of SEAT_MAP_TEMPLATES) {
      const map = seatMapFromTemplate(tpl.id)
      expect(map.template).toBe(tpl.id)
      expect(totalSeats(map)).toBeGreaterThan(0)
      expect(normalizeSeatMap(map)).toEqual(map)
    }
  })
  it('la sala pequeña tiene 8 × 12', () => {
    expect(totalSeats(seatMapFromTemplate('cine-pequeno'))).toBe(96)
  })
})

describe('normalizeSeatMap', () => {
  it('null o sin secciones = entrada general', () => {
    expect(normalizeSeatMap(null)).toBeNull()
    expect(normalizeSeatMap({ sections: [] })).toBeNull()
  })
  it('acota filas y asientos, descarta pasillos y huecos fuera de rango y deduplica ids', () => {
    const map = normalizeSeatMap({
      sections: [
        { id: 'Sala', name: 'Sala', rows: 3, seatsPerRow: 5, aisles: [0, 2, 5, 9], removed: ['A-1', 'Z-1', 'B-9', 'x'] },
        { id: 'sala', name: 'Otra', rows: 999, seatsPerRow: -3 },
      ],
    })
    expect(map.sections[0]).toMatchObject({ id: 'sala', aisles: [2], removed: ['A-1'] })
    expect(map.sections[1].id).not.toBe('sala')
    expect(map.sections[1].rows).toBe(40)
    expect(map.sections[1].seatsPerRow).toBe(1)
  })
  it('respeta el máximo de asientos', () => {
    const map = normalizeSeatMap({ sections: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, rows: 40, seatsPerRow: 60 })) })
    expect(totalSeats(map)).toBeLessThanOrEqual(MAX_SEATS)
  })
})

describe('recorrido y etiquetas', () => {
  const map = normalizeSeatMap({
    stage: 'Pantalla',
    sections: [
      { id: 'general', name: 'General', rows: 2, seatsPerRow: 3, removed: ['A-2'] },
      { id: 'vip', name: 'VIP', rows: 1, seatsPerRow: 2, firstRow: 'C' },
    ],
  })
  it('lista asientos sin huecos', () => {
    expect(listSeats(map).map((s) => s.key)).toEqual([
      'general:A:1', 'general:A:3', 'general:B:1', 'general:B:2', 'general:B:3', 'vip:C:1', 'vip:C:2',
    ])
    expect(seatCountBySection(map)).toEqual({ general: 5, vip: 2 })
  })
  it('etiqueta con sección solo si hay varias', () => {
    expect(seatLabel(map, 'vip:C:2')).toBe('VIP · Fila C · Asiento 2')
    const single = normalizeSeatMap({ sections: [{ id: 'sala', name: 'Sala', rows: 1, seatsPerRow: 2 }] })
    expect(seatLabel(single, 'sala:A:1')).toBe('Fila A · Asiento 1')
    expect(seatLabel(map, 'general:A:2')).toBe('') // hueco
  })
  it('filas después de la Z', () => {
    expect(rowLabel('A', 25)).toBe('Z')
    expect(rowLabel('A', 26)).toBe('AA')
    expect(rowLabel('Y', 3)).toBe('AB')
  })
})

describe('assignSeatsToLines', () => {
  const map = seatMapFromTemplate('cine-preferencial') // general (A-H) + preferencial (I-L)
  it('exige un asiento por entrada', () => {
    expect(assignSeatsToLines(map, [{ id: 1, quantity: 2 }], ['general:A:1']).error).toMatch(/Elige 2 asientos/)
  })
  it('rechaza claves inexistentes', () => {
    expect(assignSeatsToLines(map, [{ id: 1, quantity: 1 }], ['general:Z:99']).error).toBeTruthy()
  })
  it('empareja respetando secciones aunque el orden no ayude', () => {
    const lines = [
      { id: 1, quantity: 1, seat_sections: null }, // vale en cualquiera
      { id: 2, quantity: 1, seat_sections: ['general'] },
    ]
    const r = assignSeatsToLines(map, lines, ['general:A:1', 'preferencial:I:1'])
    expect(r.error).toBeUndefined()
    const byTicket = Object.fromEntries(r.map((a) => [a.ticketId, a.key]))
    expect(byTicket[2]).toBe('general:A:1')
    expect(byTicket[1]).toBe('preferencial:I:1')
  })
  it('rechaza un asiento fuera de las secciones de la entrada', () => {
    const r = assignSeatsToLines(map, [{ id: 2, quantity: 1, seat_sections: ['general'] }], ['preferencial:I:1'])
    expect(r.error).toMatch(/Preferencial · Fila I · Asiento 1/)
  })
})

describe('cupo y cambios del mapa', () => {
  const map = seatMapFromTemplate('cine-preferencial')
  const maps = new Map([['10', map], ['11', map]])
  it('cupo = asientos de sus secciones en las funciones donde vale', () => {
    expect(seatedTicketCapacity({ event_date_id: null, seat_sections: null }, maps)).toBe(2 * 168)
    expect(seatedTicketCapacity({ event_date_id: 10, seat_sections: ['preferencial'] }, maps)).toBe(56)
  })
  it('secciones: vacío = todas, ids desconocidos se descartan', () => {
    expect(normalizeSeatSections([], map)).toBeNull()
    expect(normalizeSeatSections(['vip', 'general'], map)).toEqual(['general'])
  })
  it('detecta asientos vendidos que el nuevo mapa quita', () => {
    const smaller = normalizeSeatMap({ ...map, sections: [map.sections[0]] })
    expect(missingSeats(smaller, ['general:A:1', 'preferencial:I:1'])).toEqual(['preferencial:I:1'])
    expect(missingSeats(null, ['general:A:1'])).toEqual(['general:A:1'])
  })
})

describe('validateSeatSelection (servidor)', () => {
  const map = seatMapFromTemplate('cine-pequeno')
  const seating = { seated: true, mapsByDate: new Map([[7, map]]), dates: new Map([[7, { id: 7, date: '2099-01-01', start_time: '20:00' }]]) }
  const lines = [{ id: 1, quantity: 2, event_date_id: null }]
  it('devuelve los asientos con etiqueta y entrada', () => {
    const r = validateSeatSelection({ seating, lines, sectionsOf: () => null, raw: { eventDateId: 7, keys: ['platea:B:3', 'platea:B:4'] } })
    expect(r.selection).toEqual({
      event_date_id: 7,
      seats: [
        { key: 'platea:B:3', label: 'Fila B · Asiento 3', ticket_id: 1 },
        { key: 'platea:B:4', label: 'Fila B · Asiento 4', ticket_id: 1 },
      ],
    })
  })
  it('exige función con mapa, la cantidad justa y entradas de esa función', () => {
    expect(validateSeatSelection({ seating, lines, sectionsOf: () => null, raw: null }).error).toBeTruthy()
    expect(validateSeatSelection({ seating, lines, sectionsOf: () => null, raw: { eventDateId: 7, keys: ['platea:B:3'] } }).error).toMatch(/Elige 2/)
    expect(validateSeatSelection({ seating, lines: [{ id: 1, quantity: 1, event_date_id: 99 }], sectionsOf: () => null, raw: { eventDateId: 7, keys: ['platea:A:1'] } }).error).toMatch(/otra función/)
    expect(validateSeatSelection({ seating, lines, sectionsOf: () => null, raw: { eventDateId: 7, keys: ['platea:A:1', 'platea:A:2'] }, isFunctionOpen: () => false }).error).toMatch(/ya no está/)
  })
})

describe('buildAttendeeRows con asientos', () => {
  it('cada QR lleva su asiento según su entrada', () => {
    const rows = buildAttendeeRows({
      eventId: 1, attendeeId: 2, orderId: 'o', lines: [{ id: 5, quantity: 1 }, { id: 6, quantity: 1 }],
      seats: [{ key: 'vip:C:1', label: 'VIP · Fila C · Asiento 1', ticket_id: 6 }, { key: 'general:A:1', label: 'General · Fila A · Asiento 1', ticket_id: 5 }],
    })
    expect(rows.map((r) => [r.event_ticket_id, r.seat_key, r.seat_label])).toEqual([
      [5, 'general:A:1', 'General · Fila A · Asiento 1'],
      [6, 'vip:C:1', 'VIP · Fila C · Asiento 1'],
    ])
  })
  it('sin asientos no agrega columnas nuevas', () => {
    const [row] = buildAttendeeRows({ eventId: 1, attendeeId: 2, orderId: 'o', lines: [{ id: 5, quantity: 1 }] })
    expect('seat_key' in row).toBe(false)
  })
})

describe('checkout con entradas numeradas', () => {
  const now = new Date('2099-01-01T12:00:00Z')
  const event = {
    sale_state: 'on_sale',
    tickets: [{ id: 1, price: 0, event_date_id: null }],
    dates: [
      { id: 7, date: '2099-01-02', start_time: '20:00', end_iso: '2099-01-02T23:00:00-03:00', start_iso: '2099-01-02T20:00:00-03:00', venue: { name: 'Sala 1' } },
      { id: 8, date: '2099-01-03', start_time: '20:00', end_iso: '2099-01-03T23:00:00-03:00', start_iso: '2099-01-03T20:00:00-03:00', venue: { name: 'Sala 1' } },
    ],
    seating: { maps: { m1: seatMapFromTemplate('cine-pequeno') }, map_of_date: { 7: 'm1', 8: 'm1' }, seats_left: { 7: 0, 8: 50 } },
  }
  it('siempre se elige función y se agota la que no tiene asientos', () => {
    const m = checkoutFunctions(event, now)
    expect(m.needsFunction).toBe(true)
    expect(m.functions.map((f) => [f.id, f.status])).toEqual([[7, 'sold_out'], [8, 'available']])
  })
  it('usa el checkout aunque sea gratis', () => {
    expect(cardState(event, now)).toBe('paid_multi')
  })
})

describe('pickBestSeats (cortesías)', () => {
  const map = normalizeSeatMap({ sections: [{ id: 'sala', name: 'Sala', rows: 5, seatsPerRow: 10, aisles: [5] }] })
  it('juntos, centrados y sin cruzar el pasillo', () => {
    const seats = pickBestSeats(map, [], 2)
    expect(seats).toHaveLength(2)
    const [a, b] = seats.map((k) => k.split(':'))
    expect(a[1]).toBe(b[1]) // misma fila
    expect(Math.abs(Number(a[2]) - Number(b[2]))).toBe(1)
    // El pasillo va después del 5: los dos quedan del mismo lado
    expect(Number(a[2]) <= 5).toBe(Number(b[2]) <= 5)
  })
  it('evita los ocupados y, si no hay juntos, devuelve separados; [] si no alcanza', () => {
    const all = listSeats(map).map((s) => s.key)
    const taken = all.filter((k, i) => i % 2 === 0) // uno sí, uno no: nunca 2 juntos
    const seats = pickBestSeats(map, taken, 3)
    expect(seats).toHaveLength(3)
    expect(seats.some((k) => taken.includes(k))).toBe(false)
    expect(pickBestSeats(map, all.slice(1), 2)).toEqual([])
  })
  it('respeta las secciones permitidas', () => {
    const two = seatMapFromTemplate('cine-preferencial')
    expect(pickBestSeats(two, [], 4, ['preferencial']).every((k) => k.startsWith('preferencial:'))).toBe(true)
  })
})

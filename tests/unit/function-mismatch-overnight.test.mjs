// Aviso "esta entrada es para otra función" (contrato R1) en eventos con funciones que cruzan la medianoche:
// a las 00:30 del sábado la función que se valida es la del viernes 22:00–04:00, no la del sábado.
import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { isOtherFunction } from '../../src/lib/sessionCheckin.mjs'
import { getFunctionCheck } from '../../netlify/lib/checkin.mjs'

// Viernes 6 y sábado 7 de noviembre de 2026, de 22:00 a 04:00
const DATES = [
  { id: 601, event_id: 20, date: '2026-11-06', start_time: '22:00:00', end_time: '04:00:00' },
  { id: 602, event_id: 20, date: '2026-11-07', start_time: '22:00:00', end_time: '04:00:00' },
]
const [FRI, SAT] = DATES
const at = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00-03:00`) // Santiago en noviembre = UTC-3

describe('isOtherFunction', () => {
  it('en la madrugada de la fiesta del viernes, su entrada vale y la del sábado es de otra función', () => {
    expect(isOtherFunction(FRI, DATES, at('2026-11-07', '00:30'))).toBe(false)
    expect(isOtherFunction(SAT, DATES, at('2026-11-07', '00:30'))).toBe(true)
  })
  it('terminada la fiesta del viernes, vuelve a mandar el día', () => {
    expect(isOtherFunction(FRI, DATES, at('2026-11-07', '21:00'))).toBe(true)
    expect(isOtherFunction(SAT, DATES, at('2026-11-07', '21:00'))).toBe(false)
  })
  it('funciones del mismo día sin cruzar la medianoche: igual que antes (por día)', () => {
    const day = [{ id: 1, date: '2026-11-06', start_time: '15:00:00' }, { id: 2, date: '2026-11-06', start_time: '20:00:00' }]
    expect(isOtherFunction(day[0], day, at('2026-11-06', '19:00'))).toBe(false)
    expect(isOtherFunction(day[1], day, at('2026-11-07', '10:00'))).toBe(true)
  })
})

describe('getFunctionCheck', () => {
  const db = () => createFakeSupabase({ tables: { event_dates: DATES.map((d) => ({ ...d })) } })
  it('00:30 del sábado: la entrada del viernes no avisa y la del sábado sí', async () => {
    const now = at('2026-11-07', '00:30')
    expect((await getFunctionCheck(db(), 20, 601, now)).function_mismatch).toBe(false)
    expect((await getFunctionCheck(db(), 20, 602, now)).function_mismatch).toBe(true)
  })
  it('la noche del sábado: la entrada del viernes sí avisa', async () => {
    expect((await getFunctionCheck(db(), 20, 601, at('2026-11-07', '23:00'))).function_mismatch).toBe(true)
    expect((await getFunctionCheck(db(), 20, 602, at('2026-11-07', '23:00'))).function_mismatch).toBe(false)
  })
})

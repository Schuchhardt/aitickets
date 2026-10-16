import { describe, it, expect } from 'vitest'
import { splitFullName, greetingName, holderName } from '../../netlify/lib/buyer-name.mjs'

describe('splitFullName: nombres compuestos', () => {
  it('une los compuestos conocidos', () => {
    expect(splitFullName('María José Pérez Soto')).toEqual({ firstName: 'María José', lastName: 'Pérez Soto' })
    expect(splitFullName('maria jose perez')).toEqual({ firstName: 'maria jose', lastName: 'perez' })
    expect(splitFullName('Juan Pablo González')).toEqual({ firstName: 'Juan Pablo', lastName: 'González' })
    expect(splitFullName('José Miguel')).toEqual({ firstName: 'José Miguel', lastName: '' })
    expect(splitFullName('María de los Ángeles Rojas')).toEqual({ firstName: 'María de los Ángeles', lastName: 'Rojas' })
    expect(splitFullName('Juan de Dios Soto')).toEqual({ firstName: 'Juan de Dios', lastName: 'Soto' })
  })

  it('no une cuando el segundo token es apellido', () => {
    expect(splitFullName('Sebastián Pérez Soto')).toEqual({ firstName: 'Sebastián', lastName: 'Pérez Soto' })
    expect(splitFullName('María González')).toEqual({ firstName: 'María', lastName: 'González' })
    expect(splitFullName('María de la Fuente')).toEqual({ firstName: 'María', lastName: 'de la Fuente' })
    expect(splitFullName('Juan Cruz')).toEqual({ firstName: 'Juan', lastName: 'Cruz' })
  })
})

describe('greetingName', () => {
  it('corrige registros antiguos divididos en el primer espacio', () => {
    expect(greetingName('María', 'José Pérez')).toBe('María José')
    expect(greetingName('Juan', 'Pablo')).toBe('Juan Pablo')
    expect(greetingName('Ana', 'Pérez')).toBe('Ana')
  })

  it('arregla mayúsculas solo si todo viene en minúsculas o mayúsculas', () => {
    expect(greetingName('maria jose', 'perez')).toBe('Maria Jose')
    expect(greetingName('MARÍA DE LOS ÁNGELES', 'ROJAS')).toBe('María de los Ángeles')
    expect(greetingName('McKenzie', null)).toBe('McKenzie')
    expect(greetingName("sinéad o'brien", null)).toBe('Sinéad')
  })

  it('usa el genérico si no hay nombre (no saluda por el apellido)', () => {
    expect(greetingName(null, null)).toBe('Asistente')
    expect(greetingName('   ', 'Pérez')).toBe('Asistente')
    expect(greetingName('', '', 'asistente')).toBe('asistente')
  })
})

describe('holderName', () => {
  const attendee = { first_name: 'seba', last_name: null }
  it('prefiere el nombre escrito en la orden', () => {
    expect(holderName(attendee, { buyer_first_name: 'Sebastián', buyer_last_name: 'Pérez' })).toEqual({ first_name: 'Sebastián', last_name: 'Pérez' })
    expect(holderName(attendee, [{ buyer_first_name: 'Sebastián', buyer_last_name: null }])).toEqual({ first_name: 'Sebastián', last_name: null })
  })
  it('usa el del attendee si la orden no tiene nombre o no hay orden', () => {
    expect(holderName(attendee, { buyer_first_name: ' ', buyer_last_name: 'X' })).toEqual({ first_name: 'seba', last_name: null })
    expect(holderName(attendee, null)).toEqual({ first_name: 'seba', last_name: null })
    expect(holderName(null, null)).toEqual({ first_name: null, last_name: null })
  })
})

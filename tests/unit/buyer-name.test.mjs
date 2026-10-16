import { describe, it, expect } from 'vitest'
import { splitFullName, greetingName, holderName, normalizePersonName, normalizeNameParts } from '../../netlify/lib/buyer-name.mjs'
import { firstNameOf } from '../../src/components/event/eventView.js'

describe('splitFullName: nombres compuestos', () => {
  it('une los compuestos conocidos', () => {
    expect(splitFullName('María José Pérez Soto')).toEqual({ firstName: 'María José', lastName: 'Pérez Soto' })
    expect(splitFullName('maria jose perez')).toEqual({ firstName: 'Maria Jose', lastName: 'Perez' })
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

  it('normaliza mayúsculas y espacios', () => {
    expect(greetingName('maria jose', 'perez')).toBe('Maria Jose')
    expect(greetingName('MARÍA DE LOS ÁNGELES', 'ROJAS')).toBe('María de los Ángeles')
    expect(greetingName('  jaVier ', null)).toBe('Javier')
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

describe('normalizePersonName', () => {
  it('deja siempre la misma forma ("Javier") sin importar cómo se escriba', () => {
    for (const v of ['javier', 'jaVier', '  javier  ', 'JAVIER', 'javier\n']) expect(normalizePersonName(v)).toBe('Javier')
  })
  it('respeta tildes, ñ, apóstrofos, guiones y conectores', () => {
    expect(normalizePersonName('maria   jose')).toBe('Maria Jose')
    expect(normalizePersonName('ÑANDÚ ñuñoa')).toBe('Ñandú Ñuñoa')
    expect(normalizePersonName("o'brien")).toBe("O'Brien")
    expect(normalizePersonName('ana-maría')).toBe('Ana-María')
    expect(normalizePersonName('MARÍA DE LOS ÁNGELES')).toBe('María de los Ángeles')
    expect(normalizePersonName('DEL CAMPO')).toBe('Del Campo')
    expect(normalizePersonName('DEL CAMPO', { continuation: true })).toBe('del Campo')
    expect(normalizePersonName('jose\u0301')).toBe('José') // tilde combinada (NFD) => NFC
  })
  it('vacío o solo espacios => ""', () => {
    expect(normalizePersonName('   ')).toBe('')
    expect(normalizePersonName(null)).toBe('')
  })
  it('campos separados: el apellido deja los conectores en minúscula', () => {
    expect(normalizeNameParts(' jaVier ', 'DE LA FUENTE')).toEqual({ firstName: 'Javier', lastName: 'de la Fuente' })
  })
})

describe('firstNameOf (saludo del formulario de registro)', () => {
  it('normaliza y respeta compuestos', () => {
    expect(firstNameOf('  jaVier  pérez')).toBe('Javier')
    expect(firstNameOf('maria jose soto')).toBe('Maria Jose')
    expect(firstNameOf('')).toBe('')
  })
})

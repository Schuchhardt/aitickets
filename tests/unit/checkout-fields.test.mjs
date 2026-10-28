// Datos extra del checkout (src/lib/checkoutFields.mjs): configuración por evento, RUT chileno, lugares por QR (mesa
// para N), asistentes, preguntas al inscribirse y datos de empresa. Mismas reglas en el navegador y en el servidor.
import { describe, expect, it } from 'vitest'
import {
  normalizeCheckoutFields,
  isDefaultCheckoutFields,
  normalizePeoplePerTicket,
  cleanRut,
  isValidRut,
  formatRut,
  holderSlots,
  asksHolders,
  validateHolders,
  validateAnswers,
  validateCompany,
  answerFor,
  MAX_QUESTIONS,
} from '../../src/lib/checkoutFields.mjs'

describe('normalizeCheckoutFields', () => {
  it('vacío o inválido = el checkout de siempre', () => {
    for (const raw of [null, undefined, 'x', [], {}]) {
      expect(normalizeCheckoutFields(raw)).toEqual({ attendee_names: 'off', company: false, questions: [] })
      expect(isDefaultCheckoutFields(raw)).toBe(true)
    }
  })

  it('limpia preguntas: sin texto fuera, opciones repetidas una vez, choice con menos de 2 opciones fuera, ids únicos', () => {
    const f = normalizeCheckoutFields({
      attendee_names: 'required',
      company: true,
      questions: [
        { id: 'talla', label: '  Talla de polera ', type: 'choice', options: ['S', 'M', 'M', ' L '], required: true },
        { label: '' },
        { id: 'talla', label: '¿Alergias?', type: 'text' },
        { label: 'Una sola opción', type: 'choice', options: ['A'] },
        { label: '¿Vienes en auto?', type: 'yes_no', required: 'sí' },
        { id: 'bad id!', label: 'Nivel', type: 'raro' },
      ],
    })
    expect(f.attendee_names).toBe('required')
    expect(f.company).toBe(true)
    expect(f.questions).toEqual([
      { id: 'talla', label: 'Talla de polera', type: 'choice', required: true, options: ['S', 'M', 'L'] },
      { id: 'q2', label: '¿Alergias?', type: 'text', required: false },
      { id: 'q3', label: '¿Vienes en auto?', type: 'yes_no', required: false },
      { id: 'q4', label: 'Nivel', type: 'text', required: false },
    ])
    expect(isDefaultCheckoutFields(f)).toBe(false)
  })

  it(`hasta ${MAX_QUESTIONS} preguntas`, () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({ label: `P${i}` }))
    expect(normalizeCheckoutFields({ questions }).questions).toHaveLength(MAX_QUESTIONS)
  })

  it('personas por entrada: entero de 1 a 30', () => {
    expect(normalizePeoplePerTicket(6)).toBe(6)
    expect(normalizePeoplePerTicket('4')).toBe(4)
    expect(normalizePeoplePerTicket(0)).toBe(1)
    expect(normalizePeoplePerTicket(null)).toBe(1)
    expect(normalizePeoplePerTicket(500)).toBe(30)
  })
})

describe('RUT', () => {
  it('valida el dígito verificador (módulo 11, con K y 0)', () => {
    expect(isValidRut('76.123.456-1')).toBe(false)
    expect(isValidRut('76.123.456-0')).toBe(true)
    expect(isValidRut('77.893.286-5')).toBe(true)
    expect(isValidRut('778932865')).toBe(true)
    expect(isValidRut('12.345.678-5')).toBe(true)
    expect(isValidRut('12.345.678-9')).toBe(false)
    expect(isValidRut('10.000.013-K')).toBe(true)
    expect(isValidRut('10000013k')).toBe(true)
    expect(isValidRut('')).toBe(false)
    expect(isValidRut('abc')).toBe(false)
  })

  it('limpia y formatea', () => {
    expect(cleanRut(' 77.893.286-5 ')).toBe('77893286-5')
    expect(cleanRut('10000013k')).toBe('10000013-K')
    expect(formatRut('778932865')).toBe('77.893.286-5')
    expect(formatRut('')).toBe('')
  })
})

describe('asistentes por QR', () => {
  const lines = [{ id: 1, quantity: 2, name: 'General' }, { id: 2, quantity: 1, name: 'Mesa VIP' }]
  const peopleOf = (id) => (id === 2 ? 3 : 1)

  it('un lugar por QR: cada unidad por las personas de la mesa', () => {
    const slots = holderSlots(lines, peopleOf)
    expect(slots).toHaveLength(5)
    expect(slots.map((s) => [s.ticketId, s.unit, s.seat, s.people])).toEqual([
      [1, 1, 1, 1], [1, 2, 1, 1], [2, 1, 1, 3], [2, 1, 2, 3], [2, 1, 3, 3],
    ])
  })

  it('solo se piden con el ajuste activo y más de un QR', () => {
    expect(asksHolders({ attendee_names: 'optional' }, 2)).toBe(true)
    expect(asksHolders({ attendee_names: 'optional' }, 1)).toBe(false)
    expect(asksHolders({ attendee_names: 'off' }, 5)).toBe(false)
    expect(validateHolders({ attendee_names: 'off' }, holderSlots(lines, peopleOf), [{ name: 'X' }])).toEqual({ holders: null })
  })

  it('opcional: la primera vacía es quien compra; los correos se validan', () => {
    const slots = holderSlots([{ id: 1, quantity: 3 }])
    const ok = validateHolders({ attendee_names: 'optional' }, slots, [{}, { name: 'Ana Pérez', email: 'ANA@mail.cl' }, { name: '' }], { name: 'Bea Soto', email: 'bea@mail.cl' })
    expect(ok.holders).toEqual([
      { ticket_id: 1, name: 'Bea Soto', email: 'bea@mail.cl' },
      { ticket_id: 1, name: 'Ana Pérez', email: 'ana@mail.cl' },
      { ticket_id: 1, name: null, email: null },
    ])
    expect(validateHolders({ attendee_names: 'optional' }, slots, [{}, { email: 'no-correo' }]).error).toMatch(/correo de la entrada 2/)
  })

  it('obligatorio: falta un nombre → error con el número de entrada', () => {
    const slots = holderSlots([{ id: 1, quantity: 2 }])
    expect(validateHolders({ attendee_names: 'required' }, slots, [{}, { name: '' }], { name: 'Bea' }).error).toMatch(/entrada 2/)
    expect(validateHolders({ attendee_names: 'required' }, slots, [{}, { name: 'Ana' }], { name: 'Bea' }).holders).toHaveLength(2)
  })

  it('rechaza asistentes que no calzan con el tipo de entrada', () => {
    const slots = holderSlots([{ id: 1, quantity: 2 }])
    expect(validateHolders({ attendee_names: 'optional' }, slots, [{ ticket_id: 1, name: 'A' }, { ticket_id: 9, name: 'B' }]).error).toMatch(/no coinciden/)
  })
})

describe('preguntas al inscribirse', () => {
  const fields = {
    questions: [
      { id: 'nivel', label: 'Nivel', type: 'choice', options: ['Básico', 'Avanzado'], required: true },
      { id: 'alergias', label: '¿Alergias?', type: 'text' },
      { id: 'auto', label: '¿Vienes en auto?', type: 'yes_no', required: true },
    ],
  }

  it('guarda pregunta y respuesta (sí/no como texto)', () => {
    const r = validateAnswers(fields, { nivel: 'Avanzado', alergias: '  maní ', auto: true })
    expect(r.answers).toEqual([
      { id: 'nivel', question: 'Nivel', answer: 'Avanzado' },
      { id: 'alergias', question: '¿Alergias?', answer: 'maní' },
      { id: 'auto', question: '¿Vienes en auto?', answer: 'Sí' },
    ])
    expect(answerFor(r.answers, { id: 'auto', label: '¿Vienes en auto?' })).toBe('Sí')
    expect(answerFor(r.answers, { id: 'otro', label: 'Nivel' })).toBe('Avanzado')
  })

  it('obligatorias sin responder u opción que no existe → error', () => {
    expect(validateAnswers(fields, { auto: 'No' }).error).toMatch(/Nivel/)
    expect(validateAnswers(fields, { nivel: 'Experto', auto: 'No' }).error).toMatch(/Elige una opción/)
    expect(validateAnswers(fields, { nivel: 'Básico' }).error).toMatch(/auto/)
  })

  it('sin preguntas no se guarda nada', () => {
    expect(validateAnswers({}, { x: 'y' })).toEqual({ answers: null })
  })
})

describe('datos de empresa', () => {
  it('solo con el ajuste activo y en compras pagadas', () => {
    expect(validateCompany({ company: false }, { rut: '77.893.286-5', name: 'Acme SpA' })).toEqual({ company: null })
    expect(validateCompany({ company: true }, { rut: '77.893.286-5', name: 'Acme SpA' }, { paid: false })).toEqual({ company: null })
  })

  it('vacío = sin datos; con datos exige RUT válido y razón social', () => {
    expect(validateCompany({ company: true }, {})).toEqual({ company: null })
    expect(validateCompany({ company: true }, { rut: '77.893.286-5', name: 'Acme SpA' })).toEqual({ company: { rut: '77893286-5', name: 'Acme SpA' } })
    expect(validateCompany({ company: true }, { rut: '77.893.286-4', name: 'Acme SpA' }).error).toMatch(/dígito verificador/)
    expect(validateCompany({ company: true }, { name: 'Acme SpA' }).error).toMatch(/RUT/)
    expect(validateCompany({ company: true }, { rut: '77.893.286-5' }).error).toMatch(/razón social/)
  })
})

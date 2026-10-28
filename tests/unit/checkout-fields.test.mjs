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
  answersText,
  orderQuestions,
  attendeeQuestions,
  invitesHolders,
  collectsHolders,
  requiresAttendeeData,
  missingAttendeeData,
  validateHolderUpdate,
  MAX_QUESTIONS,
} from '../../src/lib/checkoutFields.mjs'

describe('normalizeCheckoutFields', () => {
  it('vacío o inválido = el checkout de siempre', () => {
    for (const raw of [null, undefined, 'x', [], {}]) {
      expect(normalizeCheckoutFields(raw)).toEqual({ attendee_names: 'off', holders: 'buyer', company: false, questions: [] })
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
      { id: 'talla', label: 'Talla de polera', type: 'choice', required: true, per: 'order', options: ['S', 'M', 'L'] },
      { id: 'q2', label: '¿Alergias?', type: 'text', required: false, per: 'order' },
      { id: 'q3', label: '¿Vienes en auto?', type: 'yes_no', required: false, per: 'order' },
      { id: 'q4', label: 'Nivel', type: 'text', required: false, per: 'order' },
    ])
    expect(isDefaultCheckoutFields(f)).toBe(false)
  })

  it('configuraciones guardadas antes: quien compra llena todo y las preguntas son por compra', () => {
    const old = normalizeCheckoutFields({ attendee_names: 'optional', questions: [{ id: 'a', label: 'Talla' }] })
    expect(old.holders).toBe('buyer')
    expect(old.questions[0].per).toBe('order')
    const f = normalizeCheckoutFields({ holders: 'invite', questions: [{ id: 'a', label: 'Talla', per: 'attendee' }, { label: 'Otra', per: 'raro' }] })
    expect(f.holders).toBe('invite')
    expect(f.questions.map((q) => q.per)).toEqual(['attendee', 'order'])
    expect(normalizeCheckoutFields({ holders: 'nadie' }).holders).toBe('buyer')
    expect(orderQuestions(f).map((q) => q.label)).toEqual(['Otra'])
    expect(attendeeQuestions(f).map((q) => q.label)).toEqual(['Talla'])
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

describe('preguntas por persona', () => {
  const fields = {
    attendee_names: 'optional',
    questions: [
      { id: 'talla', label: 'Talla', type: 'choice', options: ['S', 'M'], required: true, per: 'attendee' },
      { id: 'dieta', label: 'Dieta', type: 'text', per: 'attendee' },
      { id: 'factura', label: '¿Cómo supiste?', type: 'text', required: true },
    ],
  }
  const slots = holderSlots([{ id: 1, quantity: 2 }])

  it('las preguntas por persona activan los asistentes aunque no se pidan nombres', () => {
    const f = { questions: [{ label: 'Talla', per: 'attendee' }] }
    expect(asksHolders(f, 2)).toBe(true)
    expect(asksHolders(f, 1)).toBe(false)
    // Con un solo QR las responde quien compra para su entrada
    expect(collectsHolders(f, 1)).toBe(true)
    expect(collectsHolders({ questions: [{ label: 'Talla' }] }, 1)).toBe(false)
  })

  it('quien compra responde por cada persona; la pregunta por compra va aparte', () => {
    const r = validateHolders(fields, slots, [{ answers: { talla: 'M' } }, { name: 'Ana', answers: { talla: 'S', dieta: ' vegana ' } }], { name: 'Bea', email: 'bea@x.cl' })
    expect(r.holders).toEqual([
      { ticket_id: 1, name: 'Bea', email: 'bea@x.cl', answers: [{ id: 'talla', question: 'Talla', answer: 'M' }] },
      { ticket_id: 1, name: 'Ana', email: null, answers: [{ id: 'talla', question: 'Talla', answer: 'S' }, { id: 'dieta', question: 'Dieta', answer: 'vegana' }] },
    ])
    expect(validateHolders(fields, slots, [{ answers: { talla: 'M' } }, { name: 'Ana' }], { name: 'Bea' }).error).toBe('Responde "Talla" (entrada 2).')
    expect(validateHolders(fields, slots, [{ answers: { talla: 'XL' } }, {}], { name: 'Bea' }).error).toMatch(/Elige una opción de "Talla" \(entrada 1\)/)
    // validateAnswers solo mira las preguntas por compra
    expect(validateAnswers(fields, { factura: 'Instagram' }).answers).toEqual([{ id: 'factura', question: '¿Cómo supiste?', answer: 'Instagram' }])
    expect(validateAnswers(fields, {}).error).toMatch(/Cómo supiste/)
  })

  it('un solo QR: las respuestas por persona quedan en la entrada de quien compra', () => {
    const one = holderSlots([{ id: 1, quantity: 1 }])
    const r = validateHolders(fields, one, [{ answers: { talla: 'S' } }], { name: 'Bea', email: 'bea@x.cl' })
    expect(r.holders).toEqual([{ ticket_id: 1, name: 'Bea', email: 'bea@x.cl', answers: [{ id: 'talla', question: 'Talla', answer: 'S' }] }])
    expect(validateHolders(fields, one, [{}], { name: 'Bea' }).error).toBe('Responde "Talla".')
  })

  it('invitar: el invitado solo trae correo (sus respuestas se ignoran); si el evento exige datos, el correo es obligatorio', () => {
    const invite = { ...fields, holders: 'invite' }
    expect(invitesHolders(invite, 2)).toBe(true)
    expect(invitesHolders(invite, 1)).toBe(false)
    expect(requiresAttendeeData(invite)).toBe(true)
    const r = validateHolders(invite, slots, [{ answers: { talla: 'M' } }, { email: 'ana@x.cl', answers: { talla: 'S' } }], { name: 'Bea', email: 'bea@x.cl' })
    expect(r.holders[1]).toEqual({ ticket_id: 1, name: null, email: 'ana@x.cl' })
    expect(r.holders[0].answers).toHaveLength(1)
    expect(validateHolders(invite, slots, [{ answers: { talla: 'M' } }, { name: 'Ana' }], { name: 'Bea' }).error).toMatch(/correo de la entrada 2/)
    // El lugar de quien compra siempre se llena en el checkout
    expect(validateHolders(invite, slots, [{}, { email: 'ana@x.cl' }], { name: 'Bea' }).error).toBe('Responde "Talla" (entrada 1).')
    // Nombres obligatorios: el invitado puede venir sin nombre (lo completa él)
    const named = { attendee_names: 'required', holders: 'invite' }
    expect(validateHolders(named, slots, [{}, { email: 'ana@x.cl' }], { name: 'Bea Soto' }).holders[1]).toEqual({ ticket_id: 1, name: null, email: 'ana@x.cl' })
    // Sin nada obligatorio, el correo del invitado es opcional
    expect(validateHolders({ attendee_names: 'optional', holders: 'invite' }, slots, [{}, {}], { name: 'Bea' }).error).toBeUndefined()
  })

  it('datos pendientes: nombre de otra persona sin escribir y preguntas obligatorias sin responder', () => {
    const f = { attendee_names: 'required', holders: 'invite', questions: fields.questions }
    const ctx = { buyerEmail: 'bea@x.cl' }
    expect(missingAttendeeData(f, { holder_email: 'ana@x.cl' }, ctx)).toEqual(['Nombre', 'Talla'])
    expect(missingAttendeeData(f, { holder_email: 'ana@x.cl', holder_name: 'Ana', registration_answers: [{ id: 'talla', question: 'Talla', answer: 'S' }] }, ctx)).toEqual([])
    // La entrada de quien compra no pide nombre; vale la respuesta de la orden si la pregunta antes era por compra
    expect(missingAttendeeData(f, { holder_email: 'BEA@x.cl' }, { ...ctx, orderAnswers: [{ id: 'talla', question: 'Talla', answer: 'M' }] })).toEqual([])
    expect(missingAttendeeData({ attendee_names: 'optional' }, { holder_email: 'ana@x.cl' }, ctx)).toEqual([])
    expect(answersText([{ question: 'Talla', answer: 'S' }, { question: 'Dieta', answer: '' }])).toBe('Talla: S')
  })

  it('lo que completa la persona: mismas reglas que el checkout', () => {
    const f = { attendee_names: 'required', questions: fields.questions }
    expect(validateHolderUpdate(f, { name: ' Ana  Rojas ', answers: { talla: 'S' } })).toEqual({ name: 'Ana Rojas', answers: [{ id: 'talla', question: 'Talla', answer: 'S' }] })
    expect(validateHolderUpdate(f, { answers: { talla: 'S' } })).toMatchObject({ error: 'Escribe tu nombre y apellido.', field: 'name' })
    expect(validateHolderUpdate(f, { answers: { talla: 'S' } }, { currentName: 'Ana' }).name).toBe('Ana')
    expect(validateHolderUpdate(f, { name: 'Ana', answers: {} })).toMatchObject({ error: 'Responde "Talla".', field: 'answers' })
    expect(validateHolderUpdate(f, { name: 'Ana', answers: { talla: 'XL' } }).error).toMatch(/Elige una opción/)
    // La pregunta por compra no se responde aquí
    expect(validateHolderUpdate(f, { name: 'Ana', answers: { talla: 'S', factura: 'x' } }).answers).toHaveLength(1)
  })
})

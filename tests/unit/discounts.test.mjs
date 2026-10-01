// Códigos de descuento: matemática, reglas de validación y resolución contra la BD (fake).
import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { computeBuyerTotal } from '../../netlify/lib/fees.mjs'
import {
  normalizeDiscountCode,
  computeDiscountAmount,
  computeDiscountedTotals,
  describeDiscount,
  discountLineLabel,
  checkDiscountCode,
  checkDiscountUsage,
  discountReasonFromRpcError,
  validateDiscountInput,
  resolveDiscount,
  orderDiscount,
  DISCOUNT_MESSAGES,
} from '../../netlify/lib/discounts.mjs'
import { computeTotalsWithDiscount } from '../../src/components/Reservation/pricing.js'

describe('normalizeDiscountCode', () => {
  it('mayúsculas, sin espacios y formato [A-Z0-9_-]{3,30}', () => {
    expect(normalizeDiscountCode(' preventa 10 ')).toBe('PREVENTA10')
    expect(normalizeDiscountCode('vip_2026-a')).toBe('VIP_2026-A')
    expect(normalizeDiscountCode('ab')).toBeNull()
    expect(normalizeDiscountCode('a'.repeat(31))).toBeNull()
    expect(normalizeDiscountCode('DESCUENTO!')).toBeNull()
    expect(normalizeDiscountCode('ÑANDÚ')).toBeNull()
    expect(normalizeDiscountCode(null)).toBeNull()
    expect(normalizeDiscountCode(123)).toBeNull()
  })
})

describe('computeDiscountAmount', () => {
  it('porcentaje redondeado a pesos', () => {
    expect(computeDiscountAmount({ kind: 'percent', value: 10 }, 15000)).toBe(1500)
    expect(computeDiscountAmount({ kind: 'percent', value: 15 }, 9990)).toBe(1499) // 1498,5 -> 1499
    expect(computeDiscountAmount({ kind: 'percent', value: '12.5' }, 10000)).toBe(1250)
  })
  it('100% deja el subtotal en 0', () => {
    expect(computeDiscountAmount({ kind: 'percent', value: 100 }, 25000)).toBe(25000)
  })
  it('monto fijo con tope en el subtotal', () => {
    expect(computeDiscountAmount({ kind: 'fixed', value: 5000 }, 15000)).toBe(5000)
    expect(computeDiscountAmount({ kind: 'fixed', value: 50000 }, 15000)).toBe(15000)
  })
  it('sin subtotal, valor inválido o tipo desconocido: 0', () => {
    expect(computeDiscountAmount({ kind: 'percent', value: 10 }, 0)).toBe(0)
    expect(computeDiscountAmount({ kind: 'fixed', value: -10 }, 1000)).toBe(0)
    expect(computeDiscountAmount({ kind: 'otro', value: 10 }, 1000)).toBe(0)
    expect(computeDiscountAmount(null, 1000)).toBe(0)
  })
})

describe('computeDiscountedTotals', () => {
  it('el cargo por servicio se calcula sobre el subtotal descontado', () => {
    const t = computeDiscountedTotals(20000, { kind: 'percent', value: 25 })
    const expected = computeBuyerTotal(15000)
    expect(t).toEqual({ grossSubtotal: 20000, discountAmount: 5000, subtotal: 15000, feeNet: expected.feeNet, feeIva: expected.feeIva, fee: expected.fee, total: expected.total })
    expect(t.total).toBe(t.subtotal + t.feeNet + t.feeIva)
  })
  it('sin código equivale a computeBuyerTotal', () => {
    const t = computeDiscountedTotals(12345, null)
    expect(t.discountAmount).toBe(0)
    expect(t).toMatchObject(computeBuyerTotal(12345))
  })
  it('descuento total => orden gratis (sin cargo)', () => {
    expect(computeDiscountedTotals(8000, { kind: 'fixed', value: 10000 })).toEqual({
      grossSubtotal: 8000, discountAmount: 8000, subtotal: 0, feeNet: 0, feeIva: 0, fee: 0, total: 0,
    })
  })
  it('la vista del checkout usa la misma regla (pricing.js)', () => {
    const lines = [{ total: 10000, quantity: 2 }, { total: 5000, quantity: 1 }]
    expect(computeTotalsWithDiscount(lines, { kind: 'fixed', value: 3000 })).toEqual({
      ...computeDiscountedTotals(15000, { kind: 'fixed', value: 3000 }),
      quantity: 3,
    })
  })
})

describe('etiquetas', () => {
  it('describe y línea de descuento', () => {
    expect(describeDiscount({ kind: 'percent', value: 10 })).toBe('10%')
    expect(describeDiscount({ kind: 'fixed', value: 5000 })).toBe('$5.000')
    expect(discountLineLabel('PROMO')).toBe('Descuento (PROMO)')
  })
  it('orderDiscount lee la orden guardada', () => {
    expect(orderDiscount({ discount_amount: 1500, discount_code: 'PROMO' })).toEqual({ code: 'PROMO', amount: 1500 })
    expect(orderDiscount({ amount: 1000 })).toEqual({ code: '', amount: 0 })
  })
})

describe('checkDiscountCode / checkDiscountUsage', () => {
  const now = new Date('2026-10-10T12:00:00Z')
  const base = { id: 'c1', organization_id: 7, event_id: null, active: true, starts_at: null, ends_at: null, max_uses: null, per_buyer_limit: null }
  const ctx = { eventId: 3, organizationId: 7, now }

  it('vale para cualquier evento de la organización si event_id es null', () => {
    expect(checkDiscountCode(base, ctx)).toEqual({ ok: true })
  })
  it('otra organización u otro evento: not_found (no revela que existe)', () => {
    expect(checkDiscountCode({ ...base, organization_id: 8 }, ctx).reason).toBe('not_found')
    expect(checkDiscountCode({ ...base, event_id: 4 }, ctx).reason).toBe('not_found')
    expect(checkDiscountCode({ ...base, event_id: 3 }, ctx).ok).toBe(true)
    expect(checkDiscountCode(null, ctx).reason).toBe('not_found')
  })
  it('inactivo y vigencia', () => {
    expect(checkDiscountCode({ ...base, active: false }, ctx).reason).toBe('inactive')
    expect(checkDiscountCode({ ...base, starts_at: '2026-10-11T00:00:00Z' }, ctx).reason).toBe('not_started')
    expect(checkDiscountCode({ ...base, ends_at: '2026-10-10T12:00:00Z' }, ctx).reason).toBe('expired')
    expect(checkDiscountCode({ ...base, starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-31T00:00:00Z' }, ctx).ok).toBe(true)
  })
  it('max_uses y per_buyer_limit', () => {
    expect(checkDiscountUsage({ ...base, max_uses: 2 }, { uses: 1 }).ok).toBe(true)
    expect(checkDiscountUsage({ ...base, max_uses: 2 }, { uses: 2 }).reason).toBe('exhausted')
    expect(checkDiscountUsage({ ...base, per_buyer_limit: 1 }, { uses: 5, buyerUses: 1 }).reason).toBe('buyer_limit')
    // Sin email (vista previa) no se revisa el límite por comprador
    expect(checkDiscountUsage({ ...base, per_buyer_limit: 1 }, { uses: 5, buyerUses: null }).ok).toBe(true)
  })
  it('errores del RPC de reserva', () => {
    expect(discountReasonFromRpcError({ message: 'DISCOUNT_EXHAUSTED' })).toBe('exhausted')
    expect(discountReasonFromRpcError({ message: 'DISCOUNT_BUYER_LIMIT' })).toBe('buyer_limit')
    expect(discountReasonFromRpcError({ message: 'DISCOUNT_INVALID' })).toBe('not_found')
    expect(discountReasonFromRpcError({ message: 'SOLD_OUT:3' })).toBeNull()
  })
})

describe('validateDiscountInput', () => {
  it('crea un código porcentual válido', () => {
    expect(validateDiscountInput({ code: 'promo10', kind: 'percent', value: 10, maxUses: '50', perBuyerLimit: '', eventId: 5 })).toEqual({
      values: { code: 'PROMO10', kind: 'percent', value: 10, max_uses: 50, per_buyer_limit: null, event_id: 5 },
    })
  })
  it('rechaza valores fuera de rango', () => {
    expect(validateDiscountInput({ code: 'X', kind: 'percent', value: 10 }).error).toBe(DISCOUNT_MESSAGES.invalid_format)
    expect(validateDiscountInput({ code: 'PROMO', kind: 'percent', value: 0 }).error).toMatch(/entre 1 y 100/)
    expect(validateDiscountInput({ code: 'PROMO', kind: 'percent', value: 101 }).error).toMatch(/entre 1 y 100/)
    expect(validateDiscountInput({ code: 'PROMO', kind: 'fixed', value: 99.5 }).error).toMatch(/entero/)
    expect(validateDiscountInput({ code: 'PROMO', kind: 'gratis', value: 1 }).error).toMatch(/tipo/)
    expect(validateDiscountInput({ code: 'PROMO', kind: 'fixed', value: 1000, maxUses: 0 }).error).toMatch(/usos/)
    expect(validateDiscountInput({ code: 'PROMO', kind: 'fixed', value: 1000, startsAt: '2026-10-10', endsAt: '2026-10-09' }).error).toMatch(/posterior/)
  })
  it('PATCH parcial solo valida lo que viene', () => {
    expect(validateDiscountInput({ active: false }, { partial: true })).toEqual({ values: { active: false } })
    expect(validateDiscountInput({ maxUses: null }, { partial: true })).toEqual({ values: { max_uses: null } })
  })
})

describe('resolveDiscount (BD)', () => {
  const event = { id: 3, organization_id: 7 }
  const code = { id: 'c1', organization_id: 7, event_id: null, code: 'PROMO10', kind: 'percent', value: 10, max_uses: 3, per_buyer_limit: 1, starts_at: null, ends_at: null, active: true }

  it('aplica el código y calcula el descuento', async () => {
    const db = createFakeSupabase({
      tables: { aitickets_discount_codes: [code] },
      rpc: { aitickets_discount_code_usage: () => [{ uses: 0, buyer_uses: 0 }] },
    })
    const r = await resolveDiscount(db, { event, code: 'promo10', grossSubtotal: 20000, buyerEmail: 'a@b.cl' })
    expect(r).toEqual({ ok: true, discount: { id: 'c1', code: 'PROMO10', kind: 'percent', value: 10, amount: 2000, label: '10%' } })
  })

  it('código de otra organización: no existe', async () => {
    const db = createFakeSupabase({ tables: { aitickets_discount_codes: [{ ...code, organization_id: 9 }] } })
    const r = await resolveDiscount(db, { event, code: 'PROMO10', grossSubtotal: 20000 })
    expect(r).toMatchObject({ ok: false, reason: 'not_found', status: 404 })
  })

  it('agotado y límite por comprador', async () => {
    const exhausted = createFakeSupabase({
      tables: { aitickets_discount_codes: [code] },
      rpc: { aitickets_discount_code_usage: () => [{ uses: 3, buyer_uses: 0 }] },
    })
    expect(await resolveDiscount(exhausted, { event, code: 'PROMO10', grossSubtotal: 20000 })).toMatchObject({ ok: false, reason: 'exhausted', status: 409 })
    const buyer = createFakeSupabase({
      tables: { aitickets_discount_codes: [code] },
      rpc: { aitickets_discount_code_usage: () => [{ uses: 1, buyer_uses: 1 }] },
    })
    expect(await resolveDiscount(buyer, { event, code: 'PROMO10', grossSubtotal: 20000, buyerEmail: 'a@b.cl' })).toMatchObject({ ok: false, reason: 'buyer_limit' })
  })

  it('entradas gratis: el código no aplica', async () => {
    const db = createFakeSupabase({ tables: { aitickets_discount_codes: [code] } })
    expect(await resolveDiscount(db, { event, code: 'PROMO10', grossSubtotal: 0 })).toMatchObject({ ok: false, reason: 'no_subtotal' })
  })

  it('base sin la migración: no disponible', async () => {
    const db = createFakeSupabase()
    db.failOn('aitickets_discount_codes', 'select', { code: '42P01', message: 'no existe' })
    expect(await resolveDiscount(db, { event, code: 'PROMO10', grossSubtotal: 1000 })).toMatchObject({ ok: false, reason: 'unavailable', status: 503 })
  })
})

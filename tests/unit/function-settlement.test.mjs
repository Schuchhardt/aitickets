// Borderó por función (ítem 14): entradas por tipo y precio, cortesías, bruto, descuentos, cargo por servicio según
// quién lo paga (absorbido o no) y neto al productor de una función, con las órdenes de varias funciones repartidas
// (orderForFunction). También la planilla y get_function_settlement. Sin red ni BD.
import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '../fixtures/fake-supabase.mjs'
import { computeFeeSplit, computeBuyerTotal } from '../../netlify/lib/fees.mjs'

let db
vi.mock('../../src/lib/auth-helpers', () => ({ getSupabaseAdmin: () => db, getFriendlyErrorMessage: (e) => String(e?.message || e) }))

const { functionSettlement, settlementCsv, SettlementError } = await import('../../src/lib/functionSettlement.ts')
const { runTool } = await import('../../src/lib/producer-api/registry.ts')
const { financeTools } = await import('../../src/lib/producer-api/tools/finance.ts')

const line = (id, name, price, quantity, event_date_id, extra = {}) => ({ id, name, price, quantity, total: price * quantity, event_date_id, ...extra })
const normal = computeBuyerTotal(20000)
const half = computeBuyerTotal(18000)
const absorbed = computeFeeSplit(10000, { absorbed: true })

function seed() {
  db = createFakeSupabase({
    tables: {
      events: [{ id: 10, name: 'La obra', organization_id: 7 }],
      event_dates: [
        { id: 501, event_id: 10, date: '2026-11-13', start_time: '20:00:00', event_locations: { name: 'Main', venues: { name: 'Sala Agustín Siré', address_line1: 'Morandé 750', city: 'Santiago' } } },
        { id: 502, event_id: 10, date: '2026-11-14', start_time: '20:00:00', event_locations: null },
      ],
      event_tickets: [
        { id: 100, event_id: 10, event_date_id: 501 },
        { id: 101, event_id: 10, event_date_id: 501 },
        { id: 102, event_id: 10, event_date_id: 502 },
        { id: 103, event_id: 10, event_date_id: null },
      ],
      event_orders: [
        // 2 generales del viernes, el comprador paga el cargo
        { id: 'o1', event_id: 10, status: 'paid', amount: 20000, ticket_qty: 2, ticket_fee: normal.feeNet, service_fee_tax: normal.feeIva, discount_amount: 0, fee_absorbed: false, payment_provider: 'flow', ticket_details: [line(100, 'General', 10000, 2, 501)] },
        // Viernes y sábado en una compra, con código: se reparte mitad y mitad
        { id: 'o2', event_id: 10, status: 'paid', amount: 18000, ticket_qty: 2, ticket_fee: half.feeNet, service_fee_tax: half.feeIva, discount_amount: 2000, discount_code: 'AMIGOS', fee_absorbed: false, payment_provider: 'flow', ticket_details: [line(100, 'General', 10000, 1, 501), line(102, 'General', 10000, 1, 502)] },
        // Estudiante del viernes con el cargo absorbido por el productor
        { id: 'o3', event_id: 10, status: 'paid', amount: absorbed.producerNet, ticket_qty: 1, ticket_fee: absorbed.feeNet, service_fee_tax: absorbed.feeIva, discount_amount: 0, fee_absorbed: true, payment_provider: 'flow', ticket_details: [line(101, 'Estudiante', 10000, 1, 501)] },
        // Cortesías del viernes, una transferencia y una reembolsada (no cuentan como venta)
        { id: 'o4', event_id: 10, status: 'paid', amount: 0, ticket_qty: 2, payment_provider: 'courtesy', ticket_details: [line(100, 'Prensa', 0, 2, 501, { complimentary: true })] },
        { id: 'o5', event_id: 10, status: 'paid', amount: 0, ticket_qty: 1, payment_provider: 'free', ticket_details: [line(100, 'General', 10000, 1, 501, { transferred_from_order: 'o1' })] },
        { id: 'o6', event_id: 10, status: 'refunded', amount: 50000, ticket_qty: 5, payment_provider: 'flow', ticket_details: [line(100, 'General', 10000, 5, 501)] },
        // Pase para todas las funciones
        { id: 'o7', event_id: 10, status: 'paid', amount: 15000, ticket_qty: 1, ticket_fee: 1200, service_fee_tax: 228, discount_amount: 0, fee_absorbed: false, payment_provider: 'flow', ticket_details: [line(103, 'Pase temporada', 15000, 1, null)] },
      ],
    },
  })
}

describe('borderó de una función', () => {
  it('cuadra: bruto − descuentos − cargo absorbido = neto al productor', async () => {
    seed()
    const s = await functionSettlement(db, { id: 10, name: 'La obra' }, 501, new Date('2026-11-15T12:00:00Z'))
    expect(s.function).toMatchObject({ id: 501, date: '2026-11-13', start_time: '20:00', venue: 'Sala Agustín Siré, Morandé 750, Santiago' })
    expect(s.tickets).toEqual([
      { ticket_type: 'Estudiante', unit_price_clp: 10000, tickets: 1, gross_clp: 10000 },
      { ticket_type: 'General', unit_price_clp: 10000, tickets: 3, gross_clp: 30000 },
    ])
    expect(s.courtesies).toEqual([{ ticket_type: 'Prensa', tickets: 2 }])
    expect(s.totals).toMatchObject({ orders: 3, tickets_sold: 4, courtesy_tickets: 2, gross_clp: 40000, discounts_clp: 1000 })
    expect(s.totals.service_fee_absorbed_clp).toBe(absorbed.fee)
    expect(s.totals.net_to_producer_clp).toBe(20000 + 9000 + absorbed.producerNet)
    expect(s.totals.net_to_producer_clp).toBe(40000 - 1000 - absorbed.fee)
    expect(s.rounding_clp).toBe(0)
    // Lo que pagó el público: entradas con descuento + cargo cuando lo paga el comprador (el absorbido va dentro del precio)
    expect(s.totals.buyer_paid_clp).toBe(normal.total + Math.round(half.total / 2) + 10000)
    expect(s.discount_codes).toEqual([{ code: 'AMIGOS', orders: 1, discount_clp: 1000 }])
  })

  it('la otra función y los pases para todas van por separado', async () => {
    seed()
    const sat = await functionSettlement(db, { id: 10, name: 'La obra' }, 502)
    expect(sat.totals).toMatchObject({ orders: 1, tickets_sold: 1, gross_clp: 10000, discounts_clp: 1000, net_to_producer_clp: 9000, courtesy_tickets: 0 })
    const all = await functionSettlement(db, { id: 10, name: 'La obra' }, null)
    expect(all.function).toBeNull()
    expect(all.totals).toMatchObject({ orders: 1, tickets_sold: 1, gross_clp: 15000, net_to_producer_clp: 15000, service_fee_paid_by_buyers_clp: 1428 })
    await expect(functionSettlement(db, { id: 10, name: 'La obra' }, 999)).rejects.toBeInstanceOf(SettlementError)
  })

  it('la planilla trae las filas y el neto', async () => {
    seed()
    const csv = settlementCsv(await functionSettlement(db, { id: 10, name: 'La obra' }, 501))
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Estudiante;10000;1;10000')
    expect(csv).toContain(`Neto al productor;${20000 + 9000 + absorbed.producerNet}`)
    expect(csv).toContain('Prensa;;2')
  })

  it('get_function_settlement con los links al imprimible y la planilla', async () => {
    seed()
    db.tables.aitickets_api_audit = []
    const ctx = {
      supabase: db,
      actor: { keyId: 'k', userId: 1, orgId: 7, role: 'admin', name: 'Ana', email: 'a@p.cl', scopes: ['read', 'finance'], eventIds: null },
      origin: 'https://aitickets.test',
      requestUrl: new URL('https://aitickets.test/api/mcp'),
      channel: 'mcp',
    }
    const tool = financeTools.find((t) => t.name === 'get_function_settlement')
    const res = await runTool(tool, { event_id: 10, function_id: 502 }, ctx)
    expect(res.ok).toBe(true)
    expect(res.result).toMatchObject({ currency: 'CLP', printable_url: 'https://aitickets.test/dashboard/events/10/bordero?funcion=502' })
    expect(res.result.totals.net_to_producer_clp).toBe(9000)
    expect(await runTool(tool, { event_id: 10, function_id: 999 }, ctx)).toMatchObject({ ok: false, code: 'not_found' })
  })
})

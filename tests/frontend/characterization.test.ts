import { describe, expect, it, vi } from 'vitest'
import { mapSnapshot, toBase, toDisplay, toEgp, toMinor } from '../../src/lib/api'
import type { Snapshot } from '../../src/shared/api/snapshot-types'
import { money, quantity } from '../../src/lib/domain'
import { customerStatementEntries, printSupplierStatement } from '../../src/lib/helpers'

function snapshotFixture(): Snapshot {
  return {
    generatedAt: '2026-10-03T00:00:00.000Z',
    today: '2026-10-03',
    settings: { companyName: 'شركة الاختبار', companyPhone: '01000000000', currency: 'EGP', costingMethod: 'FIFO', defaultCreditDays: 30 },
    users: [{ id: 'user-1', username: 'owner', display_name: 'المالك', role: 'owner', is_active: 1 }],
    items: [
      { id: 'raw-1', sku: 'RAW', name: 'خام', type: 'raw', unit: { label: 'كجم', factor: 1000, baseUnitId: 'gram' }, stockBase: 2500, minStockBase: 500, unitCostBaseMinor: 150, salePriceBaseMinor: 250, isActive: true, recipe: [] },
      { id: 'finished-1', sku: 'FIN', name: 'منتج', type: 'finished', unit: { label: 'عبوة', factor: 1, baseUnitId: 'piece' }, stockBase: 4, minStockBase: 1, unitCostBaseMinor: 1200, salePriceBaseMinor: 2000, isActive: true, recipe: [{ itemId: 'raw-1', qtyPerUnitBase: 500, kind: 'raw' }] }
    ],
    customers: [{ id: 'customer-1', name: 'عميل', phone: '010', whatsapp: '010', creditLimitMinor: 50000, balanceMinor: 2500, creditDays: 14, isBlocked: false, blockReason: null, notes: null, isActive: true }],
    customerOpenings: [], customerAdjustments: [],
    suppliers: [{ id: 'supplier-1', name: 'مورد', phone: '011', whatsapp: null, address: null, notes: null, creditDays: 30, balanceMinor: 20000, isActive: true }],
    supplierOpenings: [],
    sales: [{ id: 'sale-1', number: 'INV-1', customerId: 'customer-1', date: '2026-10-02', dueDate: null, status: 'confirmed', totalMinor: 10000, paidMinor: 0, notes: null, creditOverrideBy: null, creditOverrideReason: null, lines: [{ id: 'sale-line-1', itemId: 'raw-1', qtyBase: 2000, lineTotalMinor: 10000, cogsTotalMinor: 4000 }] }],
    purchases: [{ id: 'purchase-1', number: 'PUR-1', supplierId: 'supplier-1', date: '2026-10-02', dueDate: null, status: 'confirmed', totalMinor: 20000, paidMinor: 0, extraCostsMinor: 0, supplierInvoiceNumber: null, itemId: 'raw-1', qtyBase: 5000, landedCostTotalMinor: 20000, lotId: 'lot-1' }],
    purchaseDrafts: [],
    packings: [{ id: 'packing-1', number: 'PCK-1', date: '2026-10-02', itemId: 'finished-1', producedUnits: 3, wasteQtyBase: 750, unitCostMinor: 1200, status: 'confirmed', notes: null }],
    lots: [{ id: 'lot-1', itemId: 'raw-1', code: 'LOT-1', qtyBase: 2500, qtyInitialBase: 5000, costTotalMinor: 10000, receivedAt: '2026-10-02', expiryDate: null, source: 'purchase', isActive: true }],
    reminders: [], reminderRules: [], messageTemplates: [], promises: [], payments: [], refunds: [], returns: [], stockMovements: [], messageLog: [], auditLog: [],
    nextNumbers: { INV: 'INV-2', PUR: 'PUR-2', 'D-PUR': 'D-PUR-1', PCK: 'PCK-2', RET: 'RET-1', PRT: 'PRT-1' }
  }
}

describe('renderer conversion boundary', () => {
  it('converts money and quantities without leaking display values into the backend', () => {
    expect(toMinor(12.345)).toBe(1235)
    expect(toMinor(-12.345)).toBe(-1234)
    expect(() => toMinor(Number.NaN)).toThrow('مبلغ غير صالح')
    expect(toEgp(1235)).toBe(12.35)
    expect(toBase(2.555, 1000)).toBe(2555)
    expect(toDisplay(2555, 1000)).toBe(2.555)
    expect(money(12.5)).toMatch(/١٢٫٥٠/)
    expect(quantity(1.25, 'كجم')).toBe('١٫٢٥ كجم')
  })

  it('maps units, prices, costs, lots, and packings from a minimal snapshot', () => {
    const state = mapSnapshot(snapshotFixture())

    expect(state.items[0]).toMatchObject({ id: 'raw-1', stock: 2.5, minStock: 0.5, unitCost: 1500, salePrice: 2500 })
    expect(state.items[1]?.recipe).toEqual([{ itemId: 'raw-1', qty: 0.5, kind: 'raw' }])
    expect(state.customers[0]).toMatchObject({ creditLimit: 500, balance: 25 })
    expect(state.sales[0]?.lines[0]).toMatchObject({ qty: 2, price: 50, cost: 20 })
    expect(state.purchases[0]).toMatchObject({ quantity: 5, unitCost: 40 })
    expect(state.packings[0]).toMatchObject({ units: 3, waste: 0.75, unitCost: 12 })
    expect(state.lots[0]).toMatchObject({ quantity: 2.5, initialQuantity: 5, unitCost: 20 })
  })
})

describe('feature snapshot mappers', () => {
  it('maps parties, drafts, payments, returns, reminders, ledger, and audit data', () => {
    const snapshot = snapshotFixture()
    snapshot.customerOpenings = [{ id: 'co-1', customer_id: 'customer-1', balance_delta_minor: 1250, effective_date: '2026-10-01', due_date: '2026-10-15', notes: 'افتتاحي' }]
    snapshot.customerAdjustments = [{ id: 'ca-1', customer_id: 'customer-1', balance_delta_minor: -500, effective_date: '2026-10-01', reason: 'تسوية', created_at: '2026-10-01' }]
    snapshot.supplierOpenings = [{ id: 'so-1', supplier_id: 'supplier-1', balance_delta_minor: 2500, effective_date: '2026-10-01', due_date: '2026-10-15', notes: 'افتتاحي' }]
    snapshot.purchaseDrafts = [{ id: 'draft-1', number: 'D-PUR-1', supplierId: 'supplier-1', itemId: 'raw-1', date: '2026-10-02', qtyBase: 2000, unitPriceBaseMinor: 10, extraCostsMinor: 500, paidMinor: 0, supplierInvoiceNumber: null, dueDate: null }]
    snapshot.reminders = [{ id: 'rem-1', saleId: 'sale-1', customerId: 'customer-1', ruleId: null, templateId: null, scheduledFor: '2026-10-04', status: 'pending', sentAt: null, stage: 'قبل الاستحقاق' }]
    snapshot.reminderRules = [{ id: 'rule-1', name: 'تذكير مبكر', offsetDays: -3, stage: 'تذكير مبكر', templateId: 'tpl-1', isActive: true, customerId: null }]
    snapshot.messageTemplates = [{ id: 'tpl-1', name: 'قالب', stage: 'قبل الاستحقاق', body: 'رسالة', channel: 'whatsapp' }]
    snapshot.promises = [{ id: 'promise-1', saleId: 'sale-1', customerId: 'customer-1', promisedDate: '2026-10-10', amountMinor: 5000, status: 'open', notes: '' }]
    snapshot.payments = [
      { id: 'cp-1', partyType: 'customer', customerId: 'customer-1', supplierId: null, direction: 'in', amountMinor: 2500, method: 'cash', date: '2026-10-03', reference: null, notes: null, isReversed: false, allocations: [{ docType: 'sale', saleId: 'sale-1', purchaseId: null, amountMinor: 2500, isInitial: false }] },
      { id: 'sp-1', partyType: 'supplier', customerId: null, supplierId: 'supplier-1', direction: 'out', amountMinor: 1000, method: 'transfer', date: '2026-10-03', reference: 'PAY-1', notes: 'سداد', isReversed: false, allocations: [] },
    ]
    snapshot.refunds = [{ id: 'refund-1', customerId: 'customer-1', saleId: 'sale-1', amountMinor: 1000, method: 'cash', date: '2026-10-04', notes: null }]
    snapshot.returns = [
      { id: 'sr-1', number: 'RET-1', type: 'sales', saleId: 'sale-1', purchaseId: null, date: '2026-10-04', reason: 'مرتجع', lines: [{ itemId: 'raw-1', qtyBase: 1000, valueMinor: 5000, costMinor: 2000, originalSalesLineId: 'sale-line-1' }] },
      { id: 'pr-1', number: 'PRT-1', type: 'purchase', saleId: null, purchaseId: 'purchase-1', date: '2026-10-04', reason: 'مرتجع', lines: [{ itemId: 'raw-1', qtyBase: 1000, valueMinor: 5000, costMinor: 2000, originalSalesLineId: null }] },
    ]
    snapshot.stockMovements = [{ id: 'move-1', itemId: 'raw-1', lotId: 'lot-1', type: 'purchase', qtyBase: 1000, balanceAfterBase: 3000, costMinor: 1000, refType: 'purchase', refId: 'purchase-1', createdAt: '2026-10-02', notes: null, createdBy: null }]
    snapshot.messageLog = [{ id: 'msg-1', reminderId: 'rem-1', customerId: 'customer-1', toPhone: '010', body: 'رسالة', status: 'sent', createdAt: '2026-10-03' }]
    snapshot.auditLog = [{ id: 'audit-1', at: '2026-10-03', userId: 'user-1', userName: 'المالك', action: 'purchase.confirm', entity: 'purchase', entityId: 'purchase-1' }]

    const state = mapSnapshot(snapshot)
    expect(state.customers[0]?.creditLimit).toBe(500)
    expect(state.customerOpenings.map((entry) => entry.partyId)).toEqual(['customer-1', 'customer-1'])
    expect(state.supplierOpenings[0]?.partyId).toBe('supplier-1')
    expect(state.purchaseDrafts[0]).toMatchObject({ quantity: 2, unitPrice: 100 })
    expect(state.reminders[0]?.status).toBe('pending')
    expect(state.reminderRules[0]?.active).toBe(true)
    expect(state.messageTemplates[0]?.body).toBe('رسالة')
    expect(state.promises[0]?.amount).toBe(50)
    expect(state.customerPayments[0]?.saleId).toBe('sale-1')
    expect(state.supplierPayments[0]?.reference).toBe('PAY-1')
    expect(state.refunds[0]?.amount).toBe(10)
    expect(state.salesReturns[0]?.customerId).toBe('customer-1')
    expect(state.purchaseReturns[0]?.supplierId).toBe('supplier-1')
    expect(state.stockLedger[0]?.balanceAfter).toBe(3)
    expect(state.messageLog[0]?.body).toBe('رسالة')
    expect(state.auditLog[0]?.action).toBe('purchase.confirm')
    expect(state.activity[0]?.type).toBe('purchase')
  })
})

describe('statement characterization', () => {
  it('orders customer entries and carries the balance forward', () => {
    const state = mapSnapshot(snapshotFixture())
    state.customerOpenings = [{ id: 'opening-1', partyId: 'customer-1', amount: 100, date: '2026-10-01', notes: 'افتتاحي' }]
    state.customerPayments = [{ id: 'payment-1', customerId: 'customer-1', saleId: 'sale-1', amount: 50, date: '2026-10-03', method: 'cash', note: 'تحصيل', reversed: false }]
    state.refunds = [{ id: 'refund-1', customerId: 'customer-1', saleId: 'sale-1', amount: 10, date: '2026-10-04', method: 'cash', notes: 'رد' }]
    state.salesReturns = [{ id: 'return-1', number: 'RET-1', saleId: 'sale-1', customerId: 'customer-1', itemId: 'raw-1', quantity: 1, value: 20, cost: 0, date: '2026-10-05', reason: 'مرتجع' }]

    expect(customerStatementEntries(state, 'customer-1').map(entry => [entry.type, entry.balance])).toEqual([
      ['رصيد افتتاحي', 100], ['فاتورة بيع', 220], ['تحصيل', 170], ['رد مبلغ للعميل', 180], ['مرتجع مبيعات', 160]
    ])
  })

  it('keeps supplier statement ordering and balances in the printable document', async () => {
    const state = mapSnapshot(snapshotFixture())
    state.supplierOpenings = [{ id: 'opening-1', partyId: 'supplier-1', amount: 30, date: '2026-10-01', notes: 'افتتاحي' }]
    state.supplierPayments = [{ id: 'payment-1', supplierId: 'supplier-1', amount: 50, date: '2026-10-03', method: 'cash', reference: 'PAY-1', note: 'سداد' }]
    state.purchaseReturns = [{ id: 'return-1', number: 'RET-1', purchaseId: 'purchase-1', supplierId: 'supplier-1', itemId: 'raw-1', quantity: 1, value: 20, date: '2026-10-04', reason: 'مرتجع' }]
    const printHtml = vi.fn().mockResolvedValue(true)
    window.repack = { printHtml } as unknown as typeof window.repack

    await expect(printSupplierStatement(state, 'supplier-1')).resolves.toBe(true)
    const html = printHtml.mock.calls[0]?.[0] || ''
    expect(html.indexOf('OPENING')).toBeLessThan(html.indexOf('PUR-1'))
    expect(html.indexOf('PUR-1')).toBeLessThan(html.indexOf('PAY-1'))
    expect(html.indexOf('PAY-1')).toBeLessThan(html.indexOf('RET-1'))
    expect(html).toContain(money(160))
  })
})

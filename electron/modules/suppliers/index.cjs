const contributeSnapshot = require('./snapshot.cjs')
const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')

function saveSupplier(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.name?.trim()) throw new Error('Supplier name is required')
    if (['balance', 'balanceMinor'].some(key => Object.hasOwn(input, key))) throw new Error('Supplier balance must use an opening entry or audited correction')
    assertNonnegativeInt(input.creditDays || 0, 'creditDays')
    const supplierId = input.id || id('supplier'), date = nowDate(input.date)
    const exists = one(db, 'SELECT id FROM suppliers WHERE id=?', [supplierId])
    const opening = input.openingBalanceMinor
    if (opening !== undefined) assertNonnegativeInt(opening, 'openingBalanceMinor')
    if (opening !== undefined && contextOf(options).role !== 'owner') throw new Error('Only an owner can write an opening supplier balance')
    if (exists) write(db, control, 'supplier.update', 'UPDATE suppliers SET name=?,phone=?,whatsapp=?,address=?,default_credit_days=?,notes=?,is_active=?,updated_at=? WHERE id=?', [input.name.trim(), input.phone || '', input.whatsapp || null, input.address || null, input.creditDays || 0, input.notes || null, input.isActive === false ? 0 : 1, date, supplierId])
    else write(db, control, 'supplier.create', 'INSERT INTO suppliers (id,name,phone,whatsapp,address,default_credit_days,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [supplierId, input.name.trim(), input.phone || '', input.whatsapp || null, input.address || null, input.creditDays || 0, input.notes || null, input.isActive === false ? 0 : 1, date, date])
    if (!exists && opening > 0) write(db, control, 'supplier.opening-balance', 'INSERT INTO supplier_opening_balances (id,supplier_id,balance_delta_minor,effective_date,due_date,is_opening,notes) VALUES (?,?,?,?,?,1,?)', [id('opening'), supplierId, opening, date, input.openingDueDate || null, input.openingNotes || 'رصيد افتتاحي'])
    if (exists && opening !== undefined) {
      if (contextOf(options).role !== 'owner') throw new Error('Only an owner can correct an opening balance')
      const previousOpening = one(db, 'SELECT COALESCE(SUM(balance_delta_minor),0) AS value FROM supplier_opening_balances WHERE supplier_id=?', [supplierId]).value
      const delta = opening - previousOpening
      if (delta) {
        if (!input.openingCorrectionReason?.trim()) throw new Error('An audited correction reason is required')
        write(db, control, 'supplier.balance-correction', 'INSERT INTO supplier_balance_adjustments (id,supplier_id,balance_delta_minor,effective_date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?)', [id('balance-correction'), supplierId, delta, date, input.openingCorrectionReason.trim(), contextOf(options).userId, new Date().toISOString()])
        audit(db, control, options, 'supplier.balance-correction', 'supplier', supplierId, { deltaMinor: delta, reason: input.openingCorrectionReason.trim() })
      }
    }
    audit(db, control, options, exists ? 'supplier.update' : 'supplier.create', 'supplier', supplierId, { name: input.name.trim(), isActive: input.isActive !== false })
    return { id: supplierId }
  })
  return { ...result.result, steps: result.steps }
}

function recordSupplierPayment(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const supplier = requiredRow(one(db, 'SELECT id FROM suppliers WHERE id=? AND is_active=1', [input.supplierId]), 'Active supplier not found')
    assertPositiveInt(input.amountMinor, 'amountMinor')
    // Without an explicit list the payment is distributed oldest-first (FIFO)
    // across the supplier's open invoices; any excess stays unapplied and
    // simply lowers the supplier balance.
    let allocations = input.allocations || (input.purchaseId ? [{ purchaseId: input.purchaseId, amountMinor: input.amountMinor }] : null)
    if (!allocations) {
      let pool = input.amountMinor
      allocations = []
      const openInvoices = db.prepare("SELECT * FROM purchase_invoices WHERE supplier_id=? AND status='confirmed' ORDER BY COALESCE(due_date, date), date, rowid").all(supplier.id)
      for (const invoice of openInvoices) {
        if (pool <= 0) break
        const priorReturns = one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='purchase' AND r.purchase_invoice_id=?", [invoice.id]).amount
        const outstanding = invoice.total_minor - invoice.paid_amount_minor - priorReturns
        if (outstanding <= 0) continue
        const applied = Math.min(outstanding, pool)
        allocations.push({ purchaseId: invoice.id, amountMinor: applied })
        pool -= applied
      }
    }
    if (allocations.some(row => !row.purchaseId || !Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0)) throw new Error('Payment allocations are required and must be positive integers')
    const sum = allocations.reduce((total, row) => total + row.amountMinor, 0)
    if (sum > input.amountMinor) throw new Error('Supplier payment allocations exceed the paid amount')
    for (const row of allocations) {
      const invoice = requiredRow(one(db, "SELECT * FROM purchase_invoices WHERE id=? AND supplier_id=? AND status='confirmed'", [row.purchaseId, supplier.id]), 'Confirmed supplier invoice not found')
      const priorReturns = one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='purchase' AND r.purchase_invoice_id=?", [invoice.id]).amount
      if (row.amountMinor > invoice.total_minor - invoice.paid_amount_minor - priorReturns) throw new Error('Payment allocation exceeds invoice outstanding amount')
    }
    const paymentId = input.id || id('payment'), date = nowDate(input.date)
    write(db, control, 'supplier-payment.row', 'INSERT INTO payments (id,party_type,party_id,supplier_id,direction,amount_minor,method,date,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [paymentId, 'supplier', supplier.id, supplier.id, 'out', input.amountMinor, input.method || 'cash', date, input.reference || null, input.notes || null, actorId(options), date])
    for (const allocation of allocations) {
      write(db, control, `supplier-payment.allocation:${allocation.purchaseId}`, 'INSERT INTO payment_allocations (id,payment_id,doc_type,purchase_invoice_id,amount_minor) VALUES (?,?,?,?,?)', [id('allocation'), paymentId, 'purchase', allocation.purchaseId, allocation.amountMinor])
      write(db, control, `supplier-payment.invoice:${allocation.purchaseId}`, 'UPDATE purchase_invoices SET paid_amount_minor=paid_amount_minor+? WHERE id=?', [allocation.amountMinor, allocation.purchaseId])
    }
    write(db, control, 'supplier-payment.cash', 'INSERT INTO cash_transactions (id,account,amount_minor,transaction_type,ref_type,ref_id,date,created_by) VALUES (?,?,?,?,?,?,?,?)', [id('cash'), 'cash', -input.amountMinor, 'supplier-payment', 'payment', paymentId, date, actorId(options)])
    audit(db, control, options, 'supplier.pay', 'payment', paymentId, { amountMinor: input.amountMinor, allocations })
    return { id: paymentId, allocatedMinor: sum }
  })
  return { ...result.result, steps: result.steps }
}

function register(registry) {
  registry.defineCommand({ name: 'supplier:pay', roles: ["owner","purchasing"], handler: recordSupplierPayment })
  registry.defineCommand({ name: 'supplier:save', roles: ["owner","purchasing"], handler: saveSupplier })
}

module.exports = { saveSupplier, recordSupplierPayment, register, snapshot: contributeSnapshot }

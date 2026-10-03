const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')
const { outstandingOfSale, syncSaleStatus } = require('../sales/index.cjs')

function recordCollection(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const customer = requiredRow(one(db, 'SELECT * FROM customers WHERE id=?', [input.customerId]), 'Customer not found')
    assertPositiveInt(input.amountMinor, 'amountMinor')
    let allocated
    if (Array.isArray(input.allocations) && input.allocations.length) {
      allocated = input.allocations
      if (allocated.some(a => !Number.isSafeInteger(a.amountMinor) || a.amountMinor <= 0)) throw new Error('Payment allocations must be positive integers')
      if (allocated.reduce((n, a) => n + a.amountMinor, 0) > input.amountMinor) throw new Error('Payment allocations exceed payment amount')
    } else {
      const openSales = input.saleId
        ? [requiredRow(one(db, "SELECT * FROM sales_orders WHERE id=? AND customer_id=? AND status NOT IN ('cancelled','draft')", [input.saleId, customer.id]), 'Confirmed sale not found')]
        : db.prepare("SELECT * FROM sales_orders WHERE customer_id=? AND status NOT IN ('cancelled','draft') ORDER BY COALESCE(due_date, date), date, rowid").all(customer.id)
      let pool = input.amountMinor
      allocated = []
      for (const sale of openSales) {
        if (pool <= 0) break
        const outstanding = outstandingOfSale(db, sale)
        if (outstanding <= 0) continue
        const applied = Math.min(outstanding, pool)
        allocated.push({ saleId: sale.id, amountMinor: applied })
        pool -= applied
      }
    }
    const sum = allocated.reduce((n, a) => n + a.amountMinor, 0)
    const salesById = new Map()
    for (const allocation of allocated) {
      const sale = salesById.get(allocation.saleId) || requiredRow(one(db, "SELECT * FROM sales_orders WHERE id=? AND status NOT IN ('cancelled','draft')", [allocation.saleId]), 'Confirmed sale not found')
      if (sale.customer_id !== customer.id) throw new Error('Collection allocations must belong to the paying customer')
      salesById.set(sale.id, sale)
      if (allocation.amountMinor > outstandingOfSale(db, sale)) throw new Error('Collection exceeds invoice outstanding amount')
    }
    const paymentId = input.id || id('payment'), date = nowDate(input.date)
    write(db, control, 'collection.payment', 'INSERT INTO payments (id,party_type,party_id,customer_id,direction,amount_minor,method,date,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [paymentId, 'customer', customer.id, customer.id, 'in', input.amountMinor, input.method || 'cash', date, input.reference || null, input.notes || null, actorId(options), date])
    for (const allocation of allocated) {
      write(db, control, `collection.allocation:${allocation.saleId}`, 'INSERT INTO payment_allocations (id,payment_id,doc_type,sales_order_id,amount_minor) VALUES (?,?,?,?,?)', [id('allocation'), paymentId, 'sales', allocation.saleId, allocation.amountMinor])
      write(db, control, `collection.invoice-paid:${allocation.saleId}`, 'UPDATE sales_orders SET paid_amount_minor=paid_amount_minor+? WHERE id=?', [allocation.amountMinor, allocation.saleId])
      syncSaleStatus(db, control, allocation.saleId)
    }
    write(db, control, 'collection.cash', 'INSERT INTO cash_transactions (id,account,amount_minor,transaction_type,ref_type,ref_id,date,created_by) VALUES (?,?,?,?,?,?,?,?)', [id('cash'), 'cash', input.amountMinor, 'collection', 'payment', paymentId, date, actorId(options)])
    audit(db, control, options, 'customer.collect', 'payment', paymentId, { amountMinor: input.amountMinor, allocatedMinor: sum, unappliedMinor: input.amountMinor - sum, invoiceCount: allocated.length })
    return { id: paymentId, allocatedMinor: sum, unappliedMinor: input.amountMinor - sum }
  })
  return { ...result.result, steps: result.steps }
}

function recordPromise(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const sale = requiredRow(one(db, "SELECT * FROM sales_orders WHERE id=? AND customer_id=? AND status NOT IN ('cancelled','draft')", [input.saleId, input.customerId]), 'Confirmed customer sale not found')
    assertNonnegativeInt(input.amountMinor, 'amountMinor')
    const returned = one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=?", [sale.id]).amount
    if (input.amountMinor > sale.total_minor - sale.paid_amount_minor - returned) throw new Error('Promise exceeds invoice outstanding amount')
    if (!input.promisedDate) throw new Error('promisedDate is required')
    const promiseId = input.id || id('promise')
    write(db, control, 'promise.create', 'INSERT INTO promises_to_pay (id,customer_id,sales_order_id,promised_date,amount_minor,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?)', [promiseId, input.customerId, sale.id, input.promisedDate, input.amountMinor, 'open', input.notes || '', nowDate(input.date)])
    // A fresh promise reschedules the invoice's pending reminders to the
    // promised date so the customer is not chased in between.
    write(db, control, 'promise.reschedule', "UPDATE reminders SET scheduled_for=? WHERE sales_order_id=? AND status='pending'", [input.promisedDate, sale.id])
    audit(db, control, options, 'customer.promise', 'promise', promiseId, { saleId: sale.id, promisedDate: input.promisedDate, amountMinor: input.amountMinor })
    return { id: promiseId }
  })
  return { ...result.result, steps: result.steps }
}

function reversePayment(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (contextOf(options).role !== 'owner') throw new Error('Only an owner can reverse a payment')
    if (!input.reason?.trim()) throw new Error('A reversal reason is required')
    const payment = requiredRow(one(db, 'SELECT * FROM payments WHERE id=?', [input.paymentId]), 'Payment not found')
    if (payment.reversed_of_id) throw new Error('Payment is already linked to a reversal')
    if (one(db, 'SELECT id FROM payments WHERE reversed_of_id=?', [payment.id])) throw new Error('Payment has already been reversed')
    const date = nowDate(input.date), reversalId = input.id || id('payment')
    const allocations = db.prepare('SELECT * FROM payment_allocations WHERE payment_id=?').all(payment.id)
    write(db, control, 'payment.reverse-row', 'INSERT INTO payments (id,party_type,party_id,customer_id,supplier_id,direction,amount_minor,method,date,reference,notes,reversed_of_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [reversalId, payment.party_type, payment.party_id, payment.customer_id, payment.supplier_id, payment.direction, payment.amount_minor, payment.method, date, payment.reference, 'عكس دفعة: ' + input.reason.trim(), payment.id, actorId(options), date])
    write(db, control, 'payment.mark-reversed', 'UPDATE payments SET reversed_of_id=? WHERE id=?', [reversalId, payment.id])
    for (const allocation of allocations) {
      write(db, control, `payment.reverse-allocation:${allocation.id}`, 'DELETE FROM payment_allocations WHERE id=?', [allocation.id])
      if (allocation.doc_type === 'sales') {
        write(db, control, `payment.reverse-sale:${allocation.sales_order_id}`, `UPDATE sales_orders SET ${allocation.is_initial ? 'initial_paid_amount_minor=initial_paid_amount_minor-?' : 'paid_amount_minor=paid_amount_minor-?'} WHERE id=?`, [allocation.amount_minor, allocation.sales_order_id])
        if (allocation.is_initial) write(db, control, `payment.reverse-sale-paid:${allocation.sales_order_id}`, 'UPDATE sales_orders SET paid_amount_minor=paid_amount_minor-? WHERE id=?', [allocation.amount_minor, allocation.sales_order_id])
        syncSaleStatus(db, control, allocation.sales_order_id)
      } else {
        write(db, control, `payment.reverse-purchase:${allocation.purchase_invoice_id}`, `UPDATE purchase_invoices SET ${allocation.is_initial ? 'initial_paid_amount_minor=initial_paid_amount_minor-?' : 'paid_amount_minor=paid_amount_minor-?'} WHERE id=?`, [allocation.amount_minor, allocation.purchase_invoice_id])
        if (allocation.is_initial) write(db, control, `payment.reverse-purchase-paid:${allocation.purchase_invoice_id}`, 'UPDATE purchase_invoices SET paid_amount_minor=paid_amount_minor-? WHERE id=?', [allocation.amount_minor, allocation.purchase_invoice_id])
      }
    }
    write(db, control, 'payment.reverse-cash', 'INSERT INTO cash_transactions (id,account,amount_minor,transaction_type,ref_type,ref_id,date,created_by) VALUES (?,?,?,?,?,?,?,?)', [id('cash'), 'cash', payment.direction === 'in' ? -payment.amount_minor : payment.amount_minor, 'payment-reversal', 'payment', reversalId, date, actorId(options)])
    audit(db, control, options, 'payment.reverse', 'payment', payment.id, { reversalId, amountMinor: payment.amount_minor, reason: input.reason.trim(), allocationsRemoved: allocations.length })
    return { id: reversalId, reversedPaymentId: payment.id, allocationsRemoved: allocations.length }
  })
  return { ...result.result, steps: result.steps }
}

// FR-PCK-08: cancelling a confirmed packing order returns every consumed
// input to its lot and voids the produced lot — only possible while none of
// the produced units have been consumed or sold.

function writeOffSale(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (contextOf(options).role !== 'owner') throw new Error('Only an owner can write off debt')
    const sale = requiredRow(one(db, "SELECT * FROM sales_orders WHERE id=? AND status NOT IN ('cancelled','draft')", [input.saleId]), 'Open sale not found')
    if (!input.reason?.trim()) throw new Error('A write-off reason is required')
    const outstanding = outstandingOfSale(db, sale)
    if (outstanding <= 0) throw new Error('Only an invoice with an outstanding balance can be written off')
    write(db, control, 'writeoff.status', "UPDATE sales_orders SET status='cancelled', notes=COALESCE(notes || ' · ', '') || ? WHERE id=?", ['شطب مديونية: ' + input.reason.trim(), sale.id])
    write(db, control, 'writeoff.reminders', "UPDATE reminders SET status='cancelled' WHERE sales_order_id=? AND status='pending'", [sale.id])
    write(db, control, 'writeoff.promises', "UPDATE promises_to_pay SET status='broken' WHERE sales_order_id=? AND status='open'", [sale.id])
    audit(db, control, options, 'debt.writeoff', 'sale', sale.id, { writtenOffMinor: outstanding, reason: input.reason.trim() })
    return { id: sale.id, writtenOffMinor: outstanding }
  })
  return { ...result.result, steps: result.steps }
}

function register(registry) {
  registry.defineCommand({ name: 'customer:collect', roles: ["owner","sales"], handler: recordCollection })
  registry.defineCommand({ name: 'customer:promise', roles: ["owner","sales"], handler: recordPromise })
  registry.defineCommand({ name: 'payment:reverse', roles: ["owner"], handler: reversePayment })
  registry.defineCommand({ name: 'customer:writeoff', roles: ["owner"], handler: writeOffSale })
}

module.exports = { recordCollection, recordPromise, reversePayment, writeOffSale, register }

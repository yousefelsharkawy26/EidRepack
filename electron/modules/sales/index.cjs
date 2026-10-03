const contributeSnapshot = require('./snapshot.cjs')
const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')
const { z } = require('zod')
const { pageSchema } = require('../../core/query.cjs')
const { paginateQuery } = require('../../core/dispatcher.cjs')
const { recordReminderRows } = require('../reminders/index.cjs')

function confirmSale(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const customer = requiredRow(one(db, 'SELECT * FROM customers WHERE id=? AND is_active=1', [input.customerId]), 'Active customer not found')
    const saleId = input.id || id('sale'), date = nowDate(input.date)
    const lines = input.lines || []
    if (!lines.length) throw new Error('Sale requires at least one line')
    // A line may carry either a per-base-unit price (`unitPriceMinor`) or an
    // explicit authoritative `lineTotalMinor` — the renderer sends the latter
    // because a display-unit price (e.g. EGP per kg) is not always an integer
    // number of piasters per base unit (gram).
    const totals = lines.map(line => {
      assertPositiveInt(line.quantity, 'sale quantity')
      if (line.lineTotalMinor !== undefined) {
        assertNonnegativeInt(line.lineTotalMinor, 'lineTotalMinor')
        return line.lineTotalMinor
      }
      assertNonnegativeInt(line.unitPriceMinor, 'unitPriceMinor'); assertNonnegativeInt(line.discountMinor || 0, 'discountMinor')
      return line.quantity * line.unitPriceMinor - (line.discountMinor || 0)
    })
    if (totals.some(total => total < 0 || !Number.isSafeInteger(total))) throw new Error('Invalid sale line total')
    const subtotal = totals.reduce((a, b) => a + b, 0), total = subtotal - (input.discountMinor || 0) + (input.taxMinor || 0)
    if (total < 0) throw new Error('Invalid sale total')
    const paid = input.paidMinor || 0
    assertNonnegativeInt(paid, 'paidMinor')
    if (paid > total) throw new Error('Paid amount exceeds sale total')
    const credit = total - paid
    const before = one(db, 'SELECT balance_minor FROM v_customer_balance WHERE customer_id=?', [customer.id]).balance_minor
    if (customer.is_blocked && credit > 0) throw new Error('Customer is blocked')
    // BR-CR-07: a blocked customer can never be overridden. Exceeding the
    // credit limit requires a PIN elevation (scope customer-credit); the
    // approver and the recorded reason are stored on the invoice itself.
    let overrideBy = null
    if (before + credit > customer.credit_limit_minor) {
      const elevation = elevationFor(options, 'customer-credit')
      if (!elevation) throw new Error('Credit limit exceeded')
      if (!input.overrideReason?.trim()) throw new Error('Credit override requires a recorded reason')
      overrideBy = elevation.userId
    }
    const dueDate = input.dueDate || null
    if (credit > 0 && customer.credit_days > 0 && !dueDate) throw new Error('Due date required for credit sale')
    write(db, control, 'sale.order', 'INSERT INTO sales_orders (id,number,customer_id,date,status,subtotal_minor,discount_minor,tax_minor,gross_total_minor,total_minor,paid_amount_minor,initial_paid_amount_minor,credit_amount_minor,due_date,credit_override_by,credit_override_reason,notes,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [saleId, input.number, customer.id, date, credit ? (paid ? 'partial' : 'confirmed') : 'paid', subtotal, input.discountMinor || 0, input.taxMinor || 0, total, total, paid, paid, credit, dueDate, overrideBy, overrideBy ? input.overrideReason.trim() : null, input.notes || null, date, actorId(options)])
    // FR-INV-03: COGS follows the configured costing method. FIFO prices each
    // line from the lots physically consumed; WAVG prices it at the moving
    // weighted average on hand. Lot depletion stays FIFO either way so the
    // lot ledger always reconciles with stock movements.
    const costingMethod = settingValue(db, 'costing_method', 'FIFO')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const item = requiredRow(one(db, "SELECT * FROM items WHERE id=? AND type='finished'", [line.itemId]), 'Sale item must be finished goods')
      const allocations = consumeFifo(db, control, item.id, line.quantity, 'sale', 'sales', saleId, actorId(options), date)
      const explicitTotal = line.lineTotalMinor !== undefined
      const storedUnitPrice = explicitTotal ? roundHalfUp(totals[i], line.quantity) : line.unitPriceMinor
      let allocatedDiscount = 0
      let allocatedValue = 0
      for (let j = 0; j < allocations.length; j++) {
        const allocation = allocations[j]
        let discount = 0
        let lineValue
        if (explicitTotal) {
          lineValue = j === allocations.length - 1 ? totals[i] - allocatedValue : roundHalfUp(BigInt(totals[i]) * BigInt(allocation.quantity), BigInt(line.quantity))
        } else {
          discount = j === allocations.length - 1 ? (line.discountMinor || 0) - allocatedDiscount : roundHalfUp(BigInt(line.discountMinor || 0) * BigInt(allocation.quantity), BigInt(line.quantity))
          allocatedDiscount += discount
          lineValue = allocation.quantity * line.unitPriceMinor - discount
        }
        allocatedValue += lineValue
        let unitCost = roundHalfUp(allocation.cost, allocation.quantity)
        let cogs = allocation.cost
        if (costingMethod === 'WAVG') {
          const onHand = one(db, 'SELECT quantity_base, cost_remaining_minor FROM v_stock_balance WHERE item_id=?', [item.id])
          if (onHand && onHand.quantity_base > 0) {
            unitCost = roundHalfUp(onHand.cost_remaining_minor, onHand.quantity_base)
            cogs = unitCost * allocation.quantity
          }
        }
        write(db, control, `sale.line:${i}:${j}`, 'INSERT INTO sales_lines (id,order_id,item_id,lot_id,qty_base,unit_price_minor,discount_minor,line_total_minor,unit_cost_minor,cogs_total_minor) VALUES (?,?,?,?,?,?,?,?,?,?)', [id('sales-line'), saleId, item.id, allocation.lot.id, allocation.quantity, storedUnitPrice, discount, lineValue, unitCost, cogs])
      }
    }
    if (paid) {
      const paymentId = id('payment')
       write(db, control, 'sale.payment', 'INSERT INTO payments (id,party_type,party_id,customer_id,direction,amount_minor,method,date,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [paymentId, 'customer', customer.id, customer.id, 'in', paid, input.method || 'cash', date, 'دفعة مع الفاتورة', actorId(options), date])
      write(db, control, 'sale.payment-allocation', 'INSERT INTO payment_allocations (id,payment_id,doc_type,sales_order_id,amount_minor,is_initial) VALUES (?,?,?,?,?,1)', [id('allocation'), paymentId, 'sales', saleId, paid])
      write(db, control, 'sale.cash', 'INSERT INTO cash_transactions (id,account,amount_minor,transaction_type,ref_type,ref_id,date,created_by) VALUES (?,?,?,?,?,?,?,?)', [id('cash'), 'cash', paid, 'sale-payment', 'sale', saleId, date, actorId(options)])
    }
    const sale = one(db, 'SELECT * FROM sales_orders WHERE id=?', [saleId])
    recordReminderRows(db, control, sale, date)
    audit(db, control, options, 'sale.confirm', 'sale', saleId, { totalMinor: total, paidMinor: paid, creditMinor: credit })
    return { id: saleId, totalMinor: total, creditMinor: credit }
  })
  return { ...result.result, steps: result.steps }
}

function returnSale(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const sale = requiredRow(one(db, 'SELECT * FROM sales_orders WHERE id=?', [input.saleId]), 'Sale not found')
    const returnId = input.id || id('return'), date = nowDate(input.date)
    write(db, control, 'sales-return.doc', 'INSERT INTO returns (id,number,return_type,sales_order_id,date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)', [returnId, input.number, 'sales', sale.id, date, input.reason || '', actorId(options), date])
    const lines = input.lines || []
    if (!lines.length) throw new Error('Sales return requires at least one line')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]; assertPositiveInt(line.quantity, 'return quantity')
      const original = requiredRow(one(db, 'SELECT * FROM sales_lines WHERE id=? AND order_id=?', [line.originalSalesLineId, sale.id]), 'Original sale line not found')
      if (!original.lot_id) throw new Error('New sales returns require an original lot')
      const returnedBefore = one(db, 'SELECT COALESCE(SUM(qty_base),0) AS qty FROM return_lines WHERE original_sales_line_id=?', [original.id]).qty
      if (returnedBefore + line.quantity > original.qty_base) throw new Error('Return quantity exceeds sold quantity')
      const priorCost = one(db, 'SELECT COALESCE(SUM(cost_minor),0) AS cost FROM return_lines WHERE original_sales_line_id=?', [original.id]).cost
      const priorValue = one(db, 'SELECT COALESCE(SUM(value_minor),0) AS value FROM return_lines WHERE original_sales_line_id=?', [original.id]).value
      const totalReturnedCost = roundHalfUp(BigInt(original.cogs_total_minor) * BigInt(returnedBefore + line.quantity), BigInt(original.qty_base))
      const totalReturnedValue = roundHalfUp(BigInt(original.line_total_minor) * BigInt(returnedBefore + line.quantity), BigInt(original.qty_base))
      const cost = totalReturnedCost - priorCost, value = totalReturnedValue - priorValue
      const lot = requiredRow(one(db, 'SELECT * FROM stock_lots WHERE id=?', [original.lot_id]), 'Original lot not found')
      if (lot.qty_remaining_base + line.quantity > lot.qty_initial_base) throw new Error('Return would exceed original lot quantity')
      write(db, control, `sales-return.line:${i}`, 'INSERT INTO return_lines (id,return_id,item_id,original_sales_line_id,original_lot_id,return_lot_id,qty_base,value_minor,cost_minor) VALUES (?,?,?,?,?,?,?,?,?)', [id('return-line'), returnId, original.item_id, original.id, lot.id, lot.id, line.quantity, value, cost])
      write(db, control, `sales-return.lot:${i}`, 'UPDATE stock_lots SET qty_remaining_base=?,cost_remaining_minor=? WHERE id=?', [lot.qty_remaining_base + line.quantity, lot.cost_remaining_minor + cost, lot.id])
      const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [original.item_id]).quantity_base
      write(db, control, `sales-return.movement:${i}`, 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), original.item_id, lot.id, 'sales-return', line.quantity, balance, cost, 'return', returnId, date, actorId(options)])
    }
    syncSaleStatus(db, control, sale.id)
    // When amounts already collected exceed the invoice total after the
    // return, the difference is refunded explicitly (customer_refunds + a
    // cash outflow) instead of silently swallowing the overpayment.
    const outstandingNow = outstandingOfSale(db, one(db, 'SELECT * FROM sales_orders WHERE id=?', [sale.id]))
    const refundMinor = outstandingNow < 0 ? -outstandingNow : 0
    let refundId = null
    if (refundMinor > 0) {
      refundId = id('refund')
      write(db, control, 'sales-return.refund', 'INSERT INTO customer_refunds (id,customer_id,sales_order_id,amount_minor,method,date,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [refundId, sale.customer_id, sale.id, refundMinor, input.refundMethod || 'cash', date, 'رد مبلغ مدفوع زيادة بعد المرتجع ' + input.number, actorId(options), date])
      write(db, control, 'sales-return.refund-cash', 'INSERT INTO cash_transactions (id,account,amount_minor,transaction_type,ref_type,ref_id,date,created_by) VALUES (?,?,?,?,?,?,?,?)', [id('cash'), 'cash', -refundMinor, 'customer-refund', 'refund', refundId, date, actorId(options)])
    }
    audit(db, control, options, 'sale.return', 'return', returnId, { saleId: sale.id, lines: lines.length, refundMinor })
    return { id: returnId, refundMinor, refundId }
  })
  return { ...result.result, steps: result.steps }
}

// BR-PAY-03: reversing a payment removes its allocations, restores the
// affected invoices' outstanding amounts, and marks both rows so balance
// views ignore them. The rows stay in the ledger for the audit trail.

function syncSaleStatus(db, control, saleId) {
  const sale = one(db, 'SELECT * FROM sales_orders WHERE id=?', [saleId])
  const returned = one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=?", [saleId]).amount
  const outstanding = Math.max(0, sale.total_minor - sale.paid_amount_minor - returned)
  const status = outstanding === 0 ? 'paid' : sale.paid_amount_minor > 0 ? 'partial' : 'confirmed'
  write(db, control, 'sale.status', 'UPDATE sales_orders SET status=? WHERE id=?', [status, saleId])
  if (!outstanding) {
    write(db, control, 'reminders.cancel', "UPDATE reminders SET status='cancelled' WHERE sales_order_id=? AND status='pending'", [saleId])
    write(db, control, 'promises.keep', "UPDATE promises_to_pay SET status='kept' WHERE sales_order_id=? AND status='open'", [saleId])
  }
}

function outstandingOfSale(db, sale) {
  const priorReturns = one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=?", [sale.id]).amount
  return sale.total_minor - sale.paid_amount_minor - priorReturns
}

// FR-DBT-02/04: a collection may target one invoice, an explicit allocation
// list, or — when nothing is specified — the customer's open invoices oldest
// first (FIFO). Any excess beyond the outstanding amounts stays as an
// unapplied customer credit instead of being rejected or lost.

function register(registry) {
  registry.defineCommand({ name: 'sale:confirm', roles: ["owner","sales"], handler: confirmSale })
  registry.defineCommand({ name: 'sale:return', roles: ["owner","sales"], handler: returnSale })
  registry.defineQuery({ name: 'invoices:list', roles: ['owner', 'sales', 'purchasing'], schema: pageSchema.extend({ kind: z.enum(['sales', 'purchase']) }).strict(), handler: (db, ctx, input) => {
    if (input.kind === 'sales') {
      if (!['owner', 'sales'].includes(ctx.role)) throw new Error('Permission denied')
      return paginateQuery(db, 'SELECT id,number,customer_id,date,status,total_minor,paid_amount_minor,due_date FROM sales_orders ORDER BY date DESC,rowid DESC', [], input)
    }
    if (!['owner', 'purchasing'].includes(ctx.role)) throw new Error('Permission denied')
    return paginateQuery(db, 'SELECT id,number,supplier_id,date,status,subtotal_minor,extra_costs_total_minor,total_minor,paid_amount_minor,due_date FROM purchase_invoices ORDER BY date DESC,rowid DESC', [], input)
  } })
}

module.exports = { confirmSale, returnSale, syncSaleStatus, outstandingOfSale, register, snapshot: contributeSnapshot }

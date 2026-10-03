const { randomUUID } = require('node:crypto')
const { unitInfo } = require('../units.cjs')

function roundHalfUp(numerator, denominator = 1) {
  const nInput = typeof numerator === 'bigint' ? numerator : (Number.isSafeInteger(numerator) ? BigInt(numerator) : null)
  const dInput = typeof denominator === 'bigint' ? denominator : (Number.isSafeInteger(denominator) ? BigInt(denominator) : null)
  if (nInput === null || dInput === null || dInput <= 0n) throw new Error('Invalid half-up operands')
  const n = nInput < 0n ? -nInput : nInput, d = dInput
  const rounded = (n * 2n + d) / (2n * d)
  const signed = nInput < 0n ? -rounded : rounded
  const result = Number(signed)
  if (!Number.isSafeInteger(result)) throw new Error('Rounded amount exceeds safe integer range')
  return result
}

function id(prefix) { return `${prefix}-${randomUUID()}` }
function localDateString(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') }
function nowDate(value) { return value || localDateString(new Date()) }
function failController(options = {}) {
  let step = 0
  const trace = []
  return {
    trace,
    after(label) {
      trace.push(label)
      step += 1
      if (options.failAfterStep === step) throw new Error(`Injected failure after ${label}`)
    }
  }
}
function atomic(db, options, body) {
  contextOf(options)
  const control = failController(options)
  const run = db.transaction(() => body(control))
  return { result: run.immediate(), steps: control.trace }
}
function write(db, control, label, sql, params) {
  const result = db.prepare(sql).run(...params)
  control.after(label)
  return result
}
function one(db, sql, params) { return db.prepare(sql).get(...params) }
function assertPositiveInt(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
}
function assertNonnegativeInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer`)
}
function requiredRow(row, message) { if (!row) throw new Error(message); return row }
function contextOf(options = {}) {
  const ctx = options.ctx
  if (!ctx?.userId || !['owner', 'sales', 'warehouse', 'purchasing'].includes(ctx.role)) throw new Error('Authenticated user context is required')
  return ctx
}
function actorId(options = {}) { return contextOf(options).userId }
function audit(db, control, options, action, entity, entityId, after) {
  const ctx = contextOf(options)
  write(db, control, `audit:${action}:${entityId}`, 'INSERT INTO audit_log (id,user_id,action,entity,entity_id,after_json,created_at) VALUES (?,?,?,?,?,?,?)', [id('audit'), ctx?.userId || null, `${action}${ctx?.role ? ` [${ctx.role}]` : ''}`, entity, entityId, JSON.stringify(after ?? null), new Date().toISOString()])
}

function availableLots(db, itemId) {
  return db.prepare(`SELECT * FROM stock_lots WHERE item_id=? AND is_active=1 AND qty_remaining_base>0
    ORDER BY received_at, rowid`).all(itemId)
}
function consumeFifo(db, control, itemId, quantity, movementType, refType, refId, createdBy, date) {
  let remaining = quantity
  const allocations = []
  for (const lot of availableLots(db, itemId)) {
    if (!remaining) break
    const used = Math.min(remaining, lot.qty_remaining_base)
    const cost = used === lot.qty_remaining_base ? lot.cost_remaining_minor : roundHalfUp(BigInt(lot.cost_remaining_minor) * BigInt(used), BigInt(lot.qty_remaining_base))
    write(db, control, `lot.consume:${lot.id}`, 'UPDATE stock_lots SET qty_remaining_base=?,cost_remaining_minor=? WHERE id=?', [lot.qty_remaining_base - used, lot.cost_remaining_minor - cost, lot.id])
    const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [itemId]).quantity_base
    write(db, control, `movement:${lot.id}`, 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), itemId, lot.id, movementType, -used, balance, cost, refType, refId, date, createdBy || null])
    allocations.push({ lot, quantity: used, cost })
    remaining -= used
  }
  if (remaining) throw new Error(`Insufficient stock for item ${itemId}; short ${remaining}`)
  return allocations
}
function consumeSpecificLots(db, control, itemId, requested, movementType, refType, refId, createdBy, date) {
  const allocations = []
  for (const requestedLot of requested) {
    assertPositiveInt(requestedLot.quantity, 'lot allocation quantity')
    if (!requestedLot.lotId) throw new Error('Untracked stock must be migrated into an opening lot before packing')
    const lot = requiredRow(one(db, 'SELECT * FROM stock_lots WHERE id=? AND item_id=? AND is_active=1', [requestedLot.lotId, itemId]), 'Selected stock lot not found for item')
    if (lot.qty_remaining_base < requestedLot.quantity) throw new Error(`Insufficient stock in selected lot ${lot.id}`)
    const cost = requestedLot.quantity === lot.qty_remaining_base ? lot.cost_remaining_minor : roundHalfUp(BigInt(lot.cost_remaining_minor) * BigInt(requestedLot.quantity), BigInt(lot.qty_remaining_base))
    write(db, control, `lot.consume:${lot.id}`, 'UPDATE stock_lots SET qty_remaining_base=?,cost_remaining_minor=? WHERE id=?', [lot.qty_remaining_base - requestedLot.quantity, lot.cost_remaining_minor - cost, lot.id])
    const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [itemId]).quantity_base
    write(db, control, `movement:${lot.id}`, 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), itemId, lot.id, movementType, -requestedLot.quantity, balance, cost, refType, refId, date, createdBy || null])
    allocations.push({ lot, quantity: requestedLot.quantity, cost })
  }
  return allocations
}
function recordReminderRows(db, control, sale, date) {
  if (!sale.due_date || sale.total_minor <= sale.paid_amount_minor) return
  const rules = db.prepare('SELECT * FROM reminder_rules WHERE is_active=1 AND (customer_id IS NULL OR customer_id=?)').all(sale.customer_id)
  for (const rule of rules) {
    if (one(db, "SELECT id FROM reminders WHERE sales_order_id=? AND stage=?", [sale.id, rule.name])) throw new Error(`Duplicate reminder stage ${rule.name} for sale ${sale.id}`)
    const due = new Date(`${sale.due_date}T12:00:00Z`)
    due.setUTCDate(due.getUTCDate() + rule.offset_days)
    write(db, control, `reminder.create:${rule.id}`, 'INSERT INTO reminders (id,sales_order_id,customer_id,rule_id,template_id,scheduled_for,status,stage) VALUES (?,?,?,?,?,?,?,?)', [id('reminder'), sale.id, sale.customer_id, rule.id, rule.template_id, due.toISOString().slice(0, 10), 'pending', rule.name])
  }
}
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

// A PIN elevation approved by an owner (or by the acting user themselves when
// they are the owner) unlocks sensitive scopes for a short window.
function elevationFor(options, scope) {
  const elevation = options.elevation
  if (!elevation || elevation.scope !== scope || !(elevation.expiresAt > Date.now())) return null
  return elevation
}

function settingValue(db, key, fallback = null) {
  const row = one(db, 'SELECT value FROM settings WHERE key=?', [key])
  if (!row) return fallback
  try { return JSON.parse(row.value) } catch { return fallback }
}

function confirmPurchase(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const draft = input.draftId ? requiredRow(one(db, 'SELECT * FROM purchase_drafts WHERE id=?', [input.draftId]), 'Purchase draft not found') : null
    if (draft && (draft.supplier_id !== input.supplierId || draft.item_id !== input.itemId || draft.quantity_base !== input.quantity)) throw new Error('Purchase draft does not match confirmation data')
    const supplier = requiredRow(one(db, 'SELECT id FROM suppliers WHERE id=?', [input.supplierId]), 'Supplier not found')
    const item = requiredRow(one(db, 'SELECT id FROM items WHERE id=?', [input.itemId]), 'Item not found')
    assertPositiveInt(input.quantity, 'quantity'); assertNonnegativeInt(input.totalMinor, 'totalMinor'); assertNonnegativeInt(input.paidMinor || 0, 'paidMinor')
    if ((input.paidMinor || 0) > input.totalMinor) throw new Error('Paid amount exceeds purchase total')
    const date = nowDate(input.date), invoiceId = input.id || id('purchase'), lineId = id('purchase-line'), lotId = input.lotId || id('lot')
    write(db, control, 'purchase.invoice', 'INSERT INTO purchase_invoices (id,number,supplier_id,date,status,subtotal_minor,extra_costs_total_minor,total_minor,paid_amount_minor,initial_paid_amount_minor,due_date,supplier_invoice_number,notes,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [invoiceId, input.number, supplier.id, date, 'confirmed', input.subtotalMinor ?? input.totalMinor, input.extraCostsMinor || 0, input.totalMinor, input.paidMinor || 0, input.paidMinor || 0, input.dueDate || null, input.supplierInvoiceNumber || null, input.notes || null, date, actorId(options)])
    write(db, control, 'purchase.line', 'INSERT INTO purchase_lines (id,invoice_id,item_id,qty_base,line_total_minor,allocated_extra_cost_minor,landed_cost_total_minor) VALUES (?,?,?,?,?,?,?)', [lineId, invoiceId, item.id, input.quantity, input.lineTotalMinor ?? input.totalMinor, input.extraCostsMinor || 0, input.totalMinor])
    write(db, control, 'purchase.lot', 'INSERT INTO stock_lots (id,item_id,source_type,source_id,lot_code,qty_initial_base,qty_remaining_base,cost_total_minor,cost_remaining_minor,received_at,expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [lotId, item.id, 'purchase', invoiceId, input.lotCode || invoiceId, input.quantity, input.quantity, input.totalMinor, input.totalMinor, date, input.expiryDate || null])
    const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [item.id]).quantity_base
    write(db, control, 'purchase.movement', 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), item.id, lotId, 'purchase', input.quantity, balance, input.totalMinor, 'purchase', invoiceId, date, actorId(options)])
    if (input.paidMinor) {
      const paymentId = id('payment')
      write(db, control, 'purchase.payment', 'INSERT INTO payments (id,party_type,party_id,supplier_id,direction,amount_minor,method,date,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [paymentId, 'supplier', supplier.id, supplier.id, 'out', input.paidMinor, input.method || 'cash', date, 'دفعة عند اعتماد الفاتورة', actorId(options), date])
      write(db, control, 'purchase.payment-allocation', 'INSERT INTO payment_allocations (id,payment_id,doc_type,purchase_invoice_id,amount_minor,is_initial) VALUES (?,?,?,?,?,1)', [id('allocation'), paymentId, 'purchase', invoiceId, input.paidMinor])
      write(db, control, 'purchase.cash', 'INSERT INTO cash_transactions (id,account,amount_minor,transaction_type,ref_type,ref_id,date,created_by) VALUES (?,?,?,?,?,?,?,?)', [id('cash'), 'cash', -input.paidMinor, 'purchase-payment', 'purchase', invoiceId, date, actorId(options)])
    }
    audit(db, control, options, 'purchase.confirm', 'purchase', invoiceId, { totalMinor: input.totalMinor, paidMinor: input.paidMinor || 0, lotId })
    if (draft) write(db, control, 'purchase.draft-delete', 'DELETE FROM purchase_drafts WHERE id=?', [draft.id])
    return { id: invoiceId, lotId }
  })
  return { ...result.result, steps: result.steps }
}

function returnPurchase(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const invoice = requiredRow(one(db, 'SELECT * FROM purchase_invoices WHERE id=? AND status=\'confirmed\'', [input.purchaseId]), 'Confirmed purchase not found')
    assertPositiveInt(input.quantity, 'quantity'); assertNonnegativeInt(input.valueMinor, 'valueMinor')
    const previousReturnValue = one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='purchase' AND r.purchase_invoice_id=?", [invoice.id]).amount
    if (previousReturnValue + input.valueMinor > invoice.total_minor) throw new Error('Purchase return value exceeds original invoice total')
    const lot = requiredRow(one(db, 'SELECT * FROM stock_lots WHERE id=? AND item_id=?', [input.lotId, input.itemId]), 'Purchase lot not found')
    if (lot.qty_remaining_base < input.quantity) throw new Error('Purchase return exceeds available lot quantity')
    const cost = input.quantity === lot.qty_remaining_base ? lot.cost_remaining_minor : roundHalfUp(BigInt(lot.cost_remaining_minor) * BigInt(input.quantity), BigInt(lot.qty_remaining_base))
    const returnId = input.id || id('return'), date = nowDate(input.date)
    write(db, control, 'purchase-return.doc', 'INSERT INTO returns (id,number,return_type,purchase_invoice_id,date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)', [returnId, input.number, 'purchase', invoice.id, date, input.reason || '', actorId(options), date])
    write(db, control, 'purchase-return.line', 'INSERT INTO return_lines (id,return_id,item_id,original_purchase_line_id,original_lot_id,qty_base,value_minor,cost_minor) VALUES (?,?,?,?,?,?,?,?)', [id('return-line'), returnId, input.itemId, input.purchaseLineId || null, lot.id, input.quantity, input.valueMinor, cost])
    write(db, control, 'purchase-return.lot', 'UPDATE stock_lots SET qty_remaining_base=?,cost_remaining_minor=? WHERE id=?', [lot.qty_remaining_base - input.quantity, lot.cost_remaining_minor - cost, lot.id])
    const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [input.itemId]).quantity_base
    write(db, control, 'purchase-return.movement', 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), input.itemId, lot.id, 'purchase-return', -input.quantity, balance, cost, 'return', returnId, date, actorId(options)])
    audit(db, control, options, 'purchase.return', 'return', returnId, { purchaseId: invoice.id, quantity: input.quantity, valueMinor: input.valueMinor })
    return { id: returnId, costMinor: cost }
  })
  return { ...result.result, steps: result.steps }
}

function confirmPacking(db, input, options = {}) {
  const result = atomic(db, options, control => {
    assertPositiveInt(input.producedUnits, 'producedUnits')
    const item = requiredRow(one(db, "SELECT * FROM items WHERE id=? AND type='finished'", [input.finishedItemId]), 'Finished item not found')
    const recipe = db.prepare('SELECT component_item_id,qty_per_unit_base,line_type FROM item_recipe_lines WHERE finished_item_id=? AND is_active=1 ORDER BY id').all(item.id)
    if (!recipe.length) throw new Error('Finished item has no active recipe')
    const expectedInputs = new Map(recipe.map(line => [line.component_item_id, line.qty_per_unit_base * input.producedUnits + (line.line_type === 'raw' ? (input.wasteQty || 0) : 0)]))
    const requestedInputs = new Map()
    for (const line of input.inputs || []) requestedInputs.set(line.itemId, (requestedInputs.get(line.itemId) || 0) + line.quantity)
    if (expectedInputs.size !== requestedInputs.size || [...expectedInputs].some(([itemId, quantity]) => requestedInputs.get(itemId) !== quantity)) throw new Error('Packing inputs do not match the active recipe and waste quantity')
    if (input.lotAllocations) {
      const manualTotals = new Map()
      for (const allocation of input.lotAllocations) {
        assertPositiveInt(allocation.quantity, 'lot allocation quantity')
        if (!expectedInputs.has(allocation.itemId)) throw new Error('Selected lot allocation references an item outside the active recipe')
        manualTotals.set(allocation.itemId, (manualTotals.get(allocation.itemId) || 0) + allocation.quantity)
      }
      if ([...expectedInputs].some(([itemId, quantity]) => manualTotals.get(itemId) !== quantity)) throw new Error('Selected lots do not exactly cover recipe inputs')
    }
    const orderId = input.id || id('packing'), date = nowDate(input.date)
    write(db, control, 'packing.order', 'INSERT INTO packing_orders (id,number,date,finished_item_id,planned_units,produced_units,waste_qty_base,overhead_cost_total_minor,status,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [orderId, input.number, date, item.id, input.plannedUnits ?? input.producedUnits, input.producedUnits, input.wasteQty || 0, input.overheadCostMinor || 0, 'confirmed', date, actorId(options)])
    let totalCost = input.overheadCostMinor || 0
    const consumed = []
    for (const line of input.inputs || []) {
      assertPositiveInt(line.quantity, 'input quantity')
      const requestedLots = input.lotAllocations?.filter(allocation => allocation.itemId === line.itemId)
      const allocations = requestedLots ? consumeSpecificLots(db, control, line.itemId, requestedLots, 'packing-consumption', 'packing', orderId, actorId(options), date) : consumeFifo(db, control, line.itemId, line.quantity, 'packing-consumption', 'packing', orderId, actorId(options), date)
      const lineCost = allocations.reduce((sum, row) => sum + row.cost, 0)
      totalCost += lineCost
      for (const allocation of allocations) {
        write(db, control, `packing.input:${line.itemId}:${allocation.lot.id}`, 'INSERT INTO packing_inputs (id,order_id,item_id,lot_id,qty_base,cost_minor) VALUES (?,?,?,?,?,?)', [id('packing-input'), orderId, line.itemId, allocation.lot.id, allocation.quantity, allocation.cost])
      }
      consumed.push({ itemId: line.itemId, quantity: line.quantity, costMinor: lineCost })
    }
    const lotId = input.outputLotId || id('lot')
    write(db, control, 'packing.output-lot', 'INSERT INTO stock_lots (id,item_id,source_type,source_id,lot_code,qty_initial_base,qty_remaining_base,cost_total_minor,cost_remaining_minor,received_at,expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [lotId, item.id, 'packing', orderId, input.lotCode || orderId, input.producedUnits, input.producedUnits, totalCost, totalCost, date, input.expiryDate || null])
    write(db, control, 'packing.output', 'INSERT INTO packing_outputs (id,order_id,item_id,qty_units,cost_total_minor,output_lot_id) VALUES (?,?,?,?,?,?)', [id('packing-output'), orderId, item.id, input.producedUnits, totalCost, lotId])
    write(db, control, 'packing.unit-cost', 'UPDATE packing_orders SET raw_cost_total_minor=?,packaging_cost_total_minor=?,overhead_cost_total_minor=?,unit_cost_minor=? WHERE id=?', [consumed.filter(x => one(db, "SELECT type FROM items WHERE id=?", [x.itemId]).type === 'raw').reduce((a, x) => a + x.costMinor, 0), consumed.filter(x => one(db, "SELECT type FROM items WHERE id=?", [x.itemId]).type === 'packaging').reduce((a, x) => a + x.costMinor, 0), input.overheadCostMinor || 0, roundHalfUp(totalCost, input.producedUnits), orderId])
    const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [item.id]).quantity_base
    write(db, control, 'packing.production-movement', 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), item.id, lotId, 'packing-production', input.producedUnits, balance, totalCost, 'packing', orderId, date, actorId(options)])
    audit(db, control, options, 'packing.confirm', 'packing', orderId, { producedUnits: input.producedUnits, totalCostMinor: totalCost, lotId })
    return { id: orderId, lotId, totalCostMinor: totalCost, unitCostMinor: roundHalfUp(totalCost, input.producedUnits) }
  })
  return { ...result.result, steps: result.steps }
}

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

function outstandingOfSale(db, sale) {
  const priorReturns = one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=?", [sale.id]).amount
  return sale.total_minor - sale.paid_amount_minor - priorReturns
}

// FR-DBT-02/04: a collection may target one invoice, an explicit allocation
// list, or — when nothing is specified — the customer's open invoices oldest
// first (FIFO). Any excess beyond the outstanding amounts stays as an
// unapplied customer credit instead of being rejected or lost.
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
function cancelPacking(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (contextOf(options).role !== 'owner') throw new Error('Only an owner can cancel a packing order')
    const order = requiredRow(one(db, "SELECT * FROM packing_orders WHERE id=? AND status='confirmed'", [input.id]), 'Confirmed packing order not found')
    if (!input.reason?.trim()) throw new Error('A cancellation reason is required')
    const date = nowDate(input.date)
    const output = requiredRow(one(db, 'SELECT * FROM packing_outputs WHERE order_id=?', [order.id]), 'Packing output not found')
    const outLot = requiredRow(one(db, 'SELECT * FROM stock_lots WHERE id=?', [output.output_lot_id]), 'Produced lot not found')
    if (outLot.qty_remaining_base !== outLot.qty_initial_base) throw new Error('Produced units were already consumed or sold; the order cannot be cancelled')
    const inputs = db.prepare('SELECT * FROM packing_inputs WHERE order_id=?').all(order.id)
    for (const row of inputs) {
      const lot = requiredRow(one(db, 'SELECT * FROM stock_lots WHERE id=?', [row.lot_id]), 'Input lot not found')
      if (lot.qty_remaining_base + row.qty_base > lot.qty_initial_base) throw new Error('Input lot no longer has room for the returned quantity')
      write(db, control, `packing-cancel.restore:${row.id}`, 'UPDATE stock_lots SET qty_remaining_base=?,cost_remaining_minor=? WHERE id=?', [lot.qty_remaining_base + row.qty_base, lot.cost_remaining_minor + row.cost_minor, lot.id])
      const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [row.item_id]).quantity_base
      write(db, control, `packing-cancel.movement:${row.id}`, 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), row.item_id, row.lot_id, 'adjustment', row.qty_base, balance, row.cost_minor, 'packing-cancel', order.id, date, actorId(options), 'إلغاء أمر تعبئة: ' + input.reason.trim()])
    }
    const outBalance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [order.finished_item_id]).quantity_base
    write(db, control, 'packing-cancel.void-lot', 'UPDATE stock_lots SET qty_remaining_base=0,cost_remaining_minor=0,is_active=0 WHERE id=?', [outLot.id])
    write(db, control, 'packing-cancel.void-movement', 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), order.finished_item_id, outLot.id, 'adjustment', -outLot.qty_initial_base, outBalance - outLot.qty_initial_base, 0, 'packing-cancel', order.id, date, actorId(options), 'إلغاء دفعة إنتاج: ' + input.reason.trim()])
    write(db, control, 'packing-cancel.status', "UPDATE packing_orders SET status='cancelled', notes=? WHERE id=?", [input.reason.trim(), order.id])
    audit(db, control, options, 'packing.cancel', 'packing', order.id, { reason: input.reason.trim(), inputsRestored: inputs.length })
    return { id: order.id }
  })
  return { ...result.result, steps: result.steps }
}

// FR-DBT-07: writing off an invoice cancels the debt with an audited reason.
// The invoice leaves the open balances; nothing is restocked (the goods were
// delivered) and open promises/reminders are closed.
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

function adjustStock(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const ctx = contextOf(options)
    // The elevation may have been approved by an owner's PIN on behalf of the
    // acting user, so any live elevation with the right scope unlocks it.
    const elevated = Boolean(elevationFor(options, 'inventory-adjustment'))
    if (ctx.role !== 'owner' && !elevated) throw new Error('Inventory adjustment requires owner permission or a current PIN elevation')
    if (!Number.isSafeInteger(input.quantityDelta) || input.quantityDelta === 0) throw new Error('quantityDelta must be a nonzero integer')
    const item = requiredRow(one(db, 'SELECT * FROM items WHERE id=?', [input.itemId]), 'Item not found')
    const adjustmentId = input.id || id('adjustment'), date = nowDate(input.date)
    if (input.quantityDelta < 0) {
      const amount = -input.quantityDelta
      const allocations = consumeFifo(db, control, item.id, amount, 'adjustment', 'adjustment', adjustmentId, actorId(options), date)
      audit(db, control, options, 'inventory.adjust', 'adjustment', adjustmentId, { quantityDelta: input.quantityDelta })
      return { id: adjustmentId, costMinor: allocations.reduce((n, a) => n + a.cost, 0) }
    }
    assertNonnegativeInt(input.costMinor || 0, 'costMinor')
    const lotId = input.lotId || id('lot')
    write(db, control, 'adjustment.lot', 'INSERT INTO stock_lots (id,item_id,source_type,source_id,lot_code,qty_initial_base,qty_remaining_base,cost_total_minor,cost_remaining_minor,received_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [lotId, item.id, 'adjustment', adjustmentId, input.lotCode || adjustmentId, input.quantityDelta, input.quantityDelta, input.costMinor || 0, input.costMinor || 0, date])
    const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [item.id]).quantity_base
    write(db, control, 'adjustment.movement', 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id('movement'), item.id, lotId, 'adjustment', input.quantityDelta, balance, input.costMinor || 0, 'adjustment', adjustmentId, date, actorId(options)])
    audit(db, control, options, 'inventory.adjust', 'adjustment', adjustmentId, { quantityDelta: input.quantityDelta, costMinor: input.costMinor || 0 })
    return { id: adjustmentId, lotId }
  })
  return { ...result.result, steps: result.steps }
}

function createOpeningStock(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (contextOf(options).role !== 'owner') throw new Error('Only an owner can create opening stock')
    const item = requiredRow(one(db, 'SELECT id FROM items WHERE id=? AND is_active=1', [input.itemId]), 'Active item not found')
    assertPositiveInt(input.quantity, 'quantity')
    assertNonnegativeInt(input.costMinor, 'costMinor')
    if (one(db, "SELECT id FROM stock_movements WHERE item_id=? AND movement_type='opening' LIMIT 1", [item.id])) throw new Error('Opening stock already exists for this item; use a correction entry')
    const openingId = input.id || id('opening-stock'), lotId = input.lotId || id('lot'), date = nowDate(input.date)
    write(db, control, 'opening-stock.lot', 'INSERT INTO stock_lots (id,item_id,source_type,source_id,lot_code,qty_initial_base,qty_remaining_base,cost_total_minor,cost_remaining_minor,received_at,expiry_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [lotId,item.id,'opening',openingId,input.lotCode || openingId,input.quantity,input.quantity,input.costMinor,input.costMinor,date,input.expiryDate || null])
    const balance = one(db, 'SELECT quantity_base FROM v_stock_balance WHERE item_id=?', [item.id]).quantity_base
    write(db, control, 'opening-stock.movement', 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id('movement'),item.id,lotId,'opening',input.quantity,balance,input.costMinor,'opening',openingId,date,actorId(options),input.notes || 'رصيد افتتاحي'])
    audit(db, control, options, 'inventory.opening', 'stock-lot', lotId, { itemId: item.id, quantity: input.quantity, costMinor: input.costMinor })
    return { id: openingId, lotId }
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

function savePurchaseDraft(db, input, options = {}) {
  const result = atomic(db, options, control => {
    requiredRow(one(db, 'SELECT id FROM suppliers WHERE id=? AND is_active=1', [input.supplierId]), 'Active supplier not found')
    requiredRow(one(db, 'SELECT id FROM items WHERE id=? AND is_active=1 AND type<>'+'\'finished\'', [input.itemId]), 'Active raw or packaging item not found')
    assertPositiveInt(input.quantity, 'quantity')
    for (const [key, value] of Object.entries({ unitPriceMinor: input.unitPriceMinor, extraCostsMinor: input.extraCostsMinor || 0, paidMinor: input.paidMinor || 0 })) assertNonnegativeInt(value, key)
    const total = input.quantity * input.unitPriceMinor + (input.extraCostsMinor || 0)
    if (!Number.isSafeInteger(total) || (input.paidMinor || 0) > total) throw new Error('Invalid draft total or paid amount')
    const draftId = input.id || id('purchase-draft'), date = nowDate(input.date)
    const existing = one(db, 'SELECT * FROM purchase_drafts WHERE id=?', [draftId])
    if (existing) {
      write(db, control, 'purchase-draft.update', 'UPDATE purchase_drafts SET number=?,supplier_id=?,item_id=?,date=?,quantity_base=?,unit_price_minor=?,extra_costs_minor=?,paid_amount_minor=?,supplier_invoice_number=?,due_date=? WHERE id=?', [input.number || existing.number, input.supplierId, input.itemId, date, input.quantity, input.unitPriceMinor, input.extraCostsMinor || 0, input.paidMinor || 0, input.supplierInvoiceNumber || null, input.dueDate || null, draftId])
    } else {
      write(db, control, 'purchase-draft.create', 'INSERT INTO purchase_drafts (id,number,supplier_id,item_id,date,quantity_base,unit_price_minor,extra_costs_minor,paid_amount_minor,supplier_invoice_number,due_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [draftId, input.number, input.supplierId, input.itemId, date, input.quantity, input.unitPriceMinor, input.extraCostsMinor || 0, input.paidMinor || 0, input.supplierInvoiceNumber || null, input.dueDate || null, date])
    }
    audit(db, control, options, existing ? 'purchase-draft.update' : 'purchase-draft.create', 'purchase-draft', draftId, { number: input.number, totalMinor: total })
    return { id: draftId, totalMinor: total }
  })
  return { ...result.result, steps: result.steps }
}

function deletePurchaseDraft(db, input, options = {}) {
  const result = atomic(db, options, control => {
    requiredRow(one(db, 'SELECT id FROM purchase_drafts WHERE id=?', [input.id]), 'Purchase draft not found')
    write(db, control, 'purchase-draft.delete', 'DELETE FROM purchase_drafts WHERE id=?', [input.id])
    audit(db, control, options, 'purchase-draft.delete', 'purchase-draft', input.id, null)
    return { id: input.id }
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

function updateReminder(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const reminder = requiredRow(one(db, 'SELECT * FROM reminders WHERE id=?', [input.id]), 'Reminder not found')
    if (!['sent', 'skipped', 'postponed'].includes(input.action)) throw new Error('Unsupported reminder action')
    const sale = requiredRow(one(db, 'SELECT * FROM sales_orders WHERE id=?', [reminder.sales_order_id]), 'Reminder sale not found')
    const outstanding = sale.total_minor - sale.paid_amount_minor - one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns x ON x.id=rl.return_id WHERE x.return_type='sales' AND x.sales_order_id=?", [sale.id]).amount
    if (input.action !== 'skipped' && outstanding <= 0) throw new Error('Settled invoices cannot have active reminders')
    if (input.action === 'postponed') {
      if (!input.scheduledFor) throw new Error('scheduledFor is required')
      if (one(db, "SELECT id FROM reminders WHERE sales_order_id=? AND stage=? AND status='pending' AND id<>?", [sale.id, reminder.stage, reminder.id])) throw new Error('Another pending reminder already exists for this invoice stage')
      write(db, control, 'reminder.postpone', "UPDATE reminders SET scheduled_for=?,status='pending' WHERE id=?", [input.scheduledFor, reminder.id])
    } else if (input.action === 'skipped') {
      write(db, control, 'reminder.skip', "UPDATE reminders SET status='skipped' WHERE id=?", [reminder.id])
    } else {
      if (!input.renderedBody) throw new Error('renderedBody is required when sending a reminder')
      write(db, control, 'reminder.sent', "UPDATE reminders SET status='sent',sent_at=? WHERE id=?", [nowDate(input.date), reminder.id])
      write(db, control, 'reminder.message-log', 'INSERT INTO message_log (id,reminder_id,customer_id,to_phone,rendered_body,provider,status,created_at) VALUES (?,?,?,?,?,?,?,?)', [input.messageLogId || id('message'), reminder.id, reminder.customer_id, input.toPhone || null, input.renderedBody, input.provider || 'whatsapp-link', 'sent', nowDate(input.date)])
    }
    audit(db, control, options, `reminder.${input.action}`, 'reminder', reminder.id, { scheduledFor: input.scheduledFor || null })
    return { id: reminder.id, action: input.action }
  })
  return { ...result.result, steps: result.steps }
}

function saveCustomer(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.name?.trim()) throw new Error('Customer name is required')
    if (['balance', 'balanceMinor'].some(key => Object.hasOwn(input, key))) throw new Error('Customer balance must use an opening entry or audited correction')
    const ctx = contextOf(options)
    const existing = input.id ? one(db, 'SELECT * FROM customers WHERE id=?', [input.id]) : null
    const elevated = Boolean(elevationFor(options, 'customer-credit'))
    if (ctx.role !== 'owner' && !elevated && ['creditLimitMinor', 'creditDays', 'isBlocked', 'blockReason'].some(key => Object.hasOwn(input, key))) throw new Error('Customer credit fields require owner permission')
    for (const [key, value] of Object.entries({ creditLimitMinor: input.creditLimitMinor ?? existing?.credit_limit_minor ?? 0, creditDays: input.creditDays ?? existing?.credit_days ?? 0 })) assertNonnegativeInt(value, key)
    const customerId = input.id || id('customer'), date = nowDate(input.date)
    const exists = one(db, 'SELECT id FROM customers WHERE id=?', [customerId])
    const opening = input.openingBalanceMinor
    if (opening !== undefined) assertNonnegativeInt(opening, 'openingBalanceMinor')
    if (opening !== undefined && ctx.role !== 'owner') throw new Error('Only an owner can write an opening customer balance')
    if (exists) write(db, control, 'customer.update', 'UPDATE customers SET name=?,phone=?,whatsapp=?,credit_limit_minor=?,credit_days=?,is_blocked=?,block_reason=?,reminder_enabled=?,notes=?,is_active=?,updated_at=? WHERE id=?', [input.name.trim(), input.phone || '', input.whatsapp || '', input.creditLimitMinor ?? existing.credit_limit_minor, input.creditDays ?? existing.credit_days, input.isBlocked === undefined ? existing.is_blocked : input.isBlocked ? 1 : 0, input.blockReason === undefined ? existing.block_reason : input.blockReason || null, input.reminderEnabled === false ? 0 : 1, input.notes || null, input.isActive === false ? 0 : 1, date, customerId])
    else write(db, control, 'customer.create', 'INSERT INTO customers (id,name,phone,whatsapp,credit_limit_minor,credit_days,is_blocked,block_reason,reminder_enabled,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [customerId, input.name.trim(), input.phone || '', input.whatsapp || '', input.creditLimitMinor || 0, input.creditDays || 0, input.isBlocked ? 1 : 0, input.blockReason || null, input.reminderEnabled === false ? 0 : 1, input.notes || null, input.isActive === false ? 0 : 1, date, date])
    if (!exists && opening > 0) write(db, control, 'customer.opening-balance', 'INSERT INTO customer_opening_balances (id,customer_id,balance_delta_minor,effective_date,due_date,is_opening,notes) VALUES (?,?,?,?,?,1,?)', [id('opening'), customerId, opening, date, input.openingDueDate || null, input.openingNotes || 'رصيد افتتاحي'])
    if (exists && opening !== undefined) {
      if (ctx.role !== 'owner') throw new Error('Only an owner can correct an opening balance')
      const previousOpening = one(db, 'SELECT COALESCE(SUM(balance_delta_minor),0) AS value FROM customer_opening_balances WHERE customer_id=?', [customerId]).value
      const delta = opening - previousOpening
      if (delta) {
        if (!input.openingCorrectionReason?.trim()) throw new Error('An audited correction reason is required')
        write(db, control, 'customer.balance-correction', 'INSERT INTO customer_balance_adjustments (id,customer_id,balance_delta_minor,effective_date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?)', [id('balance-correction'), customerId, delta, date, input.openingCorrectionReason.trim(), ctx.userId, new Date().toISOString()])
        audit(db, control, options, 'customer.balance-correction', 'customer', customerId, { deltaMinor: delta, reason: input.openingCorrectionReason.trim() })
      }
    }
    audit(db, control, options, exists ? 'customer.update' : 'customer.create', 'customer', customerId, { name: input.name.trim(), isActive: input.isActive !== false })
    return { id: customerId }
  })
  return { ...result.result, steps: result.steps }
}

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

function saveItem(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (['unitCost', 'unitCostMinor', 'unit_cost_minor', 'cost', 'costMinor', 'stock', 'stockBase', 'stock_base', 'initialStock', 'openingStock', 'stockBalance', 'quantity', 'quantityBase'].some(key => Object.hasOwn(input, key))) throw new Error('Item cost and stock must be recorded through inventory operations')
    if (!input.name?.trim() || !input.sku?.trim()) throw new Error('Item name and SKU are required')
    if (!['raw','packaging','finished'].includes(input.type)) throw new Error('Unsupported item type')
    // The UI sends a display unit label (كجم/جرام/لتر/مل/قطعة/عبوة); the item
    // is stored against its canonical base unit and remembers the display
    // unit in legacy_unit_id for presentation.
    let baseUnitId = input.baseUnitId
    let legacyUnitId = input.legacyUnitId || null
    if (input.unitLabel) {
      const info = unitInfo(input.unitLabel)
      baseUnitId = info.baseUnitId
      legacyUnitId = info.legacyId
    }
    requiredRow(one(db, 'SELECT id FROM units WHERE id=?', [baseUnitId]), 'Base unit not found')
    if (legacyUnitId) requiredRow(one(db, 'SELECT id FROM units WHERE id=?', [legacyUnitId]), 'Display unit not found')
    input = { ...input, baseUnitId }
    if (contextOf(options).role !== 'owner' && input.defaultSalePriceMinor !== undefined) throw new Error('Default sale price can only be changed by the owner')
    assertNonnegativeInt(input.defaultSalePriceMinor || 0, 'defaultSalePriceMinor')
    assertNonnegativeInt(input.minStockBase || 0, 'minStockBase')
    if (input.packSizeBase != null) assertPositiveInt(input.packSizeBase, 'packSizeBase')
    const itemId = input.id || id('item'), date = nowDate(input.date)
    const exists = one(db, 'SELECT id FROM items WHERE id=?', [itemId])
    if (exists) {
      const previous = one(db, 'SELECT type,base_unit_id FROM items WHERE id=?', [itemId])
      const hasHistory = Boolean(one(db, 'SELECT 1 AS found FROM stock_movements WHERE item_id=? LIMIT 1', [itemId]))
      if (hasHistory && (previous.type !== input.type || previous.base_unit_id !== input.baseUnitId)) throw new Error('Item type or base unit cannot change after stock movements exist')
    }
    if (exists) write(db, control, 'item.update', 'UPDATE items SET sku=?,barcode=?,name=?,type=?,category_id=?,base_unit_id=?,legacy_unit_id=COALESCE(?,legacy_unit_id),pack_size_base=?,min_stock_base=?,default_sale_price_minor=?,is_active=?,updated_at=? WHERE id=?', [input.sku.trim(), input.barcode || null, input.name.trim(), input.type, input.categoryId || null, input.baseUnitId, legacyUnitId, input.packSizeBase ?? null, input.minStockBase || 0, input.defaultSalePriceMinor || 0, input.isActive === false ? 0 : 1, date, itemId])
    else write(db, control, 'item.create', 'INSERT INTO items (id,sku,barcode,name,type,category_id,base_unit_id,legacy_unit_id,pack_size_base,min_stock_base,default_sale_price_minor,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [itemId, input.sku.trim(), input.barcode || null, input.name.trim(), input.type, input.categoryId || null, input.baseUnitId, legacyUnitId, input.packSizeBase ?? null, input.minStockBase || 0, input.defaultSalePriceMinor || 0, input.isActive === false ? 0 : 1, date, date])
    audit(db, control, options, exists ? 'item.update' : 'item.create', 'item', itemId, { sku: input.sku.trim(), name: input.name.trim(), type: input.type, isActive: input.isActive !== false })
    return { id: itemId }
  })
  return { ...result.result, steps: result.steps }
}

function saveRecipe(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const finished = requiredRow(one(db, "SELECT id FROM items WHERE id=? AND type='finished'", [input.finishedItemId]), 'Finished item not found')
    if (!Array.isArray(input.lines) || !input.lines.length) throw new Error('Recipe requires at least one component')
    const componentIds = new Set()
    for (const line of input.lines) {
      const component = requiredRow(one(db, 'SELECT type FROM items WHERE id=? AND is_active=1', [line.componentItemId]), 'Active recipe component not found')
      if (componentIds.has(line.componentItemId) || !['raw','packaging'].includes(component.type)) throw new Error('Recipe components must be unique raw or packaging items')
      componentIds.add(line.componentItemId); assertPositiveInt(line.quantityPerUnitBase, 'quantityPerUnitBase'); assertNonnegativeInt(line.extraCostMinor || 0, 'extraCostMinor')
      if (line.lineType && line.lineType !== component.type) throw new Error('Recipe line type does not match component type')
    }
    write(db, control, 'recipe.deactivate-old', 'UPDATE item_recipe_lines SET is_active=0 WHERE finished_item_id=? AND is_active=1', [finished.id])
    for (const line of input.lines) {
      const prior = one(db, 'SELECT id FROM item_recipe_lines WHERE finished_item_id=? AND component_item_id=?', [finished.id, line.componentItemId])
      const type = one(db, 'SELECT type FROM items WHERE id=?', [line.componentItemId]).type
      if (prior) write(db, control, `recipe.update:${line.componentItemId}`, 'UPDATE item_recipe_lines SET qty_per_unit_base=?,line_type=?,extra_cost_minor=?,is_active=1 WHERE id=?', [line.quantityPerUnitBase, type, line.extraCostMinor || 0, prior.id])
      else write(db, control, `recipe.create:${line.componentItemId}`, 'INSERT INTO item_recipe_lines (id,finished_item_id,component_item_id,qty_per_unit_base,line_type,extra_cost_minor,is_active) VALUES (?,?,?,?,?,?,1)', [id('recipe'), finished.id, line.componentItemId, line.quantityPerUnitBase, type, line.extraCostMinor || 0])
    }
    audit(db, control, options, 'recipe.update', 'item', finished.id, { componentCount: input.lines.length })
    return { id: finished.id, componentCount: input.lines.length }
  })
  return { ...result.result, steps: result.steps }
}

function saveUser(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.username?.trim() || !input.displayName?.trim()) throw new Error('Username and display name are required')
    if (!['owner','sales','warehouse','purchasing'].includes(input.role)) throw new Error('Unsupported user role')
    const ctx = contextOf(options)
    if (ctx.role !== 'owner') throw new Error('Only an owner can manage users')
    if (Object.hasOwn(input, 'passwordHash') || Object.hasOwn(input, 'pinHash')) throw new Error('Hashes must never be accepted from the renderer')
    const userId = input.id || id('user'), date = nowDate(input.date)
    const prior = one(db, 'SELECT * FROM users WHERE id=?', [userId])
    if (prior?.id === ctx.userId && (input.isActive === false || input.role !== ctx.role)) throw new Error('An owner cannot deactivate or demote their own account')
    if (prior?.role === 'owner' && (input.role !== 'owner' || input.isActive === false) && one(db, "SELECT COUNT(*) AS n FROM users WHERE role='owner' AND is_active=1", []).n <= 1) throw new Error('The last active owner cannot be deactivated or demoted')
    const bcrypt = require('bcryptjs')
    if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 200)) throw new Error('Password must contain 10 to 200 characters')
    const passwordHash = input.password ? bcrypt.hashSync(input.password, 12) : prior?.password_hash
    if (!passwordHash) throw new Error('Raw password is required for a new user')
    let pinHash = prior?.pin_hash || null
    if (input.pin !== undefined) {
      if (typeof input.pin !== 'string' || !/^\d{4,8}$/.test(input.pin)) throw new Error('PIN must contain 4 to 8 digits')
      if (prior) {
        const actor = one(db, 'SELECT pin_hash FROM users WHERE id=?', [ctx.userId])
        if (!input.currentPin || !actor?.pin_hash || !bcrypt.compareSync(input.currentPin, actor.pin_hash)) throw new Error('Current PIN is required to change PIN')
      }
      pinHash = bcrypt.hashSync(input.pin, 12)
    }
    if (prior) write(db, control, 'user.update', 'UPDATE users SET username=?,display_name=?,role=?,password_hash=?,pin_hash=?,is_active=?,updated_at=? WHERE id=?', [input.username.trim(), input.displayName.trim(), input.role, passwordHash, pinHash, input.isActive === false ? 0 : 1, date, userId])
    else write(db, control, 'user.create', 'INSERT INTO users (id,username,display_name,role,password_hash,pin_hash,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [userId, input.username.trim(), input.displayName.trim(), input.role, passwordHash, pinHash, input.isActive === false ? 0 : 1, date, date])
    audit(db, control, options, prior ? 'user.update' : 'user.create', 'user', userId, { username: input.username.trim(), role: input.role, passwordChanged: Boolean(input.password), pinChanged: input.pin !== undefined })
    return { id: userId }
  })
  return { ...result.result, steps: result.steps }
}

function saveSetting(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (contextOf(options).role !== 'owner') throw new Error('Only an owner can change settings')
    if (!input.key?.trim()) throw new Error('Setting key is required')
    if (input.value === undefined) throw new Error('Setting value is required')
    const key = input.key.trim(), value = JSON.stringify(input.value)
    const { z } = require('zod')
    const settingSchemas = {
      company_name: z.string().min(1).max(160),
      company_phone: z.string().max(40),
      currency: z.literal('EGP'),
      costing_method: z.enum(['FIFO', 'WAVG']),
      default_credit_days: z.number().int().min(0).max(3650)
    }
    if (!settingSchemas[key] || !settingSchemas[key].safeParse(input.value).success) throw new Error('Setting key or value is not allowed')
    write(db, control, 'setting.upsert', 'INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at', [key, value, new Date().toISOString()])
    audit(db, control, options, 'settings.update', 'setting', key, { sensitive: /password|pin|secret|token/i.test(key) })
    return { key }
  })
  return { ...result.result, steps: result.steps }
}

function saveReminderTemplate(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.name?.trim() || !input.body?.trim() || !input.stage?.trim()) throw new Error('Template name, body and stage are required')
    const templateId = input.id || id('template')
    write(db, control, 'template.upsert', 'INSERT INTO message_templates (id,name,channel,body,stage) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,channel=excluded.channel,body=excluded.body,stage=excluded.stage', [templateId, input.name.trim(), input.channel || 'whatsapp', input.body, input.stage.trim()])
    audit(db, control, options, 'reminder-template.save', 'message-template', templateId, { name: input.name.trim(), stage: input.stage.trim() })
    return { id: templateId }
  })
  return { ...result.result, steps: result.steps }
}

function saveReminderRule(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.name?.trim() || !Number.isSafeInteger(input.offsetDays)) throw new Error('Rule name and integer offset are required')
    if (input.templateId) requiredRow(one(db, 'SELECT id FROM message_templates WHERE id=?', [input.templateId]), 'Reminder template not found')
    if (input.customerId) requiredRow(one(db, 'SELECT id FROM customers WHERE id=?', [input.customerId]), 'Reminder customer not found')
    const ruleId = input.id || id('reminder-rule')
    write(db, control, 'reminder-rule.upsert', 'INSERT INTO reminder_rules (id,name,offset_days,template_id,is_active,customer_id) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,offset_days=excluded.offset_days,template_id=excluded.template_id,is_active=excluded.is_active,customer_id=excluded.customer_id', [ruleId, input.name.trim(), input.offsetDays, input.templateId || null, input.isActive === false ? 0 : 1, input.customerId || null])
    audit(db, control, options, 'reminder-rule.save', 'reminder-rule', ruleId, { name: input.name.trim(), offsetDays: input.offsetDays, isActive: input.isActive !== false })
    return { id: ruleId }
  })
  return { ...result.result, steps: result.steps }
}

function checkInvariants(db) {
  const issues = []
  const badLots = db.prepare(`SELECT id FROM stock_lots WHERE qty_remaining_base<0 OR qty_remaining_base>qty_initial_base OR cost_remaining_minor<0 OR cost_remaining_minor>cost_total_minor OR (qty_remaining_base=0 AND cost_remaining_minor<>0)`).all()
  for (const row of badLots) issues.push(`invalid lot ${row.id}`)
  const movementMismatch = db.prepare(`SELECT l.id FROM stock_lots l WHERE l.qty_remaining_base <> COALESCE((SELECT SUM(m.qty_base) FROM stock_movements m WHERE m.lot_id=l.id),0)`).all()
  for (const row of movementMismatch) issues.push(`lot movement mismatch ${row.id}`)
  const costMovementMismatch = db.prepare(`SELECT l.id FROM stock_lots l WHERE l.cost_remaining_minor <> COALESCE((SELECT SUM(CASE WHEN m.qty_base>0 THEN m.cost_minor ELSE -m.cost_minor END) FROM stock_movements m WHERE m.lot_id=l.id),0)`).all()
  for (const row of costMovementMismatch) issues.push(`lot cost movement mismatch ${row.id}`)
  const stockMismatch = db.prepare(`SELECT i.id FROM items i WHERE COALESCE((SELECT SUM(qty_remaining_base) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0) <> (SELECT quantity_base FROM v_stock_balance WHERE item_id=i.id)`).all()
  for (const row of stockMismatch) issues.push(`stock view mismatch ${row.id}`)
  const customerMismatch = db.prepare(`SELECT c.id FROM customers c WHERE
     COALESCE((SELECT SUM(balance_delta_minor) FROM customer_opening_balances o WHERE o.customer_id=c.id),0)
     + COALESCE((SELECT SUM(balance_delta_minor) FROM customer_balance_adjustments a WHERE a.customer_id=c.id),0)
    + COALESCE((SELECT SUM(gross_total_minor) FROM sales_orders s WHERE s.customer_id=c.id AND s.status<>'cancelled'),0)
    - COALESCE((SELECT SUM(amount_minor) FROM payments p WHERE p.customer_id=c.id AND p.reversed_of_id IS NULL),0)
    + COALESCE((SELECT SUM(amount_minor) FROM customer_refunds f WHERE f.customer_id=c.id),0)
    - COALESCE((SELECT SUM(value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN sales_orders s ON s.id=r.sales_order_id WHERE r.return_type='sales' AND s.customer_id=c.id AND s.status<>'cancelled'),0)
    <> (SELECT balance_minor FROM v_customer_balance WHERE customer_id=c.id)`).all()
  for (const row of customerMismatch) issues.push(`customer ledger mismatch ${row.id}`)
  const supplierMismatch = db.prepare(`SELECT s.id FROM suppliers s WHERE
     COALESCE((SELECT SUM(balance_delta_minor) FROM supplier_opening_balances o WHERE o.supplier_id=s.id),0)
      + COALESCE((SELECT SUM(balance_delta_minor) FROM supplier_balance_adjustments a WHERE a.supplier_id=s.id),0)
     + COALESCE((SELECT SUM(total_minor) FROM purchase_invoices p WHERE p.supplier_id=s.id AND p.status<>'cancelled'),0)
     - COALESCE((SELECT SUM(paid_amount_minor) FROM purchase_invoices p WHERE p.supplier_id=s.id AND p.status<>'cancelled'),0)
     - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.supplier_id=s.id AND p.reversed_of_id IS NULL AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id=p.id)),0)
     - COALESCE((SELECT SUM(value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN purchase_invoices p ON p.id=r.purchase_invoice_id WHERE r.return_type='purchase' AND p.supplier_id=s.id AND p.status<>'cancelled'),0)
    <> (SELECT balance_minor FROM v_supplier_balance WHERE supplier_id=s.id)`).all()
  for (const row of supplierMismatch) issues.push(`supplier ledger mismatch ${row.id}`)
  const allocations = db.prepare(`SELECT p.id,p.amount_minor,COALESCE(SUM(a.amount_minor),0) AS allocated,
      COALESCE(SUM(CASE WHEN a.doc_type='sales' THEN a.amount_minor ELSE 0 END),0) AS sales_allocated,
      COALESCE(SUM(CASE WHEN a.doc_type='purchase' THEN a.amount_minor ELSE 0 END),0) AS purchase_allocated
    FROM payments p LEFT JOIN payment_allocations a ON a.payment_id=p.id GROUP BY p.id
    HAVING allocated>p.amount_minor OR (p.party_type='customer' AND purchase_allocated>0) OR (p.party_type='supplier' AND sales_allocated>0)`).all()
  for (const row of allocations) issues.push(`payment allocation invalid ${row.id}`)
  const salePaymentMismatch = db.prepare(`SELECT s.id FROM sales_orders s WHERE
    s.initial_paid_amount_minor > s.paid_amount_minor OR s.paid_amount_minor > s.total_minor
    OR s.paid_amount_minor <> s.initial_paid_amount_minor + COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.sales_order_id=s.id AND a.is_initial=0),0)
    OR s.initial_paid_amount_minor <> COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.sales_order_id=s.id AND a.is_initial=1),0)
    OR (s.status NOT IN ('draft','cancelled') AND
      ((s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=s.id),0)<=0 AND s.status<>'paid')
      OR (s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=s.id),0)>0 AND s.paid_amount_minor=0 AND s.status NOT IN ('confirmed','overdue'))
      OR (s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=s.id),0)>0 AND s.paid_amount_minor>0 AND s.status NOT IN ('partial','overdue'))))`).all()
  for (const row of salePaymentMismatch) issues.push(`sale payment or status mismatch ${row.id}`)
  const purchasePaymentMismatch = db.prepare(`SELECT p.id FROM purchase_invoices p WHERE
    p.initial_paid_amount_minor > p.paid_amount_minor OR p.paid_amount_minor > p.total_minor
    OR p.paid_amount_minor <> p.initial_paid_amount_minor + COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_invoice_id=p.id AND a.is_initial=0),0)
    OR p.initial_paid_amount_minor <> COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_invoice_id=p.id AND a.is_initial=1),0)`).all()
  for (const row of purchasePaymentMismatch) issues.push(`purchase payment allocation mismatch ${row.id}`)
  const pendingPaidReminders = db.prepare(`SELECT r.id FROM reminders r JOIN sales_orders s ON s.id=r.sales_order_id WHERE r.status='pending'
    AND s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns x ON x.id=rl.return_id WHERE x.return_type='sales' AND x.sales_order_id=s.id),0)<=0`).all()
  for (const row of pendingPaidReminders) issues.push(`pending reminder for settled sale ${row.id}`)
  const duplicateReminders = db.prepare(`SELECT sales_order_id,stage FROM reminders GROUP BY sales_order_id,stage HAVING COUNT(*)>1`).all()
  for (const row of duplicateReminders) issues.push(`duplicate pending reminder ${row.sales_order_id}:${row.stage}`)
  const fk = db.pragma('foreign_key_check')
  for (const row of fk) issues.push(`orphan reference ${row.table}.${row.rowid}`)
  if (issues.length) throw new Error(`Invariant violations: ${issues.join('; ')}`)
  return { ok: true, issues: [], stockItemsChecked: one(db, 'SELECT COUNT(*) AS n FROM items', []).n, partiesChecked: one(db, 'SELECT (SELECT COUNT(*) FROM customers)+(SELECT COUNT(*) FROM suppliers) AS n', []).n }
}

module.exports = {
  adjustStock, cancelPacking, checkInvariants, confirmPacking, confirmPurchase, confirmSale, createOpeningStock, deletePurchaseDraft,
  outstandingOfSale, recordCollection, recordPromise, recordSupplierPayment, returnPurchase, returnSale, reversePayment, roundHalfUp,
  saveCustomer, saveItem, savePurchaseDraft, saveRecipe, saveReminderRule, saveReminderTemplate,
  saveSetting, saveSupplier, saveUser, settingValue, updateReminder, writeOffSale
}

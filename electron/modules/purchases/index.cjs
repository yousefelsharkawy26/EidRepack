const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')

function confirmPurchase(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const draft = input.draftId ? requiredRow(one(db, 'SELECT * FROM purchase_drafts WHERE id=?', [input.draftId]), 'Purchase draft not found') : null
    // The confirmation payload is authoritative: loaded drafts remain editable
    // until confirmed, and the draft is consumed atomically with the invoice.
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

function register(registry) {
  registry.defineCommand({ name: 'purchase:confirm', roles: ["owner","purchasing"], handler: confirmPurchase })
  registry.defineCommand({ name: 'purchase:return', roles: ["owner","purchasing"], handler: returnPurchase })
  registry.defineCommand({ name: 'purchase-draft:save', roles: ["owner","purchasing"], handler: savePurchaseDraft })
  registry.defineCommand({ name: 'purchase-draft:delete', roles: ["owner","purchasing"], handler: deletePurchaseDraft })
}

module.exports = { confirmPurchase, returnPurchase, savePurchaseDraft, deletePurchaseDraft, register }

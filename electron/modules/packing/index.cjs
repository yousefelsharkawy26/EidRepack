const contributeSnapshot = require('./snapshot.cjs')
const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')

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

function register(registry) {
  registry.defineCommand({ name: 'packing:confirm', roles: ["owner","warehouse"], handler: confirmPacking })
  registry.defineCommand({ name: 'packing:cancel', roles: ["owner"], handler: cancelPacking })
}

module.exports = { confirmPacking, cancelPacking, register, snapshot: contributeSnapshot }

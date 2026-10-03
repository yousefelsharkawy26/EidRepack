const { id } = require('./ids.cjs')
const { roundHalfUp } = require('./money.cjs')
const { one, requiredRow } = require('./db.cjs')
const { assertPositiveInt } = require('./validation.cjs')
const { write } = require('./tx.cjs')

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

module.exports = { availableLots, consumeFifo, consumeSpecificLots }

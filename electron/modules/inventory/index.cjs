const contributeSnapshot = require('./snapshot.cjs')
const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')
const { pageSchema } = require('../../core/query.cjs')
const { paginateQuery } = require('../../core/dispatcher.cjs')

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

function register(registry) {
  registry.defineCommand({ name: 'inventory:adjust', roles: ["owner","warehouse"], handler: adjustStock })
  registry.defineCommand({ name: 'inventory:opening', roles: ["owner"], handler: createOpeningStock })
  registry.defineCommand({ name: 'item:save', roles: ["owner","warehouse","purchasing"], handler: saveItem })
  registry.defineCommand({ name: 'recipe:save', roles: ["owner","warehouse"], handler: saveRecipe })
  registry.defineQuery({
    name: 'inventory:movements', roles: ['owner', 'warehouse', 'purchasing'], schema: pageSchema,
    handler: (db, ctx, page) => {
      const cost = ctx.role === 'owner' ? ', m.cost_minor' : ''
      const where = ctx.role === 'purchasing' ? " WHERE m.movement_type='purchase'" : ''
      const result = paginateQuery(db, `SELECT m.id,m.item_id,i.name AS item_name,m.lot_id,m.movement_type,m.qty_base,m.balance_after_base,m.ref_type,m.ref_id,m.notes,m.created_at${cost} FROM stock_movements m JOIN items i ON i.id=m.item_id${where} ORDER BY m.created_at DESC,m.rowid DESC`, [], page)
      const total = one(db, `SELECT COUNT(*) AS total FROM stock_movements m${where}`, []).total
      return { ...result, total }
    }
  })
}

module.exports = { adjustStock, createOpeningStock, saveItem, saveRecipe, register, snapshot: contributeSnapshot }

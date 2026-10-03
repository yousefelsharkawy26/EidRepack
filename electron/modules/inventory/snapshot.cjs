function contributeSnapshot({ db, ctx, localDateString, readSettings, unitFor, nextNumber, all, get, items, recipeLines, customers, customerOpenings, customerAdjustments, suppliers, supplierOpenings, sales, salesLines, linesBySale, purchases, purchaseLines, lineByPurchase, purchaseLots, lotByPurchase, returns, returnLines, linesByReturn, payments, allocations, allocationsByPayment, auditRows, users, userNames }) {
  return {
      items: items.map(item => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      type: item.type,
      unit: unitFor(item),
      stockBase: item.stock_base,
      minStockBase: item.min_stock_base,
      // Weighted average cost per BASE unit, from live lots.
      unitCostBaseMinor: item.stock_base > 0 ? Math.round(item.cost_base / item.stock_base) : 0,
      salePriceBaseMinor: item.default_sale_price_minor,
      isActive: Boolean(item.is_active),
      recipe: recipeLines
        .filter(line => line.finished_item_id === item.id)
        .map(line => ({ itemId: line.component_item_id, qtyPerUnitBase: line.qty_per_unit_base, kind: line.line_type }))
    })),
      lots: all(db, 'SELECT * FROM stock_lots ORDER BY received_at, rowid').map(lot => ({
      id: lot.id, itemId: lot.item_id, code: lot.lot_code,
      qtyBase: lot.qty_remaining_base, qtyInitialBase: lot.qty_initial_base,
      costTotalMinor: lot.cost_total_minor, costRemainingMinor: lot.cost_remaining_minor,
      receivedAt: lot.received_at, expiryDate: lot.expiry_date,
      source: lot.source_type, isActive: Boolean(lot.is_active)
    })),
      stockMovements: all(db, 'SELECT * FROM stock_movements ORDER BY created_at DESC, rowid DESC LIMIT 250').map(row => ({
      id: row.id, itemId: row.item_id, lotId: row.lot_id, type: row.movement_type,
      qtyBase: row.qty_base, balanceAfterBase: row.balance_after_base, costMinor: row.cost_minor,
      refType: row.ref_type, refId: row.ref_id, createdAt: row.created_at, notes: row.notes,
      createdBy: row.created_by ? userNames.get(row.created_by) || null : null
    })),
  }
}

module.exports = contributeSnapshot

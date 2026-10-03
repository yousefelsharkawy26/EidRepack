function contributeSnapshot({ db, ctx, localDateString, readSettings, unitFor, nextNumber, all, get, items, recipeLines, customers, customerOpenings, customerAdjustments, suppliers, supplierOpenings, sales, salesLines, linesBySale, purchases, purchaseLines, lineByPurchase, purchaseLots, lotByPurchase, returns, returnLines, linesByReturn, payments, allocations, allocationsByPayment, auditRows, users, userNames }) {
  return {
      packings: all(db, 'SELECT * FROM packing_orders ORDER BY date DESC, rowid DESC').map(order => ({
      id: order.id, number: order.number, date: order.date, itemId: order.finished_item_id,
      plannedUnits: order.planned_units, producedUnits: order.produced_units,
      wasteQtyBase: order.waste_qty_base, unitCostMinor: order.unit_cost_minor,
      status: order.status, notes: order.notes
    })),
  }
}

module.exports = contributeSnapshot

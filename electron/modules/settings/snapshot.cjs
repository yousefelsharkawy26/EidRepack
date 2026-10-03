function contributeSnapshot({ db, ctx, localDateString, readSettings, unitFor, nextNumber, all, get, items, recipeLines, customers, customerOpenings, customerAdjustments, suppliers, supplierOpenings, sales, salesLines, linesBySale, purchases, purchaseLines, lineByPurchase, purchaseLots, lotByPurchase, returns, returnLines, linesByReturn, payments, allocations, allocationsByPayment, auditRows, users, userNames }) {
  return {
      generatedAt: new Date().toISOString(),
      today: localDateString(new Date()),
      settings: readSettings(db),
      auditLog: ctx.role === 'owner' ? auditRows.map(row => ({
      id: row.id, at: row.created_at, userId: row.user_id,
      userName: row.user_id ? userNames.get(row.user_id) || null : null,
      action: row.action, entity: row.entity, entityId: row.entity_id
    })) : [],
      nextNumbers: {
      INV: nextNumber(db, 'INV', 'sales_orders'),
      PUR: nextNumber(db, 'PUR', 'purchase_invoices'),
      'D-PUR': nextNumber(db, 'D-PUR', 'purchase_drafts'),
      PCK: nextNumber(db, 'PCK', 'packing_orders'),
      RET: nextNumber(db, 'RET', 'returns', "WHERE return_type='sales'"),
      PRT: nextNumber(db, 'PRT', 'returns', "WHERE return_type='purchase'")
    }
  }
}

module.exports = contributeSnapshot

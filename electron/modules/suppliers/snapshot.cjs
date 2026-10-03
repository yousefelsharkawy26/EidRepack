function contributeSnapshot({ db, ctx, localDateString, readSettings, unitFor, nextNumber, all, get, items, recipeLines, customers, customerOpenings, customerAdjustments, suppliers, supplierOpenings, sales, salesLines, linesBySale, purchases, purchaseLines, lineByPurchase, purchaseLots, lotByPurchase, returns, returnLines, linesByReturn, payments, allocations, allocationsByPayment, auditRows, users, userNames }) {
  return {
      suppliers: suppliers.map(row => ({
      id: row.id, name: row.name, phone: row.phone, whatsapp: row.whatsapp,
      address: row.address, notes: row.notes, creditDays: row.default_credit_days,
      isActive: Boolean(row.is_active), balanceMinor: row.balance_minor
    })),
      supplierOpenings,
      purchases: purchases.map(purchase => {
      const line = lineByPurchase.get(purchase.id)
      return {
        id: purchase.id, number: purchase.number, supplierId: purchase.supplier_id, date: purchase.date,
        dueDate: purchase.due_date, status: purchase.status,
        totalMinor: purchase.total_minor, paidMinor: purchase.paid_amount_minor,
        extraCostsMinor: purchase.extra_costs_total_minor,
        supplierInvoiceNumber: purchase.supplier_invoice_number,
        itemId: line?.item_id || null, qtyBase: line?.qty_base || 0,
        landedCostTotalMinor: line?.landed_cost_total_minor ?? purchase.total_minor,
        lotId: lotByPurchase.get(purchase.id) || null
      }
    }),
      purchaseDrafts: all(db, 'SELECT * FROM purchase_drafts ORDER BY created_at DESC').map(draft => ({
      id: draft.id, number: draft.number, supplierId: draft.supplier_id, itemId: draft.item_id,
      date: draft.date, qtyBase: draft.quantity_base, unitPriceBaseMinor: draft.unit_price_minor,
      extraCostsMinor: draft.extra_costs_minor, paidMinor: draft.paid_amount_minor,
      supplierInvoiceNumber: draft.supplier_invoice_number, dueDate: draft.due_date
    })),
  }
}

module.exports = contributeSnapshot

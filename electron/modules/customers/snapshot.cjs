function contributeSnapshot({ db, ctx, localDateString, readSettings, unitFor, nextNumber, all, get, items, recipeLines, customers, customerOpenings, customerAdjustments, suppliers, supplierOpenings, sales, salesLines, linesBySale, purchases, purchaseLines, lineByPurchase, purchaseLots, lotByPurchase, returns, returnLines, linesByReturn, payments, allocations, allocationsByPayment, auditRows, users, userNames }) {
  return {
      customers: customers.map(row => ({
      id: row.id, name: row.name, phone: row.phone, whatsapp: row.whatsapp,
      creditLimitMinor: row.credit_limit_minor, creditDays: row.credit_days,
      isBlocked: Boolean(row.is_blocked), blockReason: row.block_reason,
      notes: row.notes, isActive: Boolean(row.is_active), balanceMinor: row.balance_minor
    })),
      customerOpenings, customerAdjustments,
  }
}

module.exports = contributeSnapshot

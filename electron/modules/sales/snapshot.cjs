function contributeSnapshot({ db, ctx, localDateString, readSettings, unitFor, nextNumber, all, get, items, recipeLines, customers, customerOpenings, customerAdjustments, suppliers, supplierOpenings, sales, salesLines, linesBySale, purchases, purchaseLines, lineByPurchase, purchaseLots, lotByPurchase, returns, returnLines, linesByReturn, payments, allocations, allocationsByPayment, auditRows, users, userNames }) {
  return {
      sales: sales.map(sale => ({
      id: sale.id, number: sale.number, customerId: sale.customer_id, date: sale.date,
      dueDate: sale.due_date, status: sale.status,
      totalMinor: sale.total_minor, paidMinor: sale.paid_amount_minor,
      creditOverrideBy: sale.credit_override_by ? userNames.get(sale.credit_override_by) || sale.credit_override_by : null,
      creditOverrideReason: sale.credit_override_reason,
      notes: sale.notes,
      lines: (linesBySale.get(sale.id) || []).map(line => ({
        id: line.id, itemId: line.item_id, qtyBase: line.qty_base,
        unitPriceBaseMinor: line.unit_price_minor, unitCostBaseMinor: line.unit_cost_minor,
        lineTotalMinor: line.line_total_minor, cogsTotalMinor: line.cogs_total_minor
      }))
    })),
      promises: all(db, 'SELECT * FROM promises_to_pay ORDER BY created_at DESC').map(row => ({
      id: row.id, saleId: row.sales_order_id, customerId: row.customer_id,
      promisedDate: row.promised_date, amountMinor: row.amount_minor,
      status: row.status, notes: row.notes
    })),
      payments: payments.map(row => ({
      id: row.id, partyType: row.party_type,
      customerId: row.customer_id, supplierId: row.supplier_id,
      direction: row.direction, amountMinor: row.amount_minor,
      method: row.method, date: row.date, reference: row.reference, notes: row.notes,
      isReversed: Boolean(row.reversed_of_id),
      allocations: (allocationsByPayment.get(row.id) || []).map(a => ({
        docType: a.doc_type, saleId: a.sales_order_id, purchaseId: a.purchase_invoice_id,
        amountMinor: a.amount_minor, isInitial: Boolean(a.is_initial)
      }))
    })),
      refunds: all(db, 'SELECT * FROM customer_refunds ORDER BY date DESC, rowid DESC').map(row => ({
      id: row.id, customerId: row.customer_id, saleId: row.sales_order_id,
      amountMinor: row.amount_minor, method: row.method, date: row.date, notes: row.notes
    })),
      returns: returns.map(row => ({
      id: row.id, number: row.number, type: row.return_type,
      saleId: row.sales_order_id, purchaseId: row.purchase_invoice_id,
      date: row.date, reason: row.reason,
      lines: (linesByReturn.get(row.id) || []).map(line => ({
        itemId: line.item_id, qtyBase: line.qty_base, valueMinor: line.value_minor, costMinor: line.cost_minor,
        originalSalesLineId: line.original_sales_line_id
      }))
    })),
  }
}

module.exports = contributeSnapshot

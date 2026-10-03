// Read-side of the backend: assembles the complete UI snapshot from the
// relational schema. All money stays in integer piasters (…Minor) and all
// quantities in integer base units (…Base); the renderer converts for display.
const { unitByLegacyId, unitInfo } = require('../units.cjs')

function localDateString(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function all(db, sql, params = []) { return db.prepare(sql).all(...params) }
function get(db, sql, params = []) { return db.prepare(sql).get(...params) }

function readSettings(db) {
  const out = {}
  for (const row of all(db, 'SELECT key,value FROM settings')) {
    try { out[row.key] = JSON.parse(row.value) } catch { /* ignore malformed */ }
  }
  return {
    companyName: out.company_name || 'مدير التعبئة للتجارة',
    companyPhone: out.company_phone || '',
    currency: out.currency || 'EGP',
    costingMethod: out.costing_method || 'FIFO',
    defaultCreditDays: Number.isInteger(out.default_credit_days) ? out.default_credit_days : 15
  }
}

function unitFor(item) {
  const known = item.legacy_unit_id ? unitByLegacyId(item.legacy_unit_id) : null
  if (known) return { label: known.label, factor: known.factor, baseUnitId: known.baseUnitId }
  // Items migrated from arbitrary legacy labels keep their free-text unit name.
  try {
    if (item.legacy_unit_name) {
      const info = unitInfo(item.legacy_unit_name)
      return { label: info.label, factor: info.factor, baseUnitId: info.baseUnitId }
    }
  } catch { /* unknown legacy label: fall through to count */ }
  return { label: item.legacy_unit_name || 'قطعة', factor: 1, baseUnitId: item.base_unit_id }
}

function nextNumber(db, prefix, table, where = '') {
  const head = `${prefix}-${new Date().getFullYear()}-`
  const rows = all(db, `SELECT number FROM ${table} ${where}`)
  let max = 0
  for (const row of rows) {
    if (!String(row.number).startsWith(head)) continue
    const sequence = parseInt(String(row.number).slice(head.length), 10)
    if (Number.isFinite(sequence)) max = Math.max(max, sequence)
  }
  return `${head}${String(max + 1).padStart(4, '0')}`
}

function buildSnapshot(db, ctx) {
  const items = all(db, `SELECT i.*, u.name AS legacy_unit_name,
      COALESCE((SELECT SUM(l.qty_remaining_base) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0) AS stock_base,
      COALESCE((SELECT SUM(l.cost_remaining_minor) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0) AS cost_base
    FROM items i LEFT JOIN units u ON u.id = i.legacy_unit_id ORDER BY i.created_at, i.rowid`)
  const recipeLines = all(db, 'SELECT id,finished_item_id,component_item_id,qty_per_unit_base,line_type FROM item_recipe_lines WHERE is_active=1')

  const customers = all(db, `SELECT c.*, COALESCE(b.balance_minor,0) AS balance_minor
    FROM customers c LEFT JOIN v_customer_balance b ON b.customer_id=c.id ORDER BY c.created_at, c.rowid`)
  const customerOpenings = all(db, 'SELECT id,customer_id,balance_delta_minor,effective_date,due_date,notes FROM customer_opening_balances')
  const customerAdjustments = all(db, 'SELECT id,customer_id,balance_delta_minor,effective_date,reason,created_at FROM customer_balance_adjustments')

  const suppliers = all(db, `SELECT s.*, COALESCE(b.balance_minor,0) AS balance_minor
    FROM suppliers s LEFT JOIN v_supplier_balance b ON b.supplier_id=s.id ORDER BY s.created_at, s.rowid`)
  const supplierOpenings = all(db, 'SELECT id,supplier_id,balance_delta_minor,effective_date,due_date,notes FROM supplier_opening_balances')

  const sales = all(db, "SELECT * FROM sales_orders WHERE status<>'draft' ORDER BY date DESC, rowid DESC")
  const salesLines = all(db, 'SELECT * FROM sales_lines ORDER BY rowid')
  const linesBySale = new Map()
  for (const line of salesLines) {
    if (!linesBySale.has(line.order_id)) linesBySale.set(line.order_id, [])
    linesBySale.get(line.order_id).push(line)
  }

  const purchases = all(db, "SELECT * FROM purchase_invoices WHERE status='confirmed' ORDER BY date DESC, rowid DESC")
  const purchaseLines = all(db, 'SELECT * FROM purchase_lines')
  const lineByPurchase = new Map(purchaseLines.map(line => [line.invoice_id, line]))
  const purchaseLots = all(db, "SELECT id,source_id FROM stock_lots WHERE source_type='purchase'")
  const lotByPurchase = new Map(purchaseLots.map(lot => [lot.source_id, lot.id]))

  const returns = all(db, 'SELECT * FROM returns ORDER BY date DESC, rowid DESC')
  const returnLines = all(db, 'SELECT * FROM return_lines')
  const linesByReturn = new Map()
  for (const line of returnLines) {
    if (!linesByReturn.has(line.return_id)) linesByReturn.set(line.return_id, [])
    linesByReturn.get(line.return_id).push(line)
  }

  const payments = all(db, 'SELECT * FROM payments ORDER BY date DESC, rowid DESC')
  const allocations = all(db, 'SELECT * FROM payment_allocations')
  const allocationsByPayment = new Map()
  for (const allocation of allocations) {
    if (!allocationsByPayment.has(allocation.payment_id)) allocationsByPayment.set(allocation.payment_id, [])
    allocationsByPayment.get(allocation.payment_id).push(allocation)
  }

  const auditRows = all(db, 'SELECT id,user_id,action,entity,entity_id,created_at FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT 250')
  const users = all(db, 'SELECT id,username,display_name,role,is_active,created_at FROM users ORDER BY created_at, rowid')
  const userNames = new Map(users.map(user => [user.id, user.display_name]))

  return {
    generatedAt: new Date().toISOString(),
    today: localDateString(new Date()),
    settings: readSettings(db),
    users,
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
    customers: customers.map(row => ({
      id: row.id, name: row.name, phone: row.phone, whatsapp: row.whatsapp,
      creditLimitMinor: row.credit_limit_minor, creditDays: row.credit_days,
      isBlocked: Boolean(row.is_blocked), blockReason: row.block_reason,
      notes: row.notes, isActive: Boolean(row.is_active), balanceMinor: row.balance_minor
    })),
    customerOpenings, customerAdjustments,
    suppliers: suppliers.map(row => ({
      id: row.id, name: row.name, phone: row.phone, whatsapp: row.whatsapp,
      address: row.address, notes: row.notes, creditDays: row.default_credit_days,
      isActive: Boolean(row.is_active), balanceMinor: row.balance_minor
    })),
    supplierOpenings,
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
    packings: all(db, 'SELECT * FROM packing_orders ORDER BY date DESC, rowid DESC').map(order => ({
      id: order.id, number: order.number, date: order.date, itemId: order.finished_item_id,
      plannedUnits: order.planned_units, producedUnits: order.produced_units,
      wasteQtyBase: order.waste_qty_base, unitCostMinor: order.unit_cost_minor,
      status: order.status, notes: order.notes
    })),
    lots: all(db, 'SELECT * FROM stock_lots ORDER BY received_at, rowid').map(lot => ({
      id: lot.id, itemId: lot.item_id, code: lot.lot_code,
      qtyBase: lot.qty_remaining_base, qtyInitialBase: lot.qty_initial_base,
      costTotalMinor: lot.cost_total_minor, costRemainingMinor: lot.cost_remaining_minor,
      receivedAt: lot.received_at, expiryDate: lot.expiry_date,
      source: lot.source_type, isActive: Boolean(lot.is_active)
    })),
    reminders: all(db, 'SELECT * FROM reminders ORDER BY scheduled_for, rowid').map(row => ({
      id: row.id, saleId: row.sales_order_id, customerId: row.customer_id,
      ruleId: row.rule_id, templateId: row.template_id, scheduledFor: row.scheduled_for,
      status: row.status, sentAt: row.sent_at, stage: row.stage
    })),
    reminderRules: all(db, 'SELECT * FROM reminder_rules ORDER BY offset_days').map(row => ({
      id: row.id, name: row.name, offsetDays: row.offset_days, stage: row.name,
      templateId: row.template_id, isActive: Boolean(row.is_active), customerId: row.customer_id
    })),
    messageTemplates: all(db, 'SELECT * FROM message_templates').map(row => ({
      id: row.id, name: row.name, stage: row.stage, body: row.body, channel: row.channel
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
    stockMovements: all(db, 'SELECT * FROM stock_movements ORDER BY created_at DESC, rowid DESC LIMIT 250').map(row => ({
      id: row.id, itemId: row.item_id, lotId: row.lot_id, type: row.movement_type,
      qtyBase: row.qty_base, balanceAfterBase: row.balance_after_base, costMinor: row.cost_minor,
      refType: row.ref_type, refId: row.ref_id, createdAt: row.created_at, notes: row.notes,
      createdBy: row.created_by ? userNames.get(row.created_by) || null : null
    })),
    messageLog: all(db, 'SELECT * FROM message_log ORDER BY created_at DESC, rowid DESC LIMIT 100').map(row => ({
      id: row.id, reminderId: row.reminder_id, customerId: row.customer_id,
      toPhone: row.to_phone, body: row.rendered_body, status: row.status, createdAt: row.created_at
    })),
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

module.exports = { buildSnapshot, localDateString, readSettings }

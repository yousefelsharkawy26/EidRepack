// Read-side of the backend: assembles the complete UI snapshot from the
// relational schema. All money stays in integer piasters (…Minor) and all
// quantities in integer base units (…Base); the renderer converts for display.
const { unitByLegacyId, unitInfo } = require('../units.cjs')
const { localDateString } = require('../core/dates.cjs')
const { snapshotContributors } = require('../modules/index.cjs')
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
      COALESCE((SELECT SUM(l.cost_remaining_minor) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0) AS cost_base,
      EXISTS(SELECT 1 FROM stock_movements m WHERE m.item_id=i.id) AS has_stock_movements
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

  const context = { db, ctx, localDateString, readSettings, unitFor, nextNumber, all, get, items, recipeLines, customers, customerOpenings, customerAdjustments, suppliers, supplierOpenings, sales, salesLines, linesBySale, purchases, purchaseLines, lineByPurchase, purchaseLots, lotByPurchase, returns, returnLines, linesByReturn, payments, allocations, allocationsByPayment, auditRows, users, userNames }
  return Object.assign({}, ...snapshotContributors.map(contributor => contributor(context)))
}

module.exports = { buildSnapshot, localDateString, readSettings }

const { z } = require('zod')
const { localDateString } = require('../../core/dates.cjs')

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T12:00:00`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')

const periodSchema = z.object({ from: dateSchema, to: dateSchema }).strict().superRefine((range, ctx) => {
  if (range.from > range.to) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Start date must not be after end date' })
  if (range.to > localDateString(new Date())) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Future dates are not allowed' })
})

function rows(db, sql, from, to) {
  return db.prepare(sql).all(from, to)
}

function nextLocalDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  const next = new Date(year, month - 1, day + 1)
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
}

function reportPeriod(db, _ctx, { from, to }) {
  const asOfDate = localDateString(new Date())
  const toExclusive = nextLocalDate(to)
  const sales = rows(db, `SELECT s.id,s.number,s.customer_id,c.name AS customer_name,s.date,s.status,s.subtotal_minor,s.discount_minor,s.tax_minor,s.total_minor,s.gross_total_minor,s.paid_amount_minor,s.due_date
    FROM sales_orders s JOIN customers c ON c.id=s.customer_id
    WHERE s.status NOT IN ('draft','cancelled') AND s.date>=? AND s.date<? ORDER BY s.date,s.rowid`, from, toExclusive)
  const salesLines = rows(db, `SELECT sl.order_id,sl.item_id,i.name AS item_name,i.sku,i.type,sl.qty_base,sl.line_total_minor,sl.cogs_total_minor
    FROM sales_lines sl JOIN sales_orders s ON s.id=sl.order_id JOIN items i ON i.id=sl.item_id
    WHERE s.status NOT IN ('draft','cancelled') AND s.date>=? AND s.date<? ORDER BY s.date,sl.rowid`, from, toExclusive)
  const salesReturns = rows(db, `SELECT r.id,r.number,r.date,r.sales_order_id,rl.item_id,rl.qty_base,rl.value_minor,rl.cost_minor
    FROM returns r JOIN return_lines rl ON rl.return_id=r.id
    WHERE r.return_type='sales' AND r.date>=? AND r.date<? ORDER BY r.date,r.rowid,rl.rowid`, from, toExclusive)
  const purchases = rows(db, `SELECT p.supplier_id,s.name AS supplier_name,COUNT(*) AS invoice_count,
      SUM(p.total_minor) AS total_minor,SUM(p.paid_amount_minor) AS paid_minor,
      SUM(MAX(0,p.total_minor-p.paid_amount_minor)) AS remaining_minor
    FROM purchase_invoices p JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.status='confirmed' AND p.date>=? AND p.date<? GROUP BY p.supplier_id,s.name ORDER BY s.name`, from, toExclusive)
  const collections = rows(db, `SELECT p.customer_id,c.name AS customer_name,SUM(p.amount_minor) AS amount_minor,COUNT(*) AS payment_count
    FROM payments p JOIN customers c ON c.id=p.customer_id
    WHERE p.party_type='customer' AND p.direction='in' AND p.date>=? AND p.date<?
      AND p.reversed_of_id IS NULL AND NOT EXISTS(SELECT 1 FROM payments reversal WHERE reversal.reversed_of_id=p.id)
    GROUP BY p.customer_id,c.name ORDER BY c.name`, from, toExclusive)
  const packings = rows(db, `SELECT p.id,p.number,p.date,p.finished_item_id,i.name AS item_name,p.produced_units,p.waste_qty_base,p.unit_cost_minor
    FROM packing_orders p JOIN items i ON i.id=p.finished_item_id
    WHERE p.status='confirmed' AND p.date>=? AND p.date<? ORDER BY p.date,p.rowid`, from, toExclusive)

  const inventory = db.prepare(`SELECT i.id,i.name,i.sku,i.type,i.min_stock_base,i.base_unit_id,u.symbol AS unit,
      COALESCE((SELECT SUM(l.qty_remaining_base) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0) AS stock_base,
      COALESCE((SELECT SUM(l.cost_remaining_minor) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0) AS stock_value_minor,
      CASE WHEN COALESCE((SELECT SUM(l.qty_remaining_base) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0)>0
        THEN CAST(COALESCE((SELECT SUM(l.cost_remaining_minor) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0) AS REAL) /
          (SELECT SUM(l.qty_remaining_base) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1) ELSE 0 END AS unit_cost_minor
    FROM items i JOIN units u ON u.id=i.base_unit_id WHERE i.is_active=1 ORDER BY i.name`).all()
  const customers = db.prepare(`SELECT c.id,c.name,COALESCE(b.balance_minor,0) AS balance_minor,
      COALESCE((SELECT SUM(MAX(0,s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=s.id),0)))
        FROM sales_orders s WHERE s.customer_id=c.id AND s.status NOT IN ('draft','cancelled') AND s.due_date IS NOT NULL AND s.due_date<?),0) AS overdue_minor,
      (SELECT MAX(p.date) FROM payments p WHERE p.customer_id=c.id AND p.reversed_of_id IS NULL AND NOT EXISTS(SELECT 1 FROM payments x WHERE x.reversed_of_id=p.id)) AS last_payment_date
    FROM customers c LEFT JOIN v_customer_balance b ON b.customer_id=c.id WHERE c.is_active=1 ORDER BY c.name`).all(asOfDate)
  const company = db.prepare("SELECT value FROM settings WHERE key='company_name'").get()
  const earliest = db.prepare(`SELECT MIN(date) AS date FROM (
    SELECT date FROM sales_orders WHERE status NOT IN ('draft','cancelled') UNION ALL
    SELECT date FROM purchase_invoices WHERE status='confirmed' UNION ALL
    SELECT date FROM returns UNION ALL SELECT date FROM packing_orders WHERE status='confirmed'
  )`).get()
  let companyName = 'مدير التعبئة للتجارة'
  try { companyName = company ? JSON.parse(company.value) : companyName } catch { /* retain default */ }

  return {
    from, to, today: asOfDate, earliestDate: earliest?.date || asOfDate, companyName,
    sales, salesLines, salesReturns, purchases, collections, packings, inventory, customers
  }
}

function register(registry) {
  registry.defineQuery({ name: 'reports:period', roles: ['owner'], schema: periodSchema, handler: reportPeriod })
}

module.exports = { periodSchema, reportPeriod, nextLocalDate, register }

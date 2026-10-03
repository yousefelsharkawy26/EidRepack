const { one } = require('./db.cjs')

function checkInvariants(db) {
  const issues = []
  const badLots = db.prepare(`SELECT id FROM stock_lots WHERE qty_remaining_base<0 OR qty_remaining_base>qty_initial_base OR cost_remaining_minor<0 OR cost_remaining_minor>cost_total_minor OR (qty_remaining_base=0 AND cost_remaining_minor<>0)`).all()
  for (const row of badLots) issues.push(`invalid lot ${row.id}`)
  const movementMismatch = db.prepare(`SELECT l.id FROM stock_lots l WHERE l.qty_remaining_base <> COALESCE((SELECT SUM(m.qty_base) FROM stock_movements m WHERE m.lot_id=l.id),0)`).all()
  for (const row of movementMismatch) issues.push(`lot movement mismatch ${row.id}`)
  const costMovementMismatch = db.prepare(`SELECT l.id FROM stock_lots l WHERE l.cost_remaining_minor <> COALESCE((SELECT SUM(CASE WHEN m.qty_base>0 THEN m.cost_minor ELSE -m.cost_minor END) FROM stock_movements m WHERE m.lot_id=l.id),0)`).all()
  for (const row of costMovementMismatch) issues.push(`lot cost movement mismatch ${row.id}`)
  const stockMismatch = db.prepare(`SELECT i.id FROM items i WHERE COALESCE((SELECT SUM(qty_remaining_base) FROM stock_lots l WHERE l.item_id=i.id AND l.is_active=1),0) <> (SELECT quantity_base FROM v_stock_balance WHERE item_id=i.id)`).all()
  for (const row of stockMismatch) issues.push(`stock view mismatch ${row.id}`)
  const customerMismatch = db.prepare(`SELECT c.id FROM customers c WHERE
     COALESCE((SELECT SUM(balance_delta_minor) FROM customer_opening_balances o WHERE o.customer_id=c.id),0)
     + COALESCE((SELECT SUM(balance_delta_minor) FROM customer_balance_adjustments a WHERE a.customer_id=c.id),0)
    + COALESCE((SELECT SUM(gross_total_minor) FROM sales_orders s WHERE s.customer_id=c.id AND s.status<>'cancelled'),0)
    - COALESCE((SELECT SUM(amount_minor) FROM payments p WHERE p.customer_id=c.id AND p.reversed_of_id IS NULL),0)
    + COALESCE((SELECT SUM(amount_minor) FROM customer_refunds f WHERE f.customer_id=c.id),0)
    - COALESCE((SELECT SUM(value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN sales_orders s ON s.id=r.sales_order_id WHERE r.return_type='sales' AND s.customer_id=c.id AND s.status<>'cancelled'),0)
    <> (SELECT balance_minor FROM v_customer_balance WHERE customer_id=c.id)`).all()
  for (const row of customerMismatch) issues.push(`customer ledger mismatch ${row.id}`)
  const supplierMismatch = db.prepare(`SELECT s.id FROM suppliers s WHERE
     COALESCE((SELECT SUM(balance_delta_minor) FROM supplier_opening_balances o WHERE o.supplier_id=s.id),0)
      + COALESCE((SELECT SUM(balance_delta_minor) FROM supplier_balance_adjustments a WHERE a.supplier_id=s.id),0)
     + COALESCE((SELECT SUM(total_minor) FROM purchase_invoices p WHERE p.supplier_id=s.id AND p.status<>'cancelled'),0)
     - COALESCE((SELECT SUM(paid_amount_minor) FROM purchase_invoices p WHERE p.supplier_id=s.id AND p.status<>'cancelled'),0)
     - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.supplier_id=s.id AND p.reversed_of_id IS NULL AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id=p.id)),0)
     - COALESCE((SELECT SUM(value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id JOIN purchase_invoices p ON p.id=r.purchase_invoice_id WHERE r.return_type='purchase' AND p.supplier_id=s.id AND p.status<>'cancelled'),0)
    <> (SELECT balance_minor FROM v_supplier_balance WHERE supplier_id=s.id)`).all()
  for (const row of supplierMismatch) issues.push(`supplier ledger mismatch ${row.id}`)
  const allocations = db.prepare(`SELECT p.id,p.amount_minor,COALESCE(SUM(a.amount_minor),0) AS allocated,
      COALESCE(SUM(CASE WHEN a.doc_type='sales' THEN a.amount_minor ELSE 0 END),0) AS sales_allocated,
      COALESCE(SUM(CASE WHEN a.doc_type='purchase' THEN a.amount_minor ELSE 0 END),0) AS purchase_allocated
    FROM payments p LEFT JOIN payment_allocations a ON a.payment_id=p.id GROUP BY p.id
    HAVING allocated>p.amount_minor OR (p.party_type='customer' AND purchase_allocated>0) OR (p.party_type='supplier' AND sales_allocated>0)`).all()
  for (const row of allocations) issues.push(`payment allocation invalid ${row.id}`)
  const salePaymentMismatch = db.prepare(`SELECT s.id FROM sales_orders s WHERE
    s.initial_paid_amount_minor > s.paid_amount_minor OR s.paid_amount_minor > s.total_minor
    OR s.paid_amount_minor <> s.initial_paid_amount_minor + COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.sales_order_id=s.id AND a.is_initial=0),0)
    OR s.initial_paid_amount_minor <> COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.sales_order_id=s.id AND a.is_initial=1),0)
    OR (s.status NOT IN ('draft','cancelled') AND
      ((s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=s.id),0)<=0 AND s.status<>'paid')
      OR (s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=s.id),0)>0 AND s.paid_amount_minor=0 AND s.status NOT IN ('confirmed','overdue'))
      OR (s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND r.sales_order_id=s.id),0)>0 AND s.paid_amount_minor>0 AND s.status NOT IN ('partial','overdue'))))`).all()
  for (const row of salePaymentMismatch) issues.push(`sale payment or status mismatch ${row.id}`)
  const purchasePaymentMismatch = db.prepare(`SELECT p.id FROM purchase_invoices p WHERE
    p.initial_paid_amount_minor > p.paid_amount_minor OR p.paid_amount_minor > p.total_minor
    OR p.paid_amount_minor <> p.initial_paid_amount_minor + COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_invoice_id=p.id AND a.is_initial=0),0)
    OR p.initial_paid_amount_minor <> COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_invoice_id=p.id AND a.is_initial=1),0)`).all()
  for (const row of purchasePaymentMismatch) issues.push(`purchase payment allocation mismatch ${row.id}`)
  const pendingPaidReminders = db.prepare(`SELECT r.id FROM reminders r JOIN sales_orders s ON s.id=r.sales_order_id WHERE r.status='pending'
    AND s.total_minor-s.paid_amount_minor-COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns x ON x.id=rl.return_id WHERE x.return_type='sales' AND x.sales_order_id=s.id),0)<=0`).all()
  for (const row of pendingPaidReminders) issues.push(`pending reminder for settled sale ${row.id}`)
  const duplicateReminders = db.prepare(`SELECT sales_order_id,stage FROM reminders GROUP BY sales_order_id,stage HAVING COUNT(*)>1`).all()
  for (const row of duplicateReminders) issues.push(`duplicate pending reminder ${row.sales_order_id}:${row.stage}`)
  const fk = db.pragma('foreign_key_check')
  for (const row of fk) issues.push(`orphan reference ${row.table}.${row.rowid}`)
  if (issues.length) throw new Error(`Invariant violations: ${issues.join('; ')}`)
  return { ok: true, issues: [], stockItemsChecked: one(db, 'SELECT COUNT(*) AS n FROM items', []).n, partiesChecked: one(db, 'SELECT (SELECT COUNT(*) FROM customers)+(SELECT COUNT(*) FROM suppliers) AS n', []).n }
}

module.exports = { checkInvariants }

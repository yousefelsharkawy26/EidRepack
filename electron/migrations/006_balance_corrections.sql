CREATE TABLE IF NOT EXISTS customer_balance_adjustments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  balance_delta_minor INTEGER NOT NULL CHECK (balance_delta_minor <> 0),
  effective_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_balance_adjustments (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  balance_delta_minor INTEGER NOT NULL CHECK (balance_delta_minor <> 0),
  effective_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

DROP VIEW IF EXISTS v_customer_balance;
CREATE VIEW v_customer_balance AS
SELECT c.id AS customer_id,
       COALESCE((SELECT SUM(o.balance_delta_minor) FROM customer_opening_balances o WHERE o.customer_id = c.id), 0)
       + COALESCE((SELECT SUM(a.balance_delta_minor) FROM customer_balance_adjustments a WHERE a.customer_id = c.id), 0)
       + COALESCE((SELECT SUM(s.gross_total_minor
           - COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                       WHERE r.return_type = 'sales' AND r.sales_order_id = s.id), 0))
            FROM sales_orders s WHERE s.customer_id = c.id AND s.status <> 'cancelled'), 0)
       - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.customer_id = c.id AND p.reversed_of_id IS NULL), 0) AS balance_minor
FROM customers c;

DROP VIEW IF EXISTS v_supplier_balance;
CREATE VIEW v_supplier_balance AS
SELECT s.id AS supplier_id,
       COALESCE((SELECT SUM(o.balance_delta_minor) FROM supplier_opening_balances o WHERE o.supplier_id = s.id), 0)
       + COALESCE((SELECT SUM(a.balance_delta_minor) FROM supplier_balance_adjustments a WHERE a.supplier_id = s.id), 0)
       + COALESCE((SELECT SUM(p.total_minor - p.paid_amount_minor
           - COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                       WHERE r.return_type = 'purchase' AND r.purchase_invoice_id = p.id), 0))
           FROM purchase_invoices p WHERE p.supplier_id = s.id AND p.status <> 'cancelled'), 0)
       - COALESCE((SELECT SUM(pay.amount_minor) FROM payments pay WHERE pay.supplier_id = s.id AND pay.reversed_of_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id=pay.id)), 0) AS balance_minor
FROM suppliers s;

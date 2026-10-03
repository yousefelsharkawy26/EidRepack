CREATE VIEW IF NOT EXISTS v_stock_balance AS
SELECT i.id AS item_id,
       i.sku,
       i.name,
       COALESCE(SUM(l.qty_remaining_base), 0) AS quantity_base,
       COALESCE(SUM(l.cost_remaining_minor), 0) AS cost_remaining_minor
FROM items i
LEFT JOIN stock_lots l ON l.item_id = i.id AND l.is_active = 1
GROUP BY i.id;

CREATE VIEW IF NOT EXISTS v_customer_balance AS
SELECT c.id AS customer_id,
       COALESCE((SELECT SUM(o.balance_delta_minor) FROM customer_opening_balances o WHERE o.customer_id = c.id), 0)
       + COALESCE((SELECT SUM(s.gross_total_minor - s.paid_amount_minor
           - COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                       WHERE r.return_type = 'sales' AND r.sales_order_id = s.id), 0))
           FROM sales_orders s WHERE s.customer_id = c.id AND s.status <> 'cancelled'), 0) AS balance_minor
FROM customers c;

CREATE VIEW IF NOT EXISTS v_supplier_balance AS
SELECT s.id AS supplier_id,
       COALESCE((SELECT SUM(o.balance_delta_minor) FROM supplier_opening_balances o WHERE o.supplier_id = s.id), 0)
       + COALESCE((SELECT SUM(p.total_minor - p.paid_amount_minor
           - COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                       WHERE r.return_type = 'purchase' AND r.purchase_invoice_id = p.id), 0))
           FROM purchase_invoices p WHERE p.supplier_id = s.id AND p.status <> 'cancelled'), 0)
       - COALESCE((SELECT SUM(amount_minor) FROM payments pay WHERE pay.supplier_id = s.id AND pay.reversed_of_id IS NULL), 0) AS balance_minor
FROM suppliers s;

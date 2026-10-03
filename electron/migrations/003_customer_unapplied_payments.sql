DROP VIEW IF EXISTS v_customer_balance;
CREATE VIEW v_customer_balance AS
SELECT c.id AS customer_id,
       COALESCE((SELECT SUM(o.balance_delta_minor) FROM customer_opening_balances o WHERE o.customer_id = c.id), 0)
       + COALESCE((SELECT SUM(s.gross_total_minor
           - COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                       WHERE r.return_type = 'sales' AND r.sales_order_id = s.id), 0))
           FROM sales_orders s WHERE s.customer_id = c.id AND s.status <> 'cancelled'), 0)
       - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.customer_id = c.id AND p.reversed_of_id IS NULL), 0) AS balance_minor
FROM customers c;

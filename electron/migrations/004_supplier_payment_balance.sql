-- Supplier payments are allocated to invoices and reflected in paid_amount_minor.
-- Counting the same payment row a second time made the legacy view understate balances.
ALTER TABLE purchase_invoices ADD COLUMN initial_paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (initial_paid_amount_minor >= 0);
ALTER TABLE sales_orders ADD COLUMN initial_paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (initial_paid_amount_minor >= 0);
ALTER TABLE payment_allocations ADD COLUMN is_initial INTEGER NOT NULL DEFAULT 0 CHECK (is_initial IN (0,1));

UPDATE payment_allocations SET is_initial=1
WHERE payment_id IN (SELECT id FROM payments WHERE notes IN ('دفعة مع الفاتورة','دفعة أولى عند إصدار الفاتورة','سداد نقدي عند إصدار الفاتورة'));
UPDATE purchase_invoices SET initial_paid_amount_minor=paid_amount_minor-COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_invoice_id=purchase_invoices.id AND a.is_initial=0),0);
UPDATE sales_orders SET initial_paid_amount_minor=paid_amount_minor-COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.sales_order_id=sales_orders.id AND a.is_initial=0),0);

INSERT INTO payments (id,party_type,party_id,customer_id,direction,amount_minor,method,date,notes,created_at)
SELECT 'migration:004:sale-initial:'||s.id,'customer',s.customer_id,s.customer_id,'in',s.initial_paid_amount_minor-COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.sales_order_id=s.id AND a.is_initial=1),0),'cash',s.date,'دفعة مع الفاتورة',s.date
FROM sales_orders s WHERE s.initial_paid_amount_minor>COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.sales_order_id=s.id AND a.is_initial=1),0);
INSERT INTO payment_allocations (id,payment_id,doc_type,sales_order_id,amount_minor,is_initial)
SELECT 'allocation:migration:004:sale-initial:'||s.id,'migration:004:sale-initial:'||s.id,'sales',s.id,s.initial_paid_amount_minor-COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.sales_order_id=s.id AND a.is_initial=1),0),1
FROM sales_orders s WHERE EXISTS (SELECT 1 FROM payments p WHERE p.id='migration:004:sale-initial:'||s.id);

INSERT INTO payments (id,party_type,party_id,supplier_id,direction,amount_minor,method,date,notes,created_at)
SELECT 'migration:004:purchase-initial:'||p.id,'supplier',p.supplier_id,p.supplier_id,'out',p.initial_paid_amount_minor-COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_invoice_id=p.id AND a.is_initial=1),0),'cash',p.date,'دفعة عند اعتماد الفاتورة',p.date
FROM purchase_invoices p WHERE p.initial_paid_amount_minor>COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_invoice_id=p.id AND a.is_initial=1),0);
INSERT INTO payment_allocations (id,payment_id,doc_type,purchase_invoice_id,amount_minor,is_initial)
SELECT 'allocation:migration:004:purchase-initial:'||p.id,'migration:004:purchase-initial:'||p.id,'purchase',p.id,p.initial_paid_amount_minor-COALESCE((SELECT SUM(a.amount_minor) FROM payment_allocations a WHERE a.purchase_invoice_id=p.id AND a.is_initial=1),0),1
FROM purchase_invoices p WHERE EXISTS (SELECT 1 FROM payments pay WHERE pay.id='migration:004:purchase-initial:'||p.id);

DROP VIEW IF EXISTS v_supplier_balance;
CREATE VIEW v_supplier_balance AS
SELECT s.id AS supplier_id,
       COALESCE((SELECT SUM(o.balance_delta_minor) FROM supplier_opening_balances o WHERE o.supplier_id = s.id), 0)
       + COALESCE((SELECT SUM(p.total_minor - p.paid_amount_minor
           - COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                       WHERE r.return_type = 'purchase' AND r.purchase_invoice_id = p.id), 0))
           FROM purchase_invoices p WHERE p.supplier_id = s.id AND p.status <> 'cancelled'), 0)
       - COALESCE((SELECT SUM(pay.amount_minor) FROM payments pay WHERE pay.supplier_id=s.id AND pay.reversed_of_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.payment_id=pay.id)), 0) AS balance_minor
FROM suppliers s;

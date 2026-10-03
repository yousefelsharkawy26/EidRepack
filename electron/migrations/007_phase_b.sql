-- Phase B: wire the UI to the relational backend.
-- 1) Seed canonical/display units and conversion factors (idempotent).
-- 2) Seed default company settings, reminder templates and rules for fresh
--    installs (skipped when a legacy import already populated them).
-- 3) Customer refund ledger for money returned after sales returns.

INSERT OR IGNORE INTO units (id, name, symbol, dimension, is_canonical, is_active) VALUES
  ('unit-g', 'جرام', 'g', 'weight', 1, 1),
  ('unit-ml', 'ملليلتر', 'ml', 'volume', 1, 1),
  ('unit-piece', 'قطعة', 'piece', 'count', 1, 1),
  ('unit-kg', 'كجم', 'kg', 'weight', 0, 1),
  ('unit-l', 'لتر', 'l', 'volume', 0, 1),
  ('unit-pack', 'عبوة', 'pack', 'count', 0, 1);

INSERT OR IGNORE INTO unit_conversions (id, from_unit_id, to_unit_id, factor_numerator, factor_denominator, is_active) VALUES
  ('conversion-kg-g', 'unit-kg', 'unit-g', 1000, 1, 1),
  ('conversion-l-ml', 'unit-l', 'unit-ml', 1000, 1, 1),
  ('conversion-pack-piece', 'unit-pack', 'unit-piece', 1, 1, 1);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('company_name', '"مدير التعبئة للتجارة"', '2026-01-01'),
  ('company_phone', '""', '2026-01-01'),
  ('currency', '"EGP"', '2026-01-01'),
  ('costing_method', '"FIFO"', '2026-01-01'),
  ('default_credit_days', '15', '2026-01-01');

CREATE TABLE IF NOT EXISTS customer_refunds (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  sales_order_id TEXT REFERENCES sales_orders(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  date TEXT NOT NULL,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_refunds_customer ON customer_refunds(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_refunds_sale ON customer_refunds(sales_order_id);

-- Customer balance now accounts for cash refunded to the customer: a refund
-- settles part of a negative (credit) balance, so it raises the balance back.
DROP VIEW IF EXISTS v_customer_balance;
CREATE VIEW v_customer_balance AS
SELECT c.id AS customer_id,
       COALESCE((SELECT SUM(o.balance_delta_minor) FROM customer_opening_balances o WHERE o.customer_id = c.id), 0)
       + COALESCE((SELECT SUM(a.balance_delta_minor) FROM customer_balance_adjustments a WHERE a.customer_id = c.id), 0)
       + COALESCE((SELECT SUM(s.gross_total_minor
           - COALESCE((SELECT SUM(rl.value_minor) FROM return_lines rl JOIN returns r ON r.id = rl.return_id
                       WHERE r.return_type = 'sales' AND r.sales_order_id = s.id), 0))
            FROM sales_orders s WHERE s.customer_id = c.id AND s.status <> 'cancelled'), 0)
       - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.customer_id = c.id AND p.reversed_of_id IS NULL), 0)
       + COALESCE((SELECT SUM(f.amount_minor) FROM customer_refunds f WHERE f.customer_id = c.id), 0) AS balance_minor
FROM customers c;

-- Default reminder templates and rules for brand-new installs only; a legacy
-- import writes its own rows first, and this guard keeps them untouched.
INSERT INTO message_templates (id, name, channel, body, stage)
SELECT 'tpl-before', 'تذكير ودّي', 'whatsapp', 'السلام عليكم {اسم_العميل} 🌷
تذكير ودّي بأن الفاتورة رقم {رقم_الفاتورة} بمبلغ {المبلغ_المتبقي} يحين موعد سدادها في {تاريخ_الاستحقاق}.
شكرًا لتعاملكم مع {اسم_المنشأة}.', 'قبل الاستحقاق'
WHERE NOT EXISTS (SELECT 1 FROM message_templates);

INSERT INTO message_templates (id, name, channel, body, stage)
SELECT 'tpl-due', 'يوم الاستحقاق', 'whatsapp', 'مرحبًا {اسم_العميل}، اليوم هو موعد سداد الفاتورة رقم {رقم_الفاتورة} والمبلغ المتبقي {المبلغ_المتبقي}. نرجو التكرم بالسداد.', 'يوم الاستحقاق'
WHERE NOT EXISTS (SELECT 1 FROM message_templates WHERE id = 'tpl-due')
AND EXISTS (SELECT 1 FROM message_templates WHERE id = 'tpl-before');

INSERT INTO message_templates (id, name, channel, body, stage)
SELECT 'tpl-late', 'متابعة تأخر', 'whatsapp', 'السلام عليكم {اسم_العميل}، نود تذكيركم بأن الفاتورة رقم {رقم_الفاتورة} تأخر سدادها منذ {تاريخ_الاستحقاق}، وإجمالي المستحق عليكم {اجمالي_المديونية}. نرجو التواصل لتحديد موعد للسداد.', 'بعد التأخر'
WHERE NOT EXISTS (SELECT 1 FROM message_templates WHERE id = 'tpl-late')
AND EXISTS (SELECT 1 FROM message_templates WHERE id = 'tpl-due');

INSERT INTO reminder_rules (id, name, offset_days, template_id, is_active, customer_id)
SELECT 'rule-before-3', 'تذكير مبكر', -3, 'tpl-before', 1, NULL
WHERE NOT EXISTS (SELECT 1 FROM reminder_rules);

INSERT INTO reminder_rules (id, name, offset_days, template_id, is_active, customer_id)
SELECT 'rule-due', 'يوم الاستحقاق', 0, 'tpl-due', 1, NULL
WHERE EXISTS (SELECT 1 FROM reminder_rules WHERE id = 'rule-before-3')
AND NOT EXISTS (SELECT 1 FROM reminder_rules WHERE id = 'rule-due');

INSERT INTO reminder_rules (id, name, offset_days, template_id, is_active, customer_id)
SELECT 'rule-after-7', 'متابعة التأخر', 7, 'tpl-late', 1, NULL
WHERE EXISTS (SELECT 1 FROM reminder_rules WHERE id = 'rule-due')
AND NOT EXISTS (SELECT 1 FROM reminder_rules WHERE id = 'rule-after-7');

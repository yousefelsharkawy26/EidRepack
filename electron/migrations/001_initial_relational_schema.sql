-- Repack Manager relational schema. All money is in piastres and all
-- quantities are integer counts in the item's canonical base unit.
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phase0_copy_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','sales','warehouse','purchasing')),
  password_hash TEXT NOT NULL,
  pin_hash TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL UNIQUE,
  dimension TEXT NOT NULL CHECK (dimension IN ('weight','volume','count')),
  is_canonical INTEGER NOT NULL DEFAULT 0 CHECK (is_canonical IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

CREATE TABLE IF NOT EXISTS unit_conversions (
  id TEXT PRIMARY KEY,
  from_unit_id TEXT NOT NULL REFERENCES units(id),
  to_unit_id TEXT NOT NULL REFERENCES units(id),
  factor_numerator INTEGER NOT NULL CHECK (factor_numerator > 0),
  factor_denominator INTEGER NOT NULL CHECK (factor_denominator > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (from_unit_id, to_unit_id),
  CHECK (from_unit_id <> to_unit_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('raw','packaging','finished')),
  category_id TEXT REFERENCES categories(id),
  base_unit_id TEXT NOT NULL REFERENCES units(id),
  legacy_unit_id TEXT REFERENCES units(id),
  pack_size_base INTEGER CHECK (pack_size_base IS NULL OR pack_size_base >= 0),
  min_stock_base INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_base >= 0),
  default_sale_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (default_sale_price_minor >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_recipe_lines (
  id TEXT PRIMARY KEY,
  finished_item_id TEXT NOT NULL REFERENCES items(id),
  component_item_id TEXT NOT NULL REFERENCES items(id),
  qty_per_unit_base INTEGER NOT NULL CHECK (qty_per_unit_base > 0),
  line_type TEXT NOT NULL CHECK (line_type IN ('raw','packaging')),
  extra_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (extra_cost_minor >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (finished_item_id, component_item_id),
  CHECK (finished_item_id <> component_item_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT,
  address TEXT,
  default_credit_days INTEGER NOT NULL DEFAULT 0 CHECK (default_credit_days >= 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  credit_limit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  credit_days INTEGER NOT NULL DEFAULT 0 CHECK (credit_days >= 0),
  is_blocked INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0,1)),
  block_reason TEXT,
  reminder_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminder_enabled IN (0,1)),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_opening_balances (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  balance_delta_minor INTEGER NOT NULL CHECK (balance_delta_minor <> 0),
  effective_date TEXT NOT NULL,
  due_date TEXT,
  is_opening INTEGER NOT NULL DEFAULT 1 CHECK (is_opening = 1),
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (customer_id, is_opening)
);

CREATE TABLE IF NOT EXISTS supplier_opening_balances (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  balance_delta_minor INTEGER NOT NULL CHECK (balance_delta_minor <> 0),
  effective_date TEXT NOT NULL,
  due_date TEXT,
  is_opening INTEGER NOT NULL DEFAULT 1 CHECK (is_opening = 1),
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (supplier_id, is_opening)
);

CREATE TABLE IF NOT EXISTS price_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EGP',
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_list_items (
  id TEXT PRIMARY KEY,
  price_list_id TEXT NOT NULL REFERENCES price_lists(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  customer_id TEXT REFERENCES customers(id),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (price_list_id, item_id, customer_id)
);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','confirmed','cancelled')),
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  extra_costs_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (extra_costs_total_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  due_date TEXT,
  supplier_invoice_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  qty_base INTEGER NOT NULL CHECK (qty_base > 0),
  unit_input_id TEXT REFERENCES units(id),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
  allocated_extra_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (allocated_extra_cost_minor >= 0),
  landed_cost_total_minor INTEGER NOT NULL CHECK (landed_cost_total_minor >= 0)
);

CREATE TABLE IF NOT EXISTS purchase_extra_costs (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id),
  label TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  allocation_method TEXT NOT NULL DEFAULT 'proportional'
);

CREATE TABLE IF NOT EXISTS purchase_drafts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  date TEXT NOT NULL,
  quantity_base INTEGER NOT NULL CHECK (quantity_base > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  extra_costs_minor INTEGER NOT NULL DEFAULT 0 CHECK (extra_costs_minor >= 0),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  supplier_invoice_number TEXT,
  due_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS packing_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  finished_item_id TEXT NOT NULL REFERENCES items(id),
  planned_units INTEGER NOT NULL CHECK (planned_units >= 0),
  produced_units INTEGER NOT NULL CHECK (produced_units >= 0),
  waste_qty_base INTEGER NOT NULL DEFAULT 0 CHECK (waste_qty_base >= 0),
  waste_reason TEXT,
  raw_cost_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (raw_cost_total_minor >= 0),
  packaging_cost_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (packaging_cost_total_minor >= 0),
  overhead_cost_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (overhead_cost_total_minor >= 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('draft','confirmed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS stock_lots (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('purchase','packing','adjustment','opening','return')),
  source_id TEXT,
  lot_code TEXT NOT NULL,
  qty_initial_base INTEGER NOT NULL CHECK (qty_initial_base >= 0),
  qty_remaining_base INTEGER NOT NULL CHECK (qty_remaining_base >= 0 AND qty_remaining_base <= qty_initial_base),
  cost_total_minor INTEGER NOT NULL CHECK (cost_total_minor >= 0),
  cost_remaining_minor INTEGER NOT NULL CHECK (cost_remaining_minor >= 0 AND cost_remaining_minor <= cost_total_minor),
  received_at TEXT NOT NULL,
  expiry_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (item_id, lot_code)
);

CREATE TABLE IF NOT EXISTS packing_inputs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES packing_orders(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  lot_id TEXT REFERENCES stock_lots(id),
  qty_base INTEGER NOT NULL CHECK (qty_base > 0),
  cost_minor INTEGER NOT NULL CHECK (cost_minor >= 0)
);

CREATE TABLE IF NOT EXISTS packing_outputs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES packing_orders(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  qty_units INTEGER NOT NULL CHECK (qty_units > 0),
  cost_total_minor INTEGER NOT NULL CHECK (cost_total_minor >= 0),
  output_lot_id TEXT REFERENCES stock_lots(id)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','confirmed','cancelled','partial','paid','overdue')),
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  gross_total_minor INTEGER NOT NULL CHECK (gross_total_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  paid_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_minor >= 0),
  credit_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount_minor >= 0),
  due_date TEXT,
  credit_override_by TEXT REFERENCES users(id),
  credit_override_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sales_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES sales_orders(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  lot_id TEXT REFERENCES stock_lots(id),
  qty_base INTEGER NOT NULL CHECK (qty_base > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
  cogs_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (cogs_total_minor >= 0)
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  return_type TEXT NOT NULL CHECK (return_type IN ('sales','purchase')),
  sales_order_id TEXT REFERENCES sales_orders(id),
  purchase_invoice_id TEXT REFERENCES purchase_invoices(id),
  date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK ((return_type = 'sales' AND sales_order_id IS NOT NULL AND purchase_invoice_id IS NULL)
      OR (return_type = 'purchase' AND purchase_invoice_id IS NOT NULL AND sales_order_id IS NULL))
);

CREATE TABLE IF NOT EXISTS return_lines (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES returns(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  original_sales_line_id TEXT REFERENCES sales_lines(id),
  original_purchase_line_id TEXT REFERENCES purchase_lines(id),
  original_lot_id TEXT REFERENCES stock_lots(id),
  return_lot_id TEXT REFERENCES stock_lots(id),
  qty_base INTEGER NOT NULL CHECK (qty_base > 0),
  value_minor INTEGER NOT NULL CHECK (value_minor >= 0),
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  supplier_id TEXT REFERENCES suppliers(id),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  date TEXT NOT NULL,
  reference TEXT,
  notes TEXT,
  reversed_of_id TEXT REFERENCES payments(id),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK ((party_type = 'customer' AND customer_id = party_id AND supplier_id IS NULL AND direction = 'in')
      OR (party_type = 'supplier' AND supplier_id = party_id AND customer_id IS NULL AND direction = 'out'))
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  doc_type TEXT NOT NULL CHECK (doc_type IN ('sales','purchase')),
  sales_order_id TEXT REFERENCES sales_orders(id),
  purchase_invoice_id TEXT REFERENCES purchase_invoices(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  CHECK ((doc_type = 'sales' AND sales_order_id IS NOT NULL AND purchase_invoice_id IS NULL)
      OR (doc_type = 'purchase' AND purchase_invoice_id IS NOT NULL AND sales_order_id IS NULL))
);

CREATE TABLE IF NOT EXISTS promises_to_pay (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  promised_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('open','kept','broken')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  method TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  date TEXT NOT NULL,
  created_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id),
  lot_id TEXT REFERENCES stock_lots(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening','purchase','purchase-return','packing-consumption','packing-production','sale','sales-return','adjustment')),
  qty_base INTEGER NOT NULL CHECK (qty_base <> 0),
  balance_after_base INTEGER NOT NULL,
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS reminder_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  template_id TEXT REFERENCES message_templates(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  customer_id TEXT REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  body TEXT NOT NULL,
  stage TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  rule_id TEXT REFERENCES reminder_rules(id),
  template_id TEXT REFERENCES message_templates(id),
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','skipped','failed','cancelled')),
  sent_at TEXT,
  stage TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS message_log (
  id TEXT PRIMARY KEY,
  reminder_id TEXT REFERENCES reminders(id),
  customer_id TEXT REFERENCES customers(id),
  to_phone TEXT,
  rendered_body TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'whatsapp-link',
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_notifications (
  id TEXT PRIMARY KEY,
  notification_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups_log (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activity_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_migrations (
  migration_key TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  reconciliation_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_unit_conversions_from ON unit_conversions(from_unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_conversions_to ON unit_conversions(to_unit_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_base_unit ON items(base_unit_id);
CREATE INDEX IF NOT EXISTS idx_items_legacy_unit ON items(legacy_unit_id);
CREATE INDEX IF NOT EXISTS idx_recipe_finished ON item_recipe_lines(finished_item_id);
CREATE INDEX IF NOT EXISTS idx_recipe_component ON item_recipe_lines(component_item_id);
CREATE INDEX IF NOT EXISTS idx_customer_opening_customer ON customer_opening_balances(customer_id);
CREATE INDEX IF NOT EXISTS idx_supplier_opening_supplier ON supplier_opening_balances(supplier_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_list ON price_list_items(price_list_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_item ON price_list_items(item_id);
CREATE INDEX IF NOT EXISTS idx_price_list_items_customer ON price_list_items(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier ON purchase_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_created_by ON purchase_invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_due ON purchase_invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_invoice ON purchase_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_item ON purchase_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_unit_input ON purchase_lines(unit_input_id);
CREATE INDEX IF NOT EXISTS idx_purchase_costs_invoice ON purchase_extra_costs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_drafts_supplier ON purchase_drafts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_drafts_item ON purchase_drafts(item_id);
CREATE INDEX IF NOT EXISTS idx_packing_orders_item ON packing_orders(finished_item_id);
CREATE INDEX IF NOT EXISTS idx_packing_orders_created_by ON packing_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_stock_lots_item ON stock_lots(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_lots_source ON stock_lots(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_packing_inputs_order ON packing_inputs(order_id);
CREATE INDEX IF NOT EXISTS idx_packing_inputs_item ON packing_inputs(item_id);
CREATE INDEX IF NOT EXISTS idx_packing_inputs_lot ON packing_inputs(lot_id);
CREATE INDEX IF NOT EXISTS idx_packing_outputs_order ON packing_outputs(order_id);
CREATE INDEX IF NOT EXISTS idx_packing_outputs_item ON packing_outputs(item_id);
CREATE INDEX IF NOT EXISTS idx_packing_outputs_lot ON packing_outputs(output_lot_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_due ON sales_orders(customer_id, due_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_credit_override_by ON sales_orders(credit_override_by);
CREATE INDEX IF NOT EXISTS idx_sales_orders_created_by ON sales_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_sales_lines_order ON sales_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_sales_lines_item ON sales_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_sales_lines_lot ON sales_lines(lot_id);
CREATE INDEX IF NOT EXISTS idx_returns_sales ON returns(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_returns_purchase ON returns(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_returns_created_by ON returns(created_by);
CREATE INDEX IF NOT EXISTS idx_return_lines_return ON return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_item ON return_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_sales_line ON return_lines(original_sales_line_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_purchase_line ON return_lines(original_purchase_line_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_lot ON return_lines(original_lot_id);
CREATE INDEX IF NOT EXISTS idx_return_lines_return_lot ON return_lines(return_lot_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_supplier ON payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payments_reversed ON payments(reversed_of_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_by ON payments(created_by);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_sales ON payment_allocations(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_purchase ON payment_allocations(purchase_invoice_id);
CREATE INDEX IF NOT EXISTS idx_promises_customer ON promises_to_pay(customer_id);
CREATE INDEX IF NOT EXISTS idx_promises_sales ON promises_to_pay(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_user ON cash_transactions(created_by);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_created ON stock_movements(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_lot ON stock_movements(lot_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_user ON stock_movements(created_by);
CREATE INDEX IF NOT EXISTS idx_reminder_rules_template ON reminder_rules(template_id);
CREATE INDEX IF NOT EXISTS idx_reminder_rules_customer ON reminder_rules(customer_id);
CREATE INDEX IF NOT EXISTS idx_reminders_sales ON reminders(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_reminders_customer ON reminders(customer_id);
CREATE INDEX IF NOT EXISTS idx_reminders_rule ON reminders(rule_id);
CREATE INDEX IF NOT EXISTS idx_reminders_template ON reminders(template_id);
CREATE INDEX IF NOT EXISTS idx_message_log_reminder ON message_log(reminder_id);
CREATE INDEX IF NOT EXISTS idx_message_log_customer ON message_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);

-- Keep report date-range scans efficient as transactional history grows.
CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(date);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date ON purchase_invoices(date);
CREATE INDEX IF NOT EXISTS idx_returns_date ON returns(date);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_packing_orders_date_status ON packing_orders(date, status);

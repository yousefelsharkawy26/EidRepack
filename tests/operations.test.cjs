const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { applyMigrations, configureDatabase } = require('../electron/migrations/runner.cjs')
const operations = require('../electron/services/operations.cjs')

function freshDatabase() {
  const db = new Database(':memory:')
  configureDatabase(db)
  applyMigrations(db)
  return db
}

const NOW = '2026-01-01T09:00:00.000Z'
const ownerCtx = { ctx: { userId: 'user-owner', role: 'owner' } }

function seedFixtures(db) {
  const now = NOW
  db.prepare("INSERT OR IGNORE INTO units (id,name,symbol,dimension,is_canonical) VALUES ('unit-g','جرام','g','weight',1)").run()
  db.prepare("INSERT OR IGNORE INTO units (id,name,symbol,dimension,is_canonical) VALUES ('unit-piece','قطعة','piece','count',1)").run()
  db.prepare("INSERT INTO users (id,username,display_name,role,password_hash,is_active,created_at,updated_at) VALUES ('user-owner','owner','المالك','owner','x',1,?,?)").run(now, now)
  const insertItem = db.prepare("INSERT INTO items (id,sku,name,type,base_unit_id,pack_size_base,min_stock_base,default_sale_price_minor,is_active,created_at,updated_at) VALUES (?,?,?,?,?,0,0,?,1,?,?)")
  insertItem.run('raw-sugar', 'RAW-1', 'سكر خام', 'raw', 'unit-g', 0, now, now)
  insertItem.run('pack-bag', 'PKG-1', 'كيس تعبئة', 'packaging', 'unit-piece', 0, now, now)
  insertItem.run('pack-label', 'PKG-2', 'ملصق', 'packaging', 'unit-piece', 0, now, now)
  insertItem.run('fin-sugar', 'FIN-1', 'سكر 500 جم', 'finished', 'unit-piece', 3000, now, now)
  db.prepare("INSERT INTO item_recipe_lines (id,finished_item_id,component_item_id,qty_per_unit_base,line_type,extra_cost_minor,is_active) VALUES ('r1','fin-sugar','raw-sugar',500,'raw',0,1)").run()
  db.prepare("INSERT INTO item_recipe_lines (id,finished_item_id,component_item_id,qty_per_unit_base,line_type,extra_cost_minor,is_active) VALUES ('r2','fin-sugar','pack-bag',1,'packaging',0,1)").run()
  db.prepare("INSERT INTO item_recipe_lines (id,finished_item_id,component_item_id,qty_per_unit_base,line_type,extra_cost_minor,is_active) VALUES ('r3','fin-sugar','pack-label',1,'packaging',0,1)").run()
  db.prepare("INSERT INTO suppliers (id,name,default_credit_days,is_active,created_at,updated_at) VALUES ('sup-1','الشركة الأولى',15,1,?,?)").run(now, now)
  db.prepare("INSERT INTO customers (id,name,credit_limit_minor,credit_days,is_active,created_at,updated_at) VALUES ('cust-1','محل النور',500000,15,1,?,?)").run(now, now)
  db.prepare("INSERT INTO customers (id,name,credit_limit_minor,credit_days,is_blocked,is_active,created_at,updated_at) VALUES ('cust-blocked','عميل محظور',900000,15,1,1,?,?)").run(now, now)
  // Migration 007 seeds default templates/rules; deactivate them so the
  // fixture's rule is the only one scheduling reminders for test sales.
  db.prepare('UPDATE reminder_rules SET is_active=0').run()
  db.prepare("INSERT INTO message_templates (id,name,body,stage) VALUES ('tpl-1','تذكير','نص {اسم_العميل}','قبل الاستحقاق')").run()
  db.prepare("INSERT INTO reminder_rules (id,name,offset_days,template_id,is_active) VALUES ('rule-1','تذكير مبكر',-3,'tpl-1',1)").run()
}

const stockOf = (db, itemId) => db.prepare('SELECT quantity_base FROM v_stock_balance WHERE item_id=?').get(itemId)?.quantity_base ?? 0
const customerBalance = (db, id) => db.prepare('SELECT balance_minor FROM v_customer_balance WHERE customer_id=?').get(id)?.balance_minor ?? 0

test('confirmPurchase creates lot, movement, payment and cash entry atomically', () => {
  const db = freshDatabase()
  seedFixtures(db)
  const result = operations.confirmPurchase(db, {
    supplierId: 'sup-1', itemId: 'raw-sugar', quantity: 100000,
    subtotalMinor: 400000, extraCostsMinor: 20000, totalMinor: 420000, paidMinor: 200000,
    number: 'PUR-2026-0001', date: '2026-01-01', dueDate: '2026-01-16'
  }, ownerCtx)
  assert.ok(result.id)
  const lot = db.prepare('SELECT * FROM stock_lots WHERE id=?').get(result.lotId)
  assert.equal(lot.qty_remaining_base, 100000)
  assert.equal(lot.cost_remaining_minor, 420000)
  assert.equal(stockOf(db, 'raw-sugar'), 100000)
  const payment = db.prepare("SELECT * FROM payments WHERE party_type='supplier'").get()
  assert.equal(payment.amount_minor, 200000)
  assert.equal(payment.direction, 'out')
  const cash = db.prepare("SELECT * FROM cash_transactions WHERE transaction_type='purchase-payment'").get()
  assert.equal(cash.amount_minor, -200000)
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action LIKE 'purchase.confirm%'").get())
  assert.doesNotThrow(() => operations.checkInvariants(db))
  db.close()
})

test('confirmPacking consumes inputs FIFO and costs output per PRD example', () => {
  const db = freshDatabase()
  seedFixtures(db)
  operations.confirmPurchase(db, { supplierId: 'sup-1', itemId: 'raw-sugar', quantity: 100000, totalMinor: 420000, paidMinor: 0, number: 'PUR-1', date: '2026-01-01' }, ownerCtx)
  operations.createOpeningStock(db, { itemId: 'pack-bag', quantity: 1000, costMinor: 50000, date: '2026-01-01' }, ownerCtx)
  operations.createOpeningStock(db, { itemId: 'pack-label', quantity: 1000, costMinor: 20000, date: '2026-01-01' }, ownerCtx)
  // PRD example: 180 units x 500g + 1kg waste => raw 91kg @ 42 = 3822, packaging 126 => 3948 total, 21.93/unit
  const result = operations.confirmPacking(db, {
    finishedItemId: 'fin-sugar', producedUnits: 180, wasteQty: 1000,
    inputs: [
      { itemId: 'raw-sugar', quantity: 91000 },
      { itemId: 'pack-bag', quantity: 180 },
      { itemId: 'pack-label', quantity: 180 }
    ],
    number: 'PCK-2026-0001', date: '2026-01-02'
  }, ownerCtx)
  assert.equal(result.totalCostMinor, 394800)
  assert.equal(result.unitCostMinor, 2193) // 21.93 ج للعبوة
  assert.equal(stockOf(db, 'raw-sugar'), 9000)
  assert.equal(stockOf(db, 'pack-bag'), 820)
  assert.equal(stockOf(db, 'fin-sugar'), 180)
  const order = db.prepare('SELECT * FROM packing_orders WHERE id=?').get(result.id)
  assert.equal(order.raw_cost_total_minor, 382200)
  assert.equal(order.packaging_cost_total_minor, 12600)
  assert.doesNotThrow(() => operations.checkInvariants(db))
  db.close()
})

test('confirmPacking rejects inputs that do not match the recipe', () => {
  const db = freshDatabase()
  seedFixtures(db)
  operations.createOpeningStock(db, { itemId: 'raw-sugar', quantity: 50000, costMinor: 210000, date: '2026-01-01' }, ownerCtx)
  operations.createOpeningStock(db, { itemId: 'pack-bag', quantity: 500, costMinor: 25000, date: '2026-01-01' }, ownerCtx)
  operations.createOpeningStock(db, { itemId: 'pack-label', quantity: 500, costMinor: 10000, date: '2026-01-01' }, ownerCtx)
  assert.throws(() => operations.confirmPacking(db, {
    finishedItemId: 'fin-sugar', producedUnits: 10, wasteQty: 0,
    inputs: [{ itemId: 'raw-sugar', quantity: 4999 }, { itemId: 'pack-bag', quantity: 10 }, { itemId: 'pack-label', quantity: 10 }],
    number: 'PCK-X', date: '2026-01-02'
  }, ownerCtx), /recipe/i)
  assert.equal(stockOf(db, 'raw-sugar'), 50000)
  db.close()
})

test('confirmSale enforces credit limit and blocked customers', () => {
  const db = freshDatabase()
  seedFixtures(db)
  operations.createOpeningStock(db, { itemId: 'fin-sugar', quantity: 500, costMinor: 1000000, date: '2026-01-01' }, ownerCtx)
  // credit limit 5000.00 => 500000 minor; sale of 300000 on credit is allowed
  const ok = operations.confirmSale(db, {
    customerId: 'cust-1', number: 'INV-1', date: '2026-01-05', dueDate: '2026-01-20',
    lines: [{ itemId: 'fin-sugar', quantity: 100, unitPriceMinor: 3000 }], paidMinor: 0
  }, ownerCtx)
  assert.equal(ok.creditMinor, 300000)
  assert.equal(customerBalance(db, 'cust-1'), 300000)
  // exceeding the remaining limit must fail
  assert.throws(() => operations.confirmSale(db, {
    customerId: 'cust-1', number: 'INV-2', date: '2026-01-05', dueDate: '2026-01-20',
    lines: [{ itemId: 'fin-sugar', quantity: 100, unitPriceMinor: 3000 }], paidMinor: 0
  }, ownerCtx), /Credit limit exceeded/)
  // blocked customer cannot buy on credit
  assert.throws(() => operations.confirmSale(db, {
    customerId: 'cust-blocked', number: 'INV-3', date: '2026-01-05', dueDate: '2026-01-20',
    lines: [{ itemId: 'fin-sugar', quantity: 10, unitPriceMinor: 3000 }], paidMinor: 0
  }, ownerCtx), /blocked/)
  // blocked customer CAN buy cash
  const cash = operations.confirmSale(db, {
    customerId: 'cust-blocked', number: 'INV-4', date: '2026-01-05',
    lines: [{ itemId: 'fin-sugar', quantity: 10, unitPriceMinor: 3000 }], paidMinor: 30000
  }, ownerCtx)
  assert.equal(cash.creditMinor, 0)
  assert.doesNotThrow(() => operations.checkInvariants(db))
  db.close()
})

test('credit sale schedules reminders; full collection cancels them', () => {
  const db = freshDatabase()
  seedFixtures(db)
  operations.createOpeningStock(db, { itemId: 'fin-sugar', quantity: 500, costMinor: 1000000, date: '2026-01-01' }, ownerCtx)
  const sale = operations.confirmSale(db, {
    customerId: 'cust-1', number: 'INV-10', date: '2026-01-05', dueDate: '2026-01-20',
    lines: [{ itemId: 'fin-sugar', quantity: 50, unitPriceMinor: 3000 }], paidMinor: 0
  }, ownerCtx)
  const scheduled = db.prepare("SELECT * FROM reminders WHERE sales_order_id=? AND status='pending'").all(sale.id)
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].scheduled_for, '2026-01-17')
  // partial collection keeps reminders
  operations.recordCollection(db, { saleId: sale.id, customerId: 'cust-1', amountMinor: 50000, date: '2026-01-10' }, ownerCtx)
  assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(sale.id).status, 'partial')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM reminders WHERE sales_order_id=? AND status='pending'").get(sale.id).n, 1)
  // full collection settles and cancels reminders
  operations.recordCollection(db, { saleId: sale.id, customerId: 'cust-1', amountMinor: 100000, date: '2026-01-12' }, ownerCtx)
  assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(sale.id).status, 'paid')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM reminders WHERE sales_order_id=? AND status='pending'").get(sale.id).n, 0)
  assert.equal(customerBalance(db, 'cust-1'), 0)
  assert.doesNotThrow(() => operations.checkInvariants(db))
  db.close()
})

test('returnSale restocks the original lot and reduces the balance', () => {
  const db = freshDatabase()
  seedFixtures(db)
  operations.createOpeningStock(db, { itemId: 'fin-sugar', quantity: 500, costMinor: 1000000, date: '2026-01-01' }, ownerCtx)
  const sale = operations.confirmSale(db, {
    customerId: 'cust-1', number: 'INV-20', date: '2026-01-05', dueDate: '2026-01-20',
    lines: [{ itemId: 'fin-sugar', quantity: 100, unitPriceMinor: 3000 }], paidMinor: 0
  }, ownerCtx)
  const line = db.prepare('SELECT * FROM sales_lines WHERE order_id=?').get(sale.id)
  operations.returnSale(db, {
    saleId: sale.id, number: 'RET-1', date: '2026-01-06',
    lines: [{ originalSalesLineId: line.id, quantity: 10 }], reason: 'مرتجع جزئي'
  }, ownerCtx)
  assert.equal(stockOf(db, 'fin-sugar'), 410)
  assert.equal(customerBalance(db, 'cust-1'), 270000)
  assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(sale.id).status, 'confirmed')
  // cannot return more than sold
  assert.throws(() => operations.returnSale(db, {
    saleId: sale.id, number: 'RET-2', date: '2026-01-06',
    lines: [{ originalSalesLineId: line.id, quantity: 95 }], reason: 'x'
  }, ownerCtx), /exceeds/)
  assert.doesNotThrow(() => operations.checkInvariants(db))
  db.close()
})

test('saveCustomer rejects direct balance writes and validates credit fields', () => {
  const db = freshDatabase()
  seedFixtures(db)
  assert.throws(() => operations.saveCustomer(db, { name: 'x', balanceMinor: 100 }, ownerCtx), /opening entry/)
  const created = operations.saveCustomer(db, { name: 'عميل جديد', creditLimitMinor: 100000, creditDays: 7 }, ownerCtx)
  assert.equal(db.prepare('SELECT credit_limit_minor FROM customers WHERE id=?').get(created.id).credit_limit_minor, 100000)
  // non-owner cannot touch credit fields
  assert.throws(() => operations.saveCustomer(db, { id: created.id, name: 'عميل جديد', creditLimitMinor: 200000 }, { ctx: { userId: 'u2', role: 'sales' } }), /owner permission/)
  db.close()
})

test('updateReminder handles send, skip and postpone with guards', () => {
  const db = freshDatabase()
  seedFixtures(db)
  operations.createOpeningStock(db, { itemId: 'fin-sugar', quantity: 500, costMinor: 1000000, date: '2026-01-01' }, ownerCtx)
  const sale = operations.confirmSale(db, {
    customerId: 'cust-1', number: 'INV-30', date: '2026-01-05', dueDate: '2026-01-20',
    lines: [{ itemId: 'fin-sugar', quantity: 10, unitPriceMinor: 3000 }], paidMinor: 0
  }, ownerCtx)
  const reminder = db.prepare('SELECT * FROM reminders WHERE sales_order_id=?').get(sale.id)
  operations.updateReminder(db, { id: reminder.id, action: 'sent', renderedBody: 'نص الرسالة', toPhone: '201012345678', date: '2026-01-17' }, ownerCtx)
  assert.equal(db.prepare('SELECT status FROM reminders WHERE id=?').get(reminder.id).status, 'sent')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM message_log').get().n, 1)
  assert.throws(() => operations.updateReminder(db, { id: reminder.id, action: 'bogus' }, ownerCtx), /Unsupported/)
  db.close()
})

test('roundHalfUp rounds monetary division without floating point errors', () => {
  assert.equal(operations.roundHalfUp(394800, 180), 2193)
  assert.equal(operations.roundHalfUp(5n, 2n), 3)
  assert.equal(operations.roundHalfUp(-5n, 2n), -3) // ties round away from zero
  assert.throws(() => operations.roundHalfUp(1.5, 1))
})

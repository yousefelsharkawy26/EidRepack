const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { applyMigrations, configureDatabase } = require('../electron/migrations/runner.cjs')
const { periodSchema, reportPeriod } = require('../electron/modules/reports/index.cjs')

function database() {
  const db = new Database(':memory:')
  configureDatabase(db)
  applyMigrations(db)
  return db
}

test('reports period query filters business activity by inclusive local calendar dates', () => {
  const db = database()
  try {
    const customerId = 'report-customer'
    db.prepare("INSERT INTO customers (id,name,created_at,updated_at) VALUES (?,?,'2026-01-01','2026-01-01')").run(customerId, 'عميل الاختبار')
    const insert = db.prepare(`INSERT INTO sales_orders
      (id,number,customer_id,date,status,subtotal_minor,discount_minor,tax_minor,gross_total_minor,total_minor,paid_amount_minor,created_at)
      VALUES (?,?,?,?,'paid',10000,0,0,10000,10000,10000,?)`)
    insert.run('report-in', 'RPT-IN', customerId, '2026-06-30', '2026-06-30')
    insert.run('report-late', 'RPT-LATE', customerId, '2026-06-30T23:59:59.999', '2026-06-30')
    insert.run('report-before', 'RPT-BEFORE', customerId, '2026-06-29', '2026-06-29')
    insert.run('report-after', 'RPT-AFTER', customerId, '2026-07-01T00:00:00', '2026-07-01')

    const input = periodSchema.parse({ from: '2026-06-30', to: '2026-06-30' })
    const report = reportPeriod(db, { role: 'owner' }, input)
    assert.deepEqual(report.sales.map(sale => sale.id), ['report-in', 'report-late'])
    assert.equal(report.from, '2026-06-30')
    assert.equal(report.to, '2026-06-30')
    assert.ok(Array.isArray(report.inventory))
    assert.ok(Array.isArray(report.customers))
  } finally {
    db.close()
  }
})

test('reports period validation rejects reversed and future dates', () => {
  assert.throws(() => periodSchema.parse({ from: '2026-07-01', to: '2026-06-30' }))
  assert.throws(() => periodSchema.parse({ from: '2026-10-04', to: '2026-10-04' }))
  assert.throws(() => periodSchema.parse({ from: '2026-02-30', to: '2026-03-01' }))
})

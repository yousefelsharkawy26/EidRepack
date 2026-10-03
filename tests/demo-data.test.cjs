const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const { applyMigrations, configureDatabase } = require('../electron/migrations/runner.cjs')
const { createDemoDatabase } = require('../electron/system/demo-data.cjs')

test('demo database is isolated, seeded with synthetic records, and reusable', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'repack-demo-test-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const productionPath = path.join(folder, 'production.db')
  const demoPath = path.join(folder, 'demo.db')
  const production = new Database(productionPath)
  t.after(() => { if (production.open) production.close() })
  configureDatabase(production)
  applyMigrations(production)
  production.prepare(`INSERT INTO users(id,username,display_name,role,password_hash,pin_hash,is_active,created_at,updated_at)
    VALUES ('owner-id','owner','Owner','owner','password-hash','pin-hash',1,'2026-01-01','2026-01-01')`).run()
  production.prepare(`INSERT INTO categories(id,name,is_active,created_at,updated_at) VALUES ('real-category','Real category',1,'2026-01-01','2026-01-01')`).run()
  production.prepare(`INSERT INTO customers(id,name,created_at,updated_at) VALUES ('real-customer','Real customer','2026-01-01','2026-01-01')`).run()
  production.prepare('UPDATE settings SET value=?,updated_at=? WHERE key=?').run(JSON.stringify('Real company'), '2026-01-01', 'company_name')

  assert.equal(await createDemoDatabase({ sourceDatabase: production, demoPath, ownerId: 'owner-id', Database, configureDatabase, applyMigrations, ensureAppStateTable: db => db.exec('CREATE TABLE IF NOT EXISTS app_state(id INTEGER PRIMARY KEY,payload TEXT,updated_at TEXT)') }), true)
  const demo = new Database(demoPath)
  try {
    assert.equal(demo.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1)
    assert.equal(demo.prepare('SELECT COUNT(*) AS n FROM customers WHERE name=?').get('عميل تجريبي').n, 1)
    assert.equal(demo.prepare('SELECT COUNT(*) AS n FROM items WHERE sku LIKE ?').get('DEMO-%').n, 3)
    assert.equal(demo.prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE ref_type=?').get('demo-seed').n, 3)
    assert.equal(demo.prepare('SELECT value FROM settings WHERE key=?').get('company_name').value, JSON.stringify('منشأة تجريبية'))
    assert.equal(demo.prepare('SELECT COUNT(*) AS n FROM customers WHERE id=?').get('real-customer').n, 0)
    demo.prepare(`INSERT INTO customers(id,name,created_at,updated_at) VALUES ('demo-added','Demo added','2026-01-01','2026-01-01')`).run()
  } finally { demo.close() }

  assert.equal(await createDemoDatabase({ sourceDatabase: production, demoPath, ownerId: 'owner-id', Database, configureDatabase, applyMigrations }), false)
  assert.equal(production.prepare('SELECT COUNT(*) AS n FROM customers WHERE id=?').get('real-customer').n, 1)
  assert.equal(production.prepare('SELECT value FROM settings WHERE key=?').get('company_name').value, JSON.stringify('Real company'))
  const reopened = new Database(demoPath, { readonly: true })
  try { assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM customers WHERE id=?').get('demo-added').n, 1) }
  finally { reopened.close() }
})

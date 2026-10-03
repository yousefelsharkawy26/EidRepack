const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const { applyMigrations, configureDatabase, loadMigrations } = require('../electron/migrations/runner.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'electron', 'migrations')

function freshDatabase(directory = MIGRATIONS_DIR) {
  const db = new Database(':memory:')
  configureDatabase(db)
  applyMigrations(db, directory)
  return db
}

test('applies all numbered migrations in order on a fresh database', () => {
  const db = freshDatabase()
  const versions = db.prepare('SELECT version FROM schema_version ORDER BY version').all().map(row => row.version)
  assert.deepEqual(versions, loadMigrations().map(migration => migration.version))
  for (const table of ['items', 'customers', 'suppliers', 'sales_orders', 'purchase_invoices', 'stock_lots', 'stock_movements', 'reminders', 'audit_log', 'command_log', 'migration_checksums']) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `missing table ${table}`)
  }
  for (const view of ['v_stock_balance', 'v_customer_balance', 'v_supplier_balance']) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name=?").get(view), `missing view ${view}`)
  }
  db.close()
})

test('re-applying migrations is idempotent', () => {
  const db = new Database(':memory:')
  configureDatabase(db)
  const first = applyMigrations(db)
  const second = applyMigrations(db)
  assert.deepEqual(first, loadMigrations().map(migration => migration.version))
  assert.deepEqual(second, [])
  db.close()
})

test('detects tampered migration files via checksums', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repack-migrations-'))
  try {
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter(name => /^\d{3}_.*\.sql$/.test(name))) {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(tempDir, file))
    }
    const db = new Database(':memory:')
    configureDatabase(db)
    applyMigrations(db, tempDir)
    fs.appendFileSync(path.join(tempDir, '002_balance_views.sql'), '\n-- tampered\n')
    assert.throws(() => applyMigrations(db, tempDir), /checksum mismatch for 002_balance_views\.sql/i)
    db.close()
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('reports a missing checksum for an applied migration', () => {
  const db = freshDatabase()
  db.prepare('DELETE FROM migration_checksums WHERE version = 7').run()
  assert.throws(() => applyMigrations(db), /checksum is missing for 007_phase_b\.sql/i)
  db.close()
})

test('migration files are sequentially numbered and well-formed', () => {
  const migrations = loadMigrations()
  assert.ok(migrations.length >= 1)
  migrations.forEach((migration, index) => {
    assert.equal(migration.version, index + 1, `migration ${migration.name} is out of sequence`)
    assert.ok(migration.sql.trim().length > 0)
    assert.match(migration.checksum, /^[a-f0-9]{64}$/)
  })
})

test('enforces foreign keys and WAL configuration', () => {
  const db = freshDatabase()
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  assert.throws(() => db.prepare("INSERT INTO stock_movements (id,item_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at) VALUES ('x','missing-item','adjustment',1,1,0,'adjustment','x','2026-01-01')").run())
  db.close()
})

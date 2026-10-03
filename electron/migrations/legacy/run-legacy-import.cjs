const path = require('node:path')

async function runLegacyImportIfNeeded(database, app) {
  let legacyImport = { status: 'not_needed' }
  try {
    const hasReceipt = database.prepare("SELECT 1 FROM data_migrations WHERE migration_key='legacy-app-state-v1'").get()
    if (hasReceipt) return { status: 'already_migrated' }
    const legacyRow = database.prepare('SELECT payload FROM app_state WHERE id = 1').get()
    if (!legacyRow?.payload) return legacyImport
    const hasUsers = database.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0
    const hasBusinessRows = ['items', 'customers', 'suppliers', 'sales_orders', 'purchase_invoices']
      .some(table => database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n > 0)
    if (hasUsers || hasBusinessRows) return { status: 'skipped', reason: 'relational_data_present' }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(app.getPath('userData'), `repack-manager-pre-import-${stamp}.db`)
    await database.backup(backupPath)
    database.prepare('INSERT INTO phase0_copy_guard (id,source_path,created_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET source_path=excluded.source_path, created_at=excluded.created_at')
      .run(backupPath, new Date().toISOString())
    const { migrateDatabase } = require('./import-legacy.cjs')
    const report = migrateDatabase(database)
    legacyImport = { status: report.status, backupPath, report }
  } catch (error) {
    legacyImport = { status: 'failed', code: error.code || 'MIGRATION_FAILED', message: error.message, report: error.report || null }
    console.error('Legacy import failed:', error)
  }
  return legacyImport
}

module.exports = { runLegacyImportIfNeeded }

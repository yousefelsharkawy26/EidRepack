const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function seedDemoDatabase(database, ownerId) {
  const owner = database.prepare("SELECT * FROM users WHERE id=? AND role='owner' AND is_active=1").get(ownerId)
  if (!owner) throw new Error('تعذر إعداد مستخدم المالك لبيانات الاختبار')
  const now = new Date().toISOString()
  const date = now.slice(0, 10)
  let operation = 'clearing copied business data'
  const preserved = new Set(['schema_version', 'migration_checksums', 'units', 'unit_conversions'])
  database.pragma('foreign_keys = OFF')
  try {
    database.transaction(() => {
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
      for (const { name } of tables) {
        if (!preserved.has(name)) database.exec('DELETE FROM "' + name.replaceAll('"', '""') + '"')
      }
      operation = 'copying owner credentials'
      const columns = Object.keys(owner)
      database.prepare(`INSERT INTO users (${columns.map(name => '"' + name + '"').join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(name => owner[name]))
      operation = 'creating sample master data'
      const unit = database.prepare("SELECT id FROM units WHERE dimension='count' AND is_canonical=1 AND is_active=1 ORDER BY id LIMIT 1").get()
      if (!unit) throw new Error('لا توجد وحدة عدّ أساسية لإنشاء بيانات الاختبار')
      database.prepare('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?)').run('company_name', JSON.stringify('منشأة تجريبية'), now)
      database.prepare('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?)').run('company_phone', JSON.stringify(''), now)
      database.prepare('INSERT INTO settings(key,value,updated_at) VALUES (?,?,?)').run('default_credit_days', JSON.stringify(15), now)

      const ids = Object.fromEntries(['category', 'raw', 'packaging', 'finished', 'supplier', 'customer'].map(key => [key, crypto.randomUUID()]))
      database.prepare('INSERT INTO categories(id,name,parent_id,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(ids.category, 'أصناف تجريبية', null, 1, now, now)
      const addItem = database.prepare(`INSERT INTO items
        (id,sku,barcode,name,type,category_id,base_unit_id,legacy_unit_id,pack_size_base,min_stock_base,default_sale_price_minor,is_active,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,1,?,?)`)
      addItem.run(ids.raw, 'DEMO-RAW-001', null, 'خامة تجريبية', 'raw', ids.category, unit.id, 10, 0, now, now)
      addItem.run(ids.packaging, 'DEMO-PKG-001', null, 'عبوة تجريبية', 'packaging', ids.category, unit.id, 10, 0, now, now)
      addItem.run(ids.finished, 'DEMO-FIN-001', null, 'منتج تجريبي جاهز', 'finished', ids.category, unit.id, 5, 2500, now, now)
      database.prepare(`INSERT INTO suppliers(id,name,phone,whatsapp,address,default_credit_days,notes,is_active,created_at,updated_at)
        VALUES (?,?,?,?,?,0,?,1,?,?)`).run(ids.supplier, 'مورد تجريبي', '', '', '', 'بيانات اختبار فقط', now, now)
      database.prepare(`INSERT INTO customers(id,name,phone,whatsapp,credit_limit_minor,credit_days,is_blocked,block_reason,reminder_enabled,notes,is_active,created_at,updated_at)
        VALUES (?,?,?,?,?,15,0,NULL,1,?,1,?,?)`).run(ids.customer, 'عميل تجريبي', '', '', 100000, 'بيانات اختبار فقط', now, now)
      operation = 'creating sample stock'
      const addStock = database.prepare(`INSERT INTO stock_lots
        (id,item_id,source_type,source_id,lot_code,qty_initial_base,qty_remaining_base,cost_total_minor,cost_remaining_minor,received_at,expiry_date,is_active)
        VALUES (?,?, 'opening',NULL,?,?,?,?,?,?,NULL,1)`)
      const addMovement = database.prepare(`INSERT INTO stock_movements
        (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by,notes)
        VALUES (?,?,?,'opening',?,?,?,'demo-seed',?,?,?,?)`)
      for (const [itemId, code, quantity, cost] of [[ids.raw, 'DEMO-RAW-LOT', 100, 12000], [ids.packaging, 'DEMO-PKG-LOT', 100, 8000], [ids.finished, 'DEMO-FIN-LOT', 40, 24000]]) {
        const lotId = crypto.randomUUID()
        addStock.run(lotId, itemId, code, quantity, quantity, cost, cost, date)
        addMovement.run(crypto.randomUUID(), itemId, lotId, quantity, quantity, cost, lotId, now, ownerId, 'رصيد افتتاحي تجريبي')
      }
      database.prepare(`INSERT INTO audit_log(id,user_id,action,entity,entity_id,after_json,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(crypto.randomUUID(), ownerId, 'demo.seeded', 'system', 'demo', JSON.stringify({ sampleRecords: true }), now)
    }).immediate()
  } catch (error) {
    throw new Error(`تعذر إعداد البيانات التجريبية أثناء ${operation}: ${error.message}`, { cause: error })
  } finally {
    database.pragma('foreign_keys = ON')
  }
}

async function createDemoDatabase({ sourceDatabase, demoPath, ownerId, Database, configureDatabase, applyMigrations, ensureAppStateTable }) {
  if (fs.existsSync(demoPath)) return false
  fs.mkdirSync(path.dirname(demoPath), { recursive: true })
  const stagingPath = `${demoPath}.creating-${crypto.randomUUID()}`
  let demo
  try {
    await sourceDatabase.backup(stagingPath)
    demo = new Database(stagingPath)
    configureDatabase(demo)
    applyMigrations(demo)
    ensureAppStateTable(demo)
    seedDemoDatabase(demo, ownerId)
    demo.close()
    demo = null
    fs.renameSync(stagingPath, demoPath)
    return true
  } catch (error) {
    if (demo?.open) demo.close()
    for (const file of [stagingPath, `${stagingPath}-wal`, `${stagingPath}-shm`]) {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true })
    }
    throw error
  }
}

module.exports = { createDemoDatabase, seedDemoDatabase }

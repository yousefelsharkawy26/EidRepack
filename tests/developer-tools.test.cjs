const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const { registerDeveloperTools } = require('../electron/system/developer-tools.cjs')
const { createSystemLogs } = require('../electron/system/system-logs.cjs')

test('factory reset backs up first and preserves the active owner, settings, and reference data', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'repack-reset-test-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const db = new Database(':memory:')
  t.after(() => db.close())
  db.exec(`
    CREATE TABLE schema_version(version INTEGER PRIMARY KEY);
    CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,display_name TEXT,role TEXT,password_hash TEXT,pin_hash TEXT,is_active INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE units(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE unit_conversions(id TEXT PRIMARY KEY);
    CREATE TABLE reminder_rules(id TEXT PRIMARY KEY);
    CREATE TABLE reminder_templates(id TEXT PRIMARY KEY);
    CREATE TABLE backups_log(id TEXT PRIMARY KEY,path TEXT,size INTEGER,status TEXT,created_at TEXT);
    CREATE TABLE audit_log(id TEXT PRIMARY KEY,user_id TEXT,action TEXT,entity TEXT,entity_id TEXT,before_json TEXT,after_json TEXT,created_at TEXT);
    CREATE TABLE sales_orders(id TEXT PRIMARY KEY,number TEXT);
  `)
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run('owner-id','owner','Owner','owner','hash','pin',1,'2026-01-01','2026-01-01')
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)').run('staff-id','staff','Staff','sales','hash',null,1,'2026-01-01','2026-01-01')
  db.prepare('INSERT INTO settings VALUES (?,?,?)').run('company_name','"Example"','2026-01-01')
  db.prepare('INSERT INTO units VALUES (?,?)').run('kg','Kilogram')
  db.prepare('INSERT INTO sales_orders VALUES (?,?)').run('sale-id','INV-1')
  const handlers = new Map()
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) }
  const logs = createSystemLogs()
  registerDeveloperTools(ipcMain, {
    assertTrustedFrame() {}, getContext: () => ({ userId:'owner-id', role:'owner' }),
    getDatabase: () => db, dbPath: () => path.join(folder,'app.db'), BrowserWindow: { getAllWindows: () => [] }, logs,
  })
  const result = await handlers.get('devtools:factory-reset')({ sender:{} }, { confirmation:'RESET' })
  assert.match(result.backupName, /^before-factory-reset-/)
  assert.equal(fs.existsSync(path.join(folder,'backups',result.backupName)), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales_orders').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1)
  assert.equal(db.prepare('SELECT id FROM users').get().id, 'owner-id')
  assert.equal(db.prepare('SELECT value FROM settings WHERE key=?').get('company_name').value, '"Example"')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM units').get().n, 1)
  assert.equal(db.prepare("SELECT action FROM audit_log WHERE action='system.factory-reset'").get().action, 'system.factory-reset')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM backups_log').get().n, 1)
})

test('system log ring buffer limits entries and redacts credential-like values', () => {
  const logs = createSystemLogs()
  logs.record('warn', ['password=do-not-show'])
  assert.match(logs.list()[0].message, /password=\[redacted\]/)
  for (let index = 0; index < 510; index++) logs.record('info', ['event', index])
  assert.equal(logs.list().length, 500)
})

test('developer data-mode IPC validates and forwards the mode object', async () => {
  const handlers = new Map()
  let switched = null
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) }
  registerDeveloperTools(ipcMain, {
    assertTrustedFrame() {}, getContext: () => ({ userId: 'owner-id', role: 'owner' }),
    getDatabase: () => null, dbPath: () => '/tmp/app.db', BrowserWindow: { getAllWindows: () => [] },
    logs: createSystemLogs(), getDataMode: () => 'production',
    switchDataMode: async (mode, ownerId) => { switched = { mode, ownerId }; return { mode } }
  })
  const handler = handlers.get('devtools:set-data-mode')
  assert.deepEqual(await handler({ sender: {} }, { mode: 'demo' }), { mode: 'demo' })
  assert.deepEqual(switched, { mode: 'demo', ownerId: 'owner-id' })
  await assert.rejects(handler({ sender: {} }, 'demo'), /Invalid input: expected object/)
})

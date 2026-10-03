const { app, BrowserWindow, ipcMain, shell, dialog, session, protocol } = require('electron')
const fs = require('node:fs')
const path = require('path')
const Database = require('better-sqlite3')
const { z } = require('zod')
const { registerIpcHandlers } = require('./services/ipc.cjs')
const { applyMigrations, configureDatabase } = require('./migrations/runner.cjs')
const { createSecurity } = require('./security.cjs')
const { contentSecurityPolicy, getViteOrigin, isViteDevelopmentDocument } = require('./csp.cjs')
const { registerAppProtocol } = require('./app-protocol.cjs')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

let database
let security
let legacyImport = { status: 'not_needed' }
const dbPath = () => path.join(app.getPath('userData'), 'repack-manager.db')
const appFilePath = path.join(__dirname, '..', 'dist', 'index.html')
const whatsappPayloadSchema = z.tuple([z.string().trim().min(8).max(30), z.string().max(4000)])

function assertTrustedFrame(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('IPC is allowed only from the application main frame')
  const target = event.senderFrame.url
  const devUrl = !app.isPackaged ? getViteOrigin(process.env.VITE_DEV_SERVER_URL) : null
  if (isViteDevelopmentDocument({ isPackaged: app.isPackaged, documentUrl: target, devServerUrl: devUrl })) return
  if ((app.isPackaged || !devUrl) && target === 'app://renderer/index.html') return
  throw new Error('Untrusted IPC sender')
}

function ensureAppStateTable(db) {
  // Kept only so the legacy importer can read pre-Phase-B payloads; the
  // renderer no longer has any channel to read or write this table.
  db.exec(`CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
}

function initDatabase() {
  database = new Database(dbPath())
  configureDatabase(database)
  applyMigrations(database)
  ensureAppStateTable(database)
  security = createSecurity(database)
}

// Phase B: on the first open of an install that still carries a legacy
// app_state payload, back the database up, record the copy guard, then run the
// relational import automatically before any window is shown.
async function runLegacyImportIfNeeded() {
  legacyImport = { status: 'not_needed' }
  try {
    const hasReceipt = database.prepare("SELECT 1 FROM data_migrations WHERE migration_key='legacy-app-state-v1'").get()
    if (hasReceipt) { legacyImport = { status: 'already_migrated' }; return }
    const legacyRow = database.prepare('SELECT payload FROM app_state WHERE id = 1').get()
    if (!legacyRow?.payload) return
    const hasUsers = database.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0
    const hasBusinessRows = ['items', 'customers', 'suppliers', 'sales_orders', 'purchase_invoices']
      .some(table => database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n > 0)
    if (hasUsers || hasBusinessRows) {
      legacyImport = { status: 'skipped', reason: 'relational_data_present' }
      return
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(app.getPath('userData'), `repack-manager-pre-import-${stamp}.db`)
    await database.backup(backupPath)
    database.prepare('INSERT INTO phase0_copy_guard (id,source_path,created_at) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET source_path=excluded.source_path, created_at=excluded.created_at')
      .run(backupPath, new Date().toISOString())
    const { migrateDatabase } = require('./migrations/import-legacy.cjs')
    const report = migrateDatabase(database)
    legacyImport = { status: report.status, backupPath, report }
  } catch (error) {
    legacyImport = { status: 'failed', code: error.code || 'MIGRATION_FAILED', message: error.message, report: error.report || null }
    console.error('Legacy import failed:', error)
  }
}

function reopenDatabase() {
  if (database) database.close()
  initDatabase()
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    backgroundColor: '#f6f8f7',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  const url = !app.isPackaged ? getViteOrigin(process.env.VITE_DEV_SERVER_URL) : null
  window.webContents.on('will-navigate', (event, target) => {
    if (url ? !isViteDevelopmentDocument({ isPackaged: app.isPackaged, documentUrl: target, devServerUrl: url }) : target !== 'app://renderer/index.html') event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (url) window.loadURL(url)
  else window.loadURL('app://renderer/index.html')
}

app.whenReady().then(async () => {
  registerAppProtocol(protocol, path.dirname(appFilePath))
  initDatabase()
  await runLegacyImportIfNeeded()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: details.resourceType === 'mainFrame'
      ? {
          ...Object.fromEntries(Object.entries(details.responseHeaders).filter(([name]) => name.toLowerCase() !== 'content-security-policy')),
          'Content-Security-Policy': [contentSecurityPolicy({
            isPackaged: app.isPackaged,
            documentUrl: details.url,
            devServerUrl: process.env.VITE_DEV_SERVER_URL
          })]
        }
      : details.responseHeaders
  }))
  const getContext = event => { assertTrustedFrame(event); return security.context(event) }
  registerIpcHandlers(ipcMain, () => database, getContext, { invalidateUser: userId => security.invalidate(userId) })
  ipcMain.handle('auth:bootstrap', (event, payload) => { assertTrustedFrame(event); return security.bootstrap(payload) })
  ipcMain.handle('auth:login', (event, payload) => { assertTrustedFrame(event); return security.login(event.sender, payload) })
  ipcMain.handle('auth:logout', event => { assertTrustedFrame(event); return security.logout(event) })
  ipcMain.handle('auth:session', event => { assertTrustedFrame(event); return security.session(event) })
  ipcMain.handle('auth:status', event => {
    assertTrustedFrame(event)
    const needsBootstrap = database.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0
    return { needsBootstrap, legacyImport }
  })
  ipcMain.handle('security:elevate', (event, payload) => { assertTrustedFrame(event); return security.elevate(event, payload) })
  ipcMain.handle('backup:create', async event => {
    assertTrustedFrame(event)
    const target = await dialog.showSaveDialog({ defaultPath: 'repack-manager-backup-' + new Date().toISOString().slice(0, 10) + '.db', filters: [{ name: 'SQLite', extensions: ['db'] }] })
    if (target.canceled || !target.filePath) return false
    await database.backup(target.filePath)
    const size = fs.statSync(target.filePath).size
    database.prepare('INSERT INTO backups_log (id,path,size,status,created_at) VALUES (?,?,?,?,?)')
      .run(require('node:crypto').randomUUID(), target.filePath, size, 'created', new Date().toISOString())
    return target.filePath
  })
  ipcMain.handle('backup:restore', async event => {
    assertTrustedFrame(event)
    const picked = await dialog.showOpenDialog({ filters: [{ name: 'SQLite', extensions: ['db'] }], properties: ['openFile'] })
    if (picked.canceled || !picked.filePaths[0]) return false
    const source = path.resolve(picked.filePaths[0])
    if (source === path.resolve(dbPath())) throw new Error('لا يمكن استعادة ملف قاعدة البيانات النشط نفسه')
    const probe = new Database(source, { readonly: true, fileMustExist: true })
    try {
      const valid = probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('app_state','legacy_app_state','schema_version') LIMIT 1").get()
      if (!valid) throw new Error('الملف المختار ليس نسخة احتياطية صالحة لمدير التعبئة')
    } finally {
      probe.close()
    }
    const target = dbPath()
    if (database) database.close()
    for (const suffix of ['-wal', '-shm']) {
      const extra = target + suffix
      if (fs.existsSync(extra)) fs.rmSync(extra, { force: true })
    }
    fs.copyFileSync(source, target)
    initDatabase()
    return true
  })
  ipcMain.handle('whatsapp:open', (event, phone, message) => {
    assertTrustedFrame(event)
    const parsed = whatsappPayloadSchema.parse([phone, message])
    phone = parsed[0]
    message = parsed[1]
    const digits = phone.replace(/[^0-9]/g, '')
    if (digits.length < 8 || digits.length > 15) throw new Error('Invalid WhatsApp phone number')
    return shell.openExternal('https://wa.me/' + digits + '?text=' + encodeURIComponent(message))
  })
  // Printing from the packaged app: window.open is denied on the main window, so
  // invoices/statements are rendered in a hidden window owned by the main process.
  const printPayloadSchema = z.tuple([z.string().min(1).max(4 * 1024 * 1024)])
  ipcMain.handle('print:html', async (event, html) => {
    assertTrustedFrame(event)
    const [markup] = printPayloadSchema.parse([html])
    const printWindow = new BrowserWindow({ show: false, width: 980, height: 720, webPreferences: { sandbox: true, contextIsolation: true } })
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      await printWindow.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(markup, 'utf8').toString('base64'))
      await new Promise(resolve => printWindow.webContents.print({ printBackground: true }, () => resolve(null)))
      return true
    } catch {
      return false
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy()
    }
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch(error => {
  console.error('Application startup failed:', error)
  if (database?.open) {
    try {
      database.close()
    } catch (closeError) {
      console.error('Failed to close database after startup failure:', closeError)
    }
  }
  dialog.showErrorBox(
    'Application startup failed',
    `${error.message}\n\nDatabase: ${dbPath()}\n\nThe database was left in place. Restore a known-good backup or repair the migration history before retrying; do not delete the database if you need its data.`
  )
  app.quit()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

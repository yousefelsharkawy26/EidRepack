const { app, BrowserWindow, ipcMain, dialog, session, protocol, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { registerIpcHandlers } = require('./services/ipc.cjs')
const { applyMigrations, configureDatabase } = require('./migrations/runner.cjs')
const { runLegacyImportIfNeeded } = require('./migrations/legacy/run-legacy-import.cjs')
const { createSecurity } = require('./security.cjs')
const { contentSecurityPolicy, getViteOrigin, isViteDevelopmentDocument } = require('./csp.cjs')
const { registerAppProtocol } = require('./app-protocol.cjs')
const { createTrustedFrameGuard } = require('./system/trusted-frame.cjs')
const { createWindow } = require('./system/window.cjs')
const { registerBackupHandlers } = require('./system/backup.cjs')
const { registerWhatsAppHandler } = require('./system/whatsapp.cjs')
const { registerPrintHandler } = require('./system/print.cjs')
const { registerDeveloperTools } = require('./system/developer-tools.cjs')
const { createSystemLogs } = require('./system/system-logs.cjs')
const { createDemoDatabase } = require('./system/demo-data.cjs')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])

let database
let security
let demoMode = false
const systemLogs = createSystemLogs()
systemLogs.install()
let legacyImport = { status: 'not_needed' }
const productionDbPath = () => path.join(app.getPath('userData'), 'repack-manager.db')
const demoDbPath = () => path.join(app.getPath('userData'), 'repack-manager-demo.db')
const dataModePath = () => path.join(app.getPath('userData'), 'data-mode')
const dbPath = () => demoMode ? demoDbPath() : productionDbPath()
const appFilePath = path.join(__dirname, '..', 'dist', 'index.html')
const assertTrustedFrame = createTrustedFrameGuard({
  app, getViteOrigin, isViteDevelopmentDocument: isViteDevelopmentDocument
})

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

function persistDataMode(mode) {
  const target = dataModePath()
  const temporary = `${target}.tmp`
  fs.writeFileSync(temporary, mode, { mode: 0o600 })
  fs.renameSync(temporary, target)
}

async function switchDataMode(mode, ownerId) {
  if (mode === 'demo' && !fs.existsSync(demoDbPath())) {
    await createDemoDatabase({
      sourceDatabase: database,
      demoPath: demoDbPath(),
      ownerId,
      Database,
      configureDatabase,
      applyMigrations,
      ensureAppStateTable
    })
  }
  const previousMode = demoMode
  if ((mode === 'demo') === previousMode) return { mode }
  if (database?.open) database.close()
  try {
    demoMode = mode === 'demo'
    persistDataMode(demoMode ? 'demo' : 'production')
    initDatabase()
  } catch (error) {
    demoMode = previousMode
    if (database?.open) database.close()
    try {
      persistDataMode(demoMode ? 'demo' : 'production')
      initDatabase()
    } catch (restoreError) {
      console.error('Could not restore previous database after mode switch:', restoreError)
    }
    throw error
  }
  return { mode }
}

app.whenReady().then(async () => {
  registerAppProtocol(protocol, path.dirname(appFilePath))
  demoMode = fs.existsSync(dataModePath()) && fs.readFileSync(dataModePath(), 'utf8').trim() === 'demo'
  initDatabase()
  legacyImport = await runLegacyImportIfNeeded(database, app)
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
    return { needsBootstrap, legacyImport, dataMode: demoMode ? 'demo' : 'production' }
  })
  ipcMain.handle('security:elevate', (event, payload) => { assertTrustedFrame(event); return security.elevate(event, payload) })
  registerBackupHandlers(ipcMain, { assertTrustedFrame, dialog, getDatabase: () => database, dbPath, initDatabase })
  registerDeveloperTools(ipcMain, { assertTrustedFrame, getContext, getDatabase: () => database, dbPath, BrowserWindow, logs: systemLogs, getDataMode: () => demoMode ? 'demo' : 'production', switchDataMode })
  registerWhatsAppHandler(ipcMain, { assertTrustedFrame, shell })
  registerPrintHandler(ipcMain, { assertTrustedFrame, BrowserWindow, dialog })
  const openWindow = () => createWindow({
    app, BrowserWindow, getViteOrigin, isViteDevelopmentDocument: isViteDevelopmentDocument,
    preloadPath: path.join(__dirname, 'preload.cjs')
  })
  openWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) openWindow() })
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

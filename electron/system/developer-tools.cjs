const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { z } = require('zod')

const resetSchema = z.object({ confirmation: z.literal('RESET') }).strict()
const dataModeSchema = z.object({ mode: z.enum(['production', 'demo']) }).strict()

function requireOwner(event, assertTrustedFrame, getContext) {
  assertTrustedFrame(event)
  const context = getContext(event)
  if (context.role !== 'owner') throw new Error('Only an owner can access developer tools')
  return context
}

function registerDeveloperTools(ipcMain, { assertTrustedFrame, getContext, getDatabase, dbPath, BrowserWindow, logs, getDataMode, switchDataMode }) {
  ipcMain.handle('devtools:data-mode', event => {
    requireOwner(event, assertTrustedFrame, getContext)
    return getDataMode()
  })
  ipcMain.handle('devtools:set-data-mode', async (event, raw) => {
    const context = requireOwner(event, assertTrustedFrame, getContext)
    const { mode } = dataModeSchema.parse(raw)
    return switchDataMode(mode, context.userId)
  })
  ipcMain.handle('devtools:backups', event => {
    requireOwner(event, assertTrustedFrame, getContext)
    return getDatabase().prepare('SELECT path,size,status,created_at AS createdAt FROM backups_log ORDER BY created_at DESC LIMIT 200').all().map(row => ({ name: path.basename(row.path), size: row.size, status: row.status, createdAt: row.createdAt }))
  })
  ipcMain.handle('devtools:logs', event => {
    requireOwner(event, assertTrustedFrame, getContext)
    return logs.list()
  })
  ipcMain.handle('devtools:open-tools', event => {
    requireOwner(event, assertTrustedFrame, getContext)
    const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents === event.sender)
    if (!window) return false
    window.webContents.openDevTools({ mode: 'detach' })
    return true
  })
  ipcMain.handle('devtools:factory-reset', async (event, raw) => {
    const context = requireOwner(event, assertTrustedFrame, getContext)
    const { confirmation } = resetSchema.parse(raw)
    const database = getDatabase()
    const backupDirectory = path.join(path.dirname(dbPath()), 'backups')
    fs.mkdirSync(backupDirectory, { recursive: true })
    const backupPath = path.join(backupDirectory, 'before-factory-reset-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db')
    await database.backup(backupPath)
    const size = fs.statSync(backupPath).size
    database.prepare('INSERT INTO backups_log (id,path,size,status,created_at) VALUES (?,?,?,?,?)').run(crypto.randomUUID(), backupPath, size, 'factory-reset-safety', new Date().toISOString())
    const preserved = new Set(['schema_version', 'phase0_copy_guard', 'settings', 'users', 'units', 'unit_conversions', 'reminder_rules', 'reminder_templates', 'backups_log'])
    database.pragma('foreign_keys = OFF')
    try {
      const clear = database.transaction(() => {
        const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
        for (const { name } of tables) {
          if (preserved.has(name)) continue
          database.exec('DELETE FROM "' + name.replaceAll('"', '""') + '"')
        }
        database.prepare("DELETE FROM users WHERE id<>? OR role<>'owner'").run(context.userId)
        if (database.prepare('SELECT id FROM users WHERE id=? AND role=\'owner\' AND is_active=1').get(context.userId) === undefined) throw new Error('Current owner account could not be preserved')
        const now = new Date().toISOString()
        database.prepare('INSERT INTO audit_log (id,user_id,action,entity,entity_id,after_json,created_at) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(), context.userId, 'system.factory-reset', 'system', 'factory-reset', JSON.stringify({ safetyBackup: path.basename(backupPath), preserved: ['owner', 'settings'] }), now)
      })
      clear()
    } finally {
      database.pragma('foreign_keys = ON')
    }
    logs.record('warn', ['Business data reset; safety backup:', backupPath])
    return { backupName: path.basename(backupPath) }
  })
}

module.exports = { registerDeveloperTools, resetSchema, dataModeSchema }

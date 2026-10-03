const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Database = require('better-sqlite3')

function registerBackupHandlers(ipcMain, { assertTrustedFrame, dialog, getDatabase, dbPath, initDatabase }) {
  ipcMain.handle('backup:create', async event => {
    assertTrustedFrame(event)
    const database = getDatabase()
    const target = await dialog.showSaveDialog({ defaultPath: 'repack-manager-backup-' + new Date().toISOString().slice(0, 10) + '.db', filters: [{ name: 'SQLite', extensions: ['db'] }] })
    if (target.canceled || !target.filePath) return false
    await database.backup(target.filePath)
    const size = fs.statSync(target.filePath).size
    database.prepare('INSERT INTO backups_log (id,path,size,status,created_at) VALUES (?,?,?,?,?)')
      .run(crypto.randomUUID(), target.filePath, size, 'created', new Date().toISOString())
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
    const database = getDatabase()
    if (database) database.close()
    for (const suffix of ['-wal', '-shm']) {
      const extra = target + suffix
      if (fs.existsSync(extra)) fs.rmSync(extra, { force: true })
    }
    fs.copyFileSync(source, target)
    initDatabase()
    return true
  })
}

module.exports = { registerBackupHandlers }

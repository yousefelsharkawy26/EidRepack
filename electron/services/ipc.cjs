const { registry } = require('../core/registry.cjs')
const { dispatchCommand, dispatchQuery } = require('../core/dispatcher.cjs')

function registerIpcHandlers(ipcMain, getDatabase, getContext, options = {}) {
  ipcMain.handle('command:run', (event, raw) => dispatchCommand({
    registry,
    getDatabase,
    getContext: () => getContext(event),
    raw,
    invalidateUser: options.invalidateUser
  }))
  ipcMain.handle('query:run', (event, raw) => dispatchQuery({
    registry,
    getDatabase,
    getContext: () => getContext(event),
    raw
  }))
}

module.exports = { registerIpcHandlers }

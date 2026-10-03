const test = require('node:test')
const assert = require('node:assert/strict')
const { createWindow } = require('../electron/system/window.cjs')

test('main application window hides Electron menu bar', () => {
  let options
  let menuVisible
  class FakeWindow {
    constructor(value) { options = value; this.webContents = { on() {}, setWindowOpenHandler() {} } }
    setMenuBarVisibility(visible) { menuVisible = visible }
    loadURL() {}
  }

  createWindow({
    app: { isPackaged: true }, BrowserWindow: FakeWindow,
    getViteOrigin: () => null, isViteDevelopmentDocument: () => false,
    preloadPath: '/tmp/preload.cjs',
  })

  assert.equal(options.autoHideMenuBar, true)
  assert.equal(menuVisible, false)
})

const path = require('node:path')

function createWindow({ app, BrowserWindow, getViteOrigin, isViteDevelopmentDocument, preloadPath }) {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'assets', 'app-icon.png'),
    backgroundColor: '#f6f8f7',
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.setMenuBarVisibility(false)
  const url = !app.isPackaged ? getViteOrigin(process.env.VITE_DEV_SERVER_URL) : null
  window.webContents.on('will-navigate', (event, target) => {
    if (url ? !isViteDevelopmentDocument({ isPackaged: app.isPackaged, documentUrl: target, devServerUrl: url }) : target !== 'app://renderer/index.html') event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (url) window.loadURL(url)
  else window.loadURL('app://renderer/index.html')
  return window
}

module.exports = { createWindow }

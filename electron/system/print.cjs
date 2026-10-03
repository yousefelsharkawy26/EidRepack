const { z } = require('zod')

const printPayloadSchema = z.tuple([z.string().min(1).max(4 * 1024 * 1024)])

function registerPrintHandler(ipcMain, { assertTrustedFrame, BrowserWindow }) {
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
}

module.exports = { registerPrintHandler, printPayloadSchema }

const { z } = require('zod')
const fs = require('node:fs/promises')
const path = require('node:path')

const printPayloadSchema = z.tuple([
  z.string().min(1).max(4 * 1024 * 1024),
  z.object({ deviceName: z.string().max(256).optional(), color: z.boolean().optional(), copies: z.number().int().min(1).max(20).optional(), saveAsPdf: z.boolean().optional(), destination: z.enum(['printer', 'pdf', 'settings']).optional(), suggestedName: z.string().max(180).optional(), footerText: z.string().max(120).optional() }).optional()
])

function safePdfName(value) {
  const base = path.basename(value || 'تقرير.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return /\.pdf$/i.test(base) ? base : `${base || 'تقرير'}.pdf`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function isPrinterAvailable(printer) {
  const options = printer.options || {}
  const acceptingJobs = String(options['printer-is-accepting-jobs'] ?? '').toLowerCase()
  const state = String(options['printer-state'] ?? '')
  const reasons = String(options['printer-state-reasons'] ?? '').toLowerCase()
  return acceptingJobs !== 'false' && state !== '5' && !/(offline|disconnected|unavailable|paused|stopped|error)/.test(reasons)
}

function registerPrintHandler(ipcMain, { assertTrustedFrame, BrowserWindow, dialog, writeFile = fs.writeFile }) {
  ipcMain.handle('print:printers', async event => {
    assertTrustedFrame(event)
    const printers = await event.sender.getPrintersAsync()
    return printers.map(printer => ({ name: printer.name, displayName: printer.displayName, available: isPrinterAvailable(printer) }))
  })
  ipcMain.handle('print:html', async (event, html, options = {}) => {
    assertTrustedFrame(event)
    const [markup, settings] = printPayloadSchema.parse([html, options])
    if (settings?.deviceName && !settings.saveAsPdf) {
      const printers = await event.sender.getPrintersAsync()
      if (!printers.some(printer => printer.name === settings.deviceName)) throw new Error('Selected printer is not available')
    }
    if (settings?.saveAsPdf && !dialog?.showSaveDialog) throw new Error('PDF export is unavailable')
    const printWindow = new BrowserWindow({ show: false, width: 980, height: 720, webPreferences: { sandbox: true, contextIsolation: true } })
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      await printWindow.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(markup, 'utf8').toString('base64'))
      await printWindow.webContents.executeJavaScript(`Promise.race([Promise.all([document.fonts ? document.fonts.ready : Promise.resolve(), ...Array.from(document.images, image => image.decode ? image.decode().catch(() => {}) : Promise.resolve())]), new Promise(resolve => setTimeout(resolve, 15000))])`)
      if (settings?.saveAsPdf) {
        const choice = await dialog.showSaveDialog({ title: 'حفظ التقرير بصيغة PDF', defaultPath: safePdfName(settings.suggestedName), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
        if (choice.canceled || !choice.filePath) return false
        const footerText = escapeHtml(settings.footerText || 'تقرير مدير التعبئة')
        const pdf = await printWindow.webContents.printToPDF({
          pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
          displayHeaderFooter: true, margins: { top: 0.55, bottom: 0.62, left: 0.47, right: 0.47 },
          headerTemplate: '<div></div>',
          footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#444;direction:rtl;padding:0 12mm;display:flex;justify-content:space-between"><span>${footerText}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
        })
        await writeFile(choice.filePath, pdf)
        return true
      }
      await new Promise((resolve, reject) => printWindow.webContents.print({ printBackground: true, deviceName: settings?.deviceName, color: settings?.color, copies: settings?.copies }, (success, failureReason) => success ? resolve(null) : reject(new Error(failureReason || 'Printing failed'))))
      return true
    } catch {
      return false
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy()
    }
  })
}

module.exports = { registerPrintHandler, printPayloadSchema, isPrinterAvailable }

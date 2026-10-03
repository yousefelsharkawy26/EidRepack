const test = require('node:test')
const assert = require('node:assert/strict')
const { registerPrintHandler, isPrinterAvailable } = require('../electron/system/print.cjs')

test('printer listing and printing require a trusted frame and validate the selected printer', async () => {
  const handlers = new Map()
  const printOptions = []
  class FakeWindow {
    constructor() {
      this.webContents = {
        setWindowOpenHandler() {},
        executeJavaScript() { return Promise.resolve(true) },
        print(options, callback) { printOptions.push(options); callback(true) },
      }
    }
    loadURL() { return Promise.resolve() }
    isDestroyed() { return false }
    destroy() {}
  }
  registerPrintHandler({ handle: (name, handler) => handlers.set(name, handler) }, {
    assertTrustedFrame(event) { if (!event.trusted) throw new Error('Untrusted') },
    BrowserWindow: FakeWindow,
  })
  const event = { trusted: true, sender: { getPrintersAsync: async () => [{ name:'Office', displayName:'Office Printer', options: { 'printer-is-accepting-jobs': 'true', 'printer-state': '3' } }] } }
  assert.deepEqual(await handlers.get('print:printers')(event), [{ name:'Office', displayName:'Office Printer', available: true }])
  assert.equal(await handlers.get('print:html')(event, '<h1>Invoice</h1>', { deviceName:'Office', color:false, copies:2 }), true)
  assert.equal(printOptions[0].deviceName, 'Office')
  assert.equal(printOptions[0].copies, 2)
  await assert.rejects(handlers.get('print:html')(event, '<p>x</p>', { deviceName:'Missing' }), /Selected printer is not available/)
  await assert.rejects(handlers.get('print:printers')({ trusted:false, sender:event.sender }), /Untrusted/)
})

test('printer availability ignores system queues explicitly marked offline or stopped', () => {
  assert.equal(isPrinterAvailable({ options: { 'printer-state': '5' } }), false)
  assert.equal(isPrinterAvailable({ options: { 'printer-state-reasons': 'offline-report' } }), false)
  assert.equal(isPrinterAvailable({ options: { 'printer-is-accepting-jobs': 'false' } }), false)
  assert.equal(isPrinterAvailable({ options: {} }), true)
})

test('PDF export asks for a destination and saves the generated A4 document', async () => {
  const handlers = new Map()
  const saved = []
  const pdfOptions = []
  const dialogOptions = []
  class FakeWindow {
    constructor() {
      this.webContents = {
        setWindowOpenHandler() {},
        executeJavaScript() { return Promise.resolve(true) },
        async printToPDF(options) { pdfOptions.push(options); return Buffer.from('%PDF-test') },
      }
    }
    loadURL() { return Promise.resolve() }
    isDestroyed() { return false }
    destroy() {}
  }
  registerPrintHandler({ handle: (name, handler) => handlers.set(name, handler) }, {
    assertTrustedFrame(event) { if (!event.trusted) throw new Error('Untrusted') },
    BrowserWindow: FakeWindow,
    dialog: { async showSaveDialog(options) { dialogOptions.push(options); assert.equal(options.filters[0].extensions[0], 'pdf'); return { canceled: false, filePath: '/tmp/report.pdf' } } },
    async writeFile(path, data) { saved.push({ path, data: data.toString() }) },
  })
  const event = { trusted: true, sender: { getPrintersAsync: async () => [] } }
  assert.equal(await handlers.get('print:html')(event, '<h1>Report</h1>', { saveAsPdf: true, color: true, suggestedName: 'تقرير الفترة.pdf', footerText: 'RPT-20261003' }), true)
  assert.deepEqual(saved, [{ path: '/tmp/report.pdf', data: '%PDF-test' }])
  assert.equal(dialogOptions[0].defaultPath, 'تقرير الفترة.pdf')
  assert.equal(pdfOptions[0].pageSize, 'A4')
  assert.equal(pdfOptions[0].printBackground, true)
  assert.equal(pdfOptions[0].preferCSSPageSize, true)
  assert.equal(pdfOptions[0].displayHeaderFooter, true)
  assert.match(pdfOptions[0].footerTemplate, /RPT-20261003/)
})

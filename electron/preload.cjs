const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('repack', {
  auth: {
    bootstrap: payload => ipcRenderer.invoke('auth:bootstrap', payload),
    login: payload => ipcRenderer.invoke('auth:login', payload),
    logout: () => ipcRenderer.invoke('auth:logout'),
    session: () => ipcRenderer.invoke('auth:session'),
    status: () => ipcRenderer.invoke('auth:status')
  },
  elevate: payload => ipcRenderer.invoke('security:elevate', payload),
  command: (name, payload) => ipcRenderer.invoke('command:run', { name, payload }),
  query: (name, payload) => ipcRenderer.invoke('query:run', { name, payload }),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  openWhatsApp: (phone, message) => ipcRenderer.invoke('whatsapp:open', phone, message),
  getPrinters: () => ipcRenderer.invoke('print:printers'),
  printHtml: (html, options) => ipcRenderer.invoke('print:html', html, options),
  developerTools: {
    dataMode: () => ipcRenderer.invoke('devtools:data-mode'),
    setDataMode: mode => ipcRenderer.invoke('devtools:set-data-mode', { mode }),
    backups: () => ipcRenderer.invoke('devtools:backups'),
    logs: () => ipcRenderer.invoke('devtools:logs'),
    factoryReset: payload => ipcRenderer.invoke('devtools:factory-reset', payload),
    openTools: () => ipcRenderer.invoke('devtools:open-tools')
  }
})

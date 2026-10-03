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
  printHtml: html => ipcRenderer.invoke('print:html', html)
})

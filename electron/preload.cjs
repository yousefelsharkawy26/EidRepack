const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('repack', {
  auth: {
    bootstrap: (payload) => ipcRenderer.invoke('auth:bootstrap', payload),
    login: (payload) => ipcRenderer.invoke('auth:login', payload),
    logout: () => ipcRenderer.invoke('auth:logout'),
    session: () => ipcRenderer.invoke('auth:session'),
    status: () => ipcRenderer.invoke('auth:status')
  },
  elevate: (payload) => ipcRenderer.invoke('security:elevate', payload),
  queries: {
    snapshot: () => ipcRenderer.invoke('query:snapshot'),
    inventoryMovements: (payload) => ipcRenderer.invoke('query:inventory:movements', payload),
    auditLog: (payload) => ipcRenderer.invoke('query:audit:list', payload),
    messageLog: (payload) => ipcRenderer.invoke('query:messages:list', payload),
    invoices: (payload) => ipcRenderer.invoke('query:invoices:list', payload)
  },
  operations: {
    confirmPurchase: (payload) => ipcRenderer.invoke('operation:purchase:confirm', payload),
    returnPurchase: (payload) => ipcRenderer.invoke('operation:purchase:return', payload),
    confirmPacking: (payload) => ipcRenderer.invoke('operation:packing:confirm', payload),
    cancelPacking: (payload) => ipcRenderer.invoke('operation:packing:cancel', payload),
    confirmSale: (payload) => ipcRenderer.invoke('operation:sale:confirm', payload),
    recordCollection: (payload) => ipcRenderer.invoke('operation:customer:collect', payload),
    reversePayment: (payload) => ipcRenderer.invoke('operation:payment:reverse', payload),
    returnSale: (payload) => ipcRenderer.invoke('operation:sale:return', payload),
    adjustStock: (payload) => ipcRenderer.invoke('operation:inventory:adjust', payload),
    createOpeningStock: (payload) => ipcRenderer.invoke('operation:inventory:opening', payload),
    recordPromise: (payload) => ipcRenderer.invoke('operation:customer:promise', payload),
    recordSupplierPayment: (payload) => ipcRenderer.invoke('operation:supplier:pay', payload),
    writeOffSale: (payload) => ipcRenderer.invoke('operation:customer:writeoff', payload),
    savePurchaseDraft: (payload) => ipcRenderer.invoke('operation:purchase-draft:save', payload),
    deletePurchaseDraft: (payload) => ipcRenderer.invoke('operation:purchase-draft:delete', payload),
    updateReminder: (payload) => ipcRenderer.invoke('operation:reminder:update', payload),
    saveReminderRule: (payload) => ipcRenderer.invoke('operation:reminder-rule:save', payload),
    saveReminderTemplate: (payload) => ipcRenderer.invoke('operation:reminder-template:save', payload),
    saveCustomer: (payload) => ipcRenderer.invoke('operation:customer:save', payload),
    saveSupplier: (payload) => ipcRenderer.invoke('operation:supplier:save', payload),
    saveItem: (payload) => ipcRenderer.invoke('operation:item:save', payload),
    saveRecipe: (payload) => ipcRenderer.invoke('operation:recipe:save', payload),
    saveUser: (payload) => ipcRenderer.invoke('operation:user:save', payload),
    saveSetting: (payload) => ipcRenderer.invoke('operation:settings:save', payload)
  },
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  openWhatsApp: (phone, message) => ipcRenderer.invoke('whatsapp:open', phone, message),
  printHtml: (html) => ipcRenderer.invoke('print:html', html)
})

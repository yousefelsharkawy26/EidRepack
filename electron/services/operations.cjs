const sales = require('../modules/sales/index.cjs')
const purchases = require('../modules/purchases/index.cjs')
const packing = require('../modules/packing/index.cjs')
const inventory = require('../modules/inventory/index.cjs')
const customers = require('../modules/customers/index.cjs')
const suppliers = require('../modules/suppliers/index.cjs')
const collections = require('../modules/collections/index.cjs')
const reminders = require('../modules/reminders/index.cjs')
const settings = require('../modules/settings/index.cjs')
const users = require('../modules/users/index.cjs')
const shared = require('../core/shared.cjs')
const { checkInvariants } = require('../core/invariants.cjs')

module.exports = {
  confirmSale: sales.confirmSale,
  returnSale: sales.returnSale,
  syncSaleStatus: sales.syncSaleStatus,
  outstandingOfSale: sales.outstandingOfSale,
  confirmPurchase: purchases.confirmPurchase,
  returnPurchase: purchases.returnPurchase,
  savePurchaseDraft: purchases.savePurchaseDraft,
  deletePurchaseDraft: purchases.deletePurchaseDraft,
  confirmPacking: packing.confirmPacking,
  cancelPacking: packing.cancelPacking,
  adjustStock: inventory.adjustStock,
  createOpeningStock: inventory.createOpeningStock,
  saveItem: inventory.saveItem,
  saveRecipe: inventory.saveRecipe,
  saveCustomer: customers.saveCustomer,
  saveSupplier: suppliers.saveSupplier,
  recordSupplierPayment: suppliers.recordSupplierPayment,
  recordCollection: collections.recordCollection,
  recordPromise: collections.recordPromise,
  reversePayment: collections.reversePayment,
  writeOffSale: collections.writeOffSale,
  recordReminderRows: reminders.recordReminderRows,
  updateReminder: reminders.updateReminder,
  saveReminderRule: reminders.saveReminderRule,
  saveReminderTemplate: reminders.saveReminderTemplate,
  saveSetting: settings.saveSetting,
  saveUser: users.saveUser,
  checkInvariants,
  roundHalfUp: shared.roundHalfUp,
  settingValue: shared.settingValue
}

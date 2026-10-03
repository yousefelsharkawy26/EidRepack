import type { AppState } from "../../lib/domain";
import type { Snapshot } from "./snapshot-types";
import { mapCustomerAdjustments, mapCustomerOpenings, mapCustomers } from "../../features/customers/mappers";
import { mapCustomerPayments, mapPromises, mapRefunds, mapSupplierPayments } from "../../features/collections/mappers";
import { mapItems, mapLots, mapStockLedger } from "../../features/inventory/mappers";
import { mapPackings } from "../../features/packing/mappers";
import { mapPurchaseDrafts, mapPurchaseReturns, mapPurchases } from "../../features/purchases/mappers";
import { mapSales, mapSalesReturns } from "../../features/sales/mappers";
import { mapMessageLog, mapMessageTemplates, mapReminderRules, mapReminders } from "../../features/reminders/mappers";
import { mapSupplierOpenings, mapSuppliers } from "../../features/suppliers/mappers";
import { itemFactors } from "./mapping";
import { activityFromAudit, mapAuditLog, mapUsers } from "./snapshot-derived-mappers";

export function mapSnapshot(snapshot: Snapshot): AppState {
  const factor = itemFactors(snapshot.items);
  const items = mapItems(snapshot.items, factor);
  return {
    items, customers: mapCustomers(snapshot.customers), suppliers: mapSuppliers(snapshot.suppliers),
    sales: mapSales(snapshot.sales, factor), purchases: mapPurchases(snapshot.purchases, factor),
    purchaseDrafts: mapPurchaseDrafts(snapshot.purchaseDrafts, factor), packings: mapPackings(snapshot.packings, items),
    lots: mapLots(snapshot.lots, factor), reminders: mapReminders(snapshot.reminders),
    reminderRules: mapReminderRules(snapshot.reminderRules), messageTemplates: mapMessageTemplates(snapshot.messageTemplates),
    promises: mapPromises(snapshot.promises), customerPayments: mapCustomerPayments(snapshot.payments),
    supplierPayments: mapSupplierPayments(snapshot.payments), refunds: mapRefunds(snapshot.refunds),
    salesReturns: mapSalesReturns(snapshot, factor), purchaseReturns: mapPurchaseReturns(snapshot, factor),
    stockLedger: mapStockLedger(snapshot.stockMovements, factor), messageLog: mapMessageLog(snapshot.messageLog),
    auditLog: mapAuditLog(snapshot.auditLog), customerOpenings: [...mapCustomerOpenings(snapshot.customerOpenings), ...mapCustomerAdjustments(snapshot.customerAdjustments)],
    supplierOpenings: mapSupplierOpenings(snapshot.supplierOpenings), users: mapUsers(snapshot.users),
    activity: activityFromAudit(snapshot.auditLog),
    settings: {
      companyName: snapshot.settings.companyName, companyPhone: snapshot.settings.companyPhone,
      defaultCreditDays: snapshot.settings.defaultCreditDays, costingMethod: snapshot.settings.costingMethod,
    },
    nextNumbers: snapshot.nextNumbers, today: snapshot.today,
  };
}

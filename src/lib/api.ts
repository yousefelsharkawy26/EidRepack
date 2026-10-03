// Typed bridge between the renderer and the Electron main process.
// Phase B rule: the UI never stores business state; every mutation is an
// operation call, and every read is a fresh snapshot from SQLite.
//
// Conversion boundary (the ONLY place floats meet integers):
//   money:   EGP in the UI  <-> integer piasters (`*Minor`) in the backend
//   amounts: display units  <-> integer base units (`*Base`) via item factor
import {
  AppState, AuditEntry, Customer, CustomerPayment, CustomerRefund, Item, MessageLog, MessageTemplate,
  OpeningEntry, Packing, PromiseToPay, Purchase, PurchaseDraft, PurchaseReturn, Reminder, ReminderRule,
  Sale, SalesReturn, StockLot, StockMovement, Supplier, SupplierPayment, User, UserRole
} from './domain'
import { run as runCommand, type CommandName } from '../shared/api/commands'
import type { Screen } from './types'

export interface SessionUser {
  id: string
  username: string
  displayName: string
  role: UserRole
  permissions: { commands: string[]; screens: Screen[] }
}

export interface AuthStatus {
  needsBootstrap: boolean
  legacyImport: { status: string; code?: string; message?: string; backupPath?: string }
}

interface RepackBridge {
  auth: {
    bootstrap: (payload: { username: string; displayName: string; password: string; pin: string }) => Promise<SessionUser>
    login: (payload: { username: string; password: string }) => Promise<SessionUser>
    logout: () => Promise<boolean>
    session: () => Promise<SessionUser>
    status: () => Promise<AuthStatus>
  }
  elevate: (payload: { pin: string; scope: 'inventory-adjustment' | 'customer-credit' }) => Promise<{ scope: string; expiresInSeconds: number }>
  command: (name: string, payload: Record<string, unknown>) => Promise<{ ok: boolean; data: unknown }>
  query: (name: string, payload?: Record<string, unknown>) => Promise<any>
  createBackup: () => Promise<string | false>
  restoreBackup: () => Promise<boolean>
  openWhatsApp: (phone: string, message: string) => Promise<void>
  printHtml: (html: string) => Promise<boolean>
}

declare global {
  interface Window { repack?: RepackBridge }
}

export function bridge(): RepackBridge {
  if (!window.repack) throw new Error('واجهة النظام غير متاحة؛ هذا الإصدار يعمل فقط داخل تطبيق سطح المكتب.')
  return window.repack
}

// Electron wraps handler errors as "Error invoking remote method '…': Error: …".
export function ipcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const match = raw.match(/Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]+)$/)
  return (match ? match[1] : raw).trim() || 'حدث خطأ غير متوقع'
}

export const toMinor = (egp: number) => {
  if (!Number.isFinite(egp)) throw new Error('مبلغ غير صالح')
  return Math.round(egp * 100)
}
export const toEgp = (minor: number) => minor / 100
export const toBase = (displayQty: number, factor: number) => Math.round(displayQty * factor)
export const toDisplay = (baseQty: number, factor: number) => baseQty / factor

const legacyCommandNames: Record<string, CommandName> = {
  confirmPurchase: 'purchase:confirm', returnPurchase: 'purchase:return', confirmPacking: 'packing:confirm',
  cancelPacking: 'packing:cancel', confirmSale: 'sale:confirm', recordCollection: 'customer:collect',
  reversePayment: 'payment:reverse', returnSale: 'sale:return', adjustStock: 'inventory:adjust',
  createOpeningStock: 'inventory:opening', recordPromise: 'customer:promise',
  recordSupplierPayment: 'supplier:pay', writeOffSale: 'customer:writeoff',
  savePurchaseDraft: 'purchase-draft:save', deletePurchaseDraft: 'purchase-draft:delete',
  updateReminder: 'reminder:update', saveReminderRule: 'reminder-rule:save',
  saveReminderTemplate: 'reminder-template:save', saveCustomer: 'customer:save',
  saveSupplier: 'supplier:save', saveItem: 'item:save', saveRecipe: 'recipe:save',
  saveUser: 'user:save', saveSetting: 'settings:save'
}

/** @deprecated Use run from shared/api/commands with a channel name. */
export async function callOperation(name: string, payload: Record<string, unknown>): Promise<any> {
  const command = legacyCommandNames[name]
  if (!command) throw new Error(`Unknown operation: ${name}`)
  return runCommand(command, payload as never)
}

// ---------- Snapshot shapes (integer piasters / base units) ----------

interface SnapshotItem {
  id: string; sku: string; name: string; type: Item['type']
  unit: { label: string; factor: number }
  stockBase: number; minStockBase: number
  unitCostBaseMinor?: number; salePriceBaseMinor?: number
  isActive: boolean
  recipe: { itemId: string; qtyPerUnitBase: number; kind: 'raw' | 'packaging' }[]
}

interface Snapshot {
  generatedAt: string
  today: string
  settings: { companyName: string; companyPhone: string; currency: string; costingMethod: 'FIFO' | 'WAVG'; defaultCreditDays: number }
  users: { id: string; username: string; display_name: string; role: UserRole; is_active: number }[]
  items: SnapshotItem[]
  customers: any[]
  customerOpenings: any[]
  customerAdjustments: any[]
  suppliers: any[]
  supplierOpenings: any[]
  sales: any[]
  purchases: any[]
  purchaseDrafts: any[]
  packings: any[]
  lots: any[]
  reminders: any[]
  reminderRules: any[]
  messageTemplates: any[]
  promises: any[]
  payments: any[]
  refunds: any[]
  returns: any[]
  stockMovements: any[]
  messageLog: any[]
  auditLog: any[]
  nextNumbers: AppState['nextNumbers']
}

function activityFromAudit(audit: Snapshot['auditLog']): AppState['activity'] {
  const titles: [RegExp, { title: string; type: 'sale' | 'packing' | 'purchase' | 'payment' }][] = [
    [/sale|بيع|فاتورة بيع/i, { title: 'حركة مبيعات', type: 'sale' }],
    [/packing|تعبئة/i, { title: 'أمر تعبئة', type: 'packing' }],
    [/purchase|شراء/i, { title: 'حركة مشتريات', type: 'purchase' }],
    [/payment|collect|دفع|تحصيل/i, { title: 'حركة مالية', type: 'payment' }]
  ]
  return audit.slice(0, 8).map(entry => {
    const found = titles.find(([pattern]) => pattern.test(entry.action))
    return {
      id: entry.id,
      title: entry.action,
      detail: `${entry.userName || 'النظام'} · ${entry.entity} ${entry.entityId || ''}`.trim(),
      at: entry.at,
      type: found ? found[1].type : 'payment'
    }
  })
}

export function mapSnapshot(snapshot: Snapshot): AppState {
  const factors = new Map<string, number>(snapshot.items.map(item => [item.id, item.unit.factor || 1]))
  const factor = (itemId: string) => factors.get(itemId) || 1
  const items: Item[] = snapshot.items.map(item => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    type: item.type,
    baseUnit: item.unit.label,
    unitFactor: item.unit.factor,
    stock: toDisplay(item.stockBase, item.unit.factor),
    minStock: toDisplay(item.minStockBase, item.unit.factor),
    unitCost: item.unitCostBaseMinor != null ? toEgp(item.unitCostBaseMinor) * item.unit.factor : 0,
    salePrice: item.salePriceBaseMinor != null ? toEgp(item.salePriceBaseMinor) * item.unit.factor : 0,
    active: item.isActive,
    recipe: item.recipe.map(line => ({
      itemId: line.itemId,
      qty: toDisplay(line.qtyPerUnitBase, factor(line.itemId)),
      kind: line.kind
    }))
  }))
  const customers: Customer[] = snapshot.customers.map(row => ({
    id: row.id, name: row.name, phone: row.phone, whatsapp: row.whatsapp,
    creditLimit: toEgp(row.creditLimitMinor), balance: toEgp(row.balanceMinor),
    creditDays: row.creditDays, blocked: row.isBlocked, blockReason: row.blockReason,
    notes: row.notes || undefined, active: row.isActive
  }))
  const suppliers: Supplier[] = snapshot.suppliers.map(row => ({
    id: row.id, name: row.name, phone: row.phone, whatsapp: row.whatsapp || undefined,
    address: row.address || undefined, notes: row.notes || undefined,
    creditDays: row.creditDays, balance: toEgp(row.balanceMinor), active: row.isActive
  }))
  const sales: Sale[] = snapshot.sales.map(row => ({
    id: row.id, number: row.number, customerId: row.customerId, date: row.date,
    dueDate: row.dueDate || undefined, status: row.status,
    total: toEgp(row.totalMinor), paid: toEgp(row.paidMinor),
    notes: row.notes || undefined,
    creditOverrideBy: row.creditOverrideBy, creditOverrideReason: row.creditOverrideReason,
    lines: (row.lines || []).map((line: any) => ({
      id: line.id, itemId: line.itemId,
      qty: toDisplay(line.qtyBase, factor(line.itemId)),
      price: line.qtyBase > 0 ? toEgp(line.lineTotalMinor ?? line.unitPriceBaseMinor * line.qtyBase) / toDisplay(line.qtyBase, factor(line.itemId)) : 0,
      cost: line.qtyBase > 0 ? toEgp(line.cogsTotalMinor ?? line.unitCostBaseMinor * line.qtyBase) / toDisplay(line.qtyBase, factor(line.itemId)) : 0
    }))
  }))
  const purchases: Purchase[] = snapshot.purchases.map(row => ({
    id: row.id, number: row.number, supplierId: row.supplierId, date: row.date,
    dueDate: row.dueDate || undefined, status: row.status,
    total: toEgp(row.totalMinor), paid: toEgp(row.paidMinor), extraCosts: toEgp(row.extraCostsMinor || 0),
    supplierInvoiceNumber: row.supplierInvoiceNumber || undefined,
    itemId: row.itemId || undefined,
    quantity: row.itemId ? toDisplay(row.qtyBase, factor(row.itemId)) : 0,
    unitCost: row.itemId && row.qtyBase > 0 ? toEgp(row.landedCostTotalMinor) / toDisplay(row.qtyBase, factor(row.itemId)) : 0,
    lotId: row.lotId || undefined
  }))
  const purchaseDrafts: PurchaseDraft[] = snapshot.purchaseDrafts.map(row => ({
    id: row.id, number: row.number, supplierId: row.supplierId, itemId: row.itemId, date: row.date,
    supplierInvoiceNumber: row.supplierInvoiceNumber || undefined, dueDate: row.dueDate || undefined,
    quantity: toDisplay(row.qtyBase, factor(row.itemId)),
    unitPrice: toEgp(row.unitPriceBaseMinor) * factor(row.itemId),
    extraCosts: toEgp(row.extraCostsMinor), paid: toEgp(row.paidMinor)
  }))
  const rawFactorOf = (itemId: string) => {
    const rawLine = items.find(item => item.id === itemId)?.recipe?.find(line => line.kind === 'raw')
    return rawLine ? factor(rawLine.itemId) : 1
  }
  const packings: Packing[] = snapshot.packings.map(row => ({
    id: row.id, number: row.number, date: row.date, itemId: row.itemId,
    units: row.producedUnits, waste: toDisplay(row.wasteQtyBase || 0, rawFactorOf(row.itemId)),
    unitCost: toEgp(row.unitCostMinor || 0), status: row.status, notes: row.notes || undefined
  }))
  const lots: StockLot[] = snapshot.lots.map(row => ({
    id: row.id, itemId: row.itemId, code: row.code,
    quantity: toDisplay(row.qtyBase, factor(row.itemId)),
    initialQuantity: toDisplay(row.qtyInitialBase, factor(row.itemId)),
    unitCost: row.qtyInitialBase > 0 ? toEgp(row.costTotalMinor) / toDisplay(row.qtyInitialBase, factor(row.itemId)) : 0,
    receivedAt: row.receivedAt, expiryDate: row.expiryDate || undefined,
    source: row.source, active: row.isActive
  }))
  const reminders: Reminder[] = snapshot.reminders.map(row => ({
    id: row.id, saleId: row.saleId, customerId: row.customerId, ruleId: row.ruleId || undefined,
    templateId: row.templateId || undefined, scheduledFor: row.scheduledFor, stage: row.stage,
    status: row.status, sentAt: row.sentAt || undefined
  }))
  const reminderRules: ReminderRule[] = snapshot.reminderRules.map(row => ({
    id: row.id, name: row.name, offsetDays: row.offsetDays, stage: row.stage,
    templateId: row.templateId || '', active: row.isActive
  }))
  const messageTemplates: MessageTemplate[] = snapshot.messageTemplates.map(row => ({ id: row.id, name: row.name, stage: row.stage, body: row.body }))
  const promises: PromiseToPay[] = snapshot.promises.map(row => ({
    id: row.id, saleId: row.saleId, customerId: row.customerId, promisedDate: row.promisedDate,
    amount: toEgp(row.amountMinor), notes: row.notes || '', status: row.status
  }))
  const customerPayments: CustomerPayment[] = snapshot.payments
    .filter(row => row.partyType === 'customer' && !row.isReversed)
    .map(row => ({
      id: row.id, customerId: row.customerId,
      saleId: row.allocations?.[0]?.saleId || '',
      amount: toEgp(row.amountMinor), date: row.date, method: row.method,
      note: row.notes || '', reversed: false
    }))
  const supplierPayments: SupplierPayment[] = snapshot.payments
    .filter(row => row.partyType === 'supplier' && !row.isReversed && row.notes !== 'دفعة عند اعتماد الفاتورة')
    .map(row => ({
      id: row.id, supplierId: row.supplierId, amount: toEgp(row.amountMinor), date: row.date,
      method: row.method, reference: row.reference || '', note: row.notes || ''
    }))
  const refunds: CustomerRefund[] = snapshot.refunds.map(row => ({
    id: row.id, customerId: row.customerId, saleId: row.saleId || undefined,
    amount: toEgp(row.amountMinor), date: row.date, method: row.method, notes: row.notes || undefined
  }))
  const salesReturns: SalesReturn[] = snapshot.returns
    .filter(row => row.type === 'sales')
    .flatMap(row => (row.lines || []).map((line: any) => ({
      id: row.id, number: row.number, saleId: row.saleId,
      customerId: snapshot.sales.find((sale: any) => sale.id === row.saleId)?.customer_id || '',
      itemId: line.itemId,
      quantity: toDisplay(line.qtyBase, factor(line.itemId)),
      value: toEgp(line.valueMinor), cost: toEgp(line.costMinor || 0),
      date: row.date, reason: row.reason || '', originalSalesLineId: line.originalSalesLineId || undefined
    })))
  const purchaseReturns: PurchaseReturn[] = snapshot.returns
    .filter(row => row.type === 'purchase')
    .flatMap(row => (row.lines || []).map((line: any) => ({
      id: row.id, number: row.number, purchaseId: row.purchaseId,
      supplierId: snapshot.purchases.find((purchase: any) => purchase.id === row.purchaseId)?.supplier_id || '',
      itemId: line.itemId,
      quantity: toDisplay(line.qtyBase, factor(line.itemId)),
      value: toEgp(line.valueMinor), date: row.date, reason: row.reason || ''
    })))
  const stockLedger: StockMovement[] = snapshot.stockMovements.map(row => ({
    id: row.id, at: row.createdAt, itemId: row.itemId, lotId: row.lotId || undefined,
    type: row.type, quantityChange: toDisplay(row.qtyBase, factor(row.itemId)),
    balanceAfter: toDisplay(row.balanceAfterBase, factor(row.itemId)),
    unitCost: row.costMinor != null && row.qtyBase ? toEgp(row.costMinor) / Math.abs(toDisplay(row.qtyBase, factor(row.itemId)) || 1) : 0,
    reference: row.refId || row.refType || '', note: row.notes || '', userId: row.createdBy || ''
  }))
  const messageLog: MessageLog[] = snapshot.messageLog.map(row => ({
    id: row.id, reminderId: row.reminderId || '', customerId: row.customerId || '',
    body: row.body, status: row.status === 'failed' ? 'failed' : 'sent', createdAt: row.createdAt
  }))
  const auditLog: AuditEntry[] = snapshot.auditLog.map(row => ({
    id: row.id, at: row.at, userId: row.userId || '', userName: row.userName,
    action: row.action, entity: row.entity, entityId: row.entityId || '', detail: row.entityId || ''
  }))
  const mapOpening = (row: any): OpeningEntry => ({
    id: row.id, partyId: row.customer_id ?? row.supplier_id, amount: toEgp(row.balance_delta_minor),
    date: row.effective_date, dueDate: row.due_date, notes: row.notes || undefined
  })
  return {
    items, customers, suppliers, sales, purchases, purchaseDrafts, packings, lots,
    reminders, reminderRules, messageTemplates, promises, customerPayments, supplierPayments,
    refunds, salesReturns, purchaseReturns, stockLedger, messageLog, auditLog,
    customerOpenings: [...snapshot.customerOpenings.map(mapOpening), ...snapshot.customerAdjustments.map(mapOpening)],
    supplierOpenings: snapshot.supplierOpenings.map(mapOpening),
    users: snapshot.users.map((row): User => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, active: Boolean(row.is_active) })),
    activity: activityFromAudit(snapshot.auditLog),
    settings: {
      companyName: snapshot.settings.companyName, companyPhone: snapshot.settings.companyPhone,
      defaultCreditDays: snapshot.settings.defaultCreditDays, costingMethod: snapshot.settings.costingMethod
    },
    nextNumbers: snapshot.nextNumbers,
    today: snapshot.today
  }
}

export async function loadSnapshot(): Promise<AppState> {
  const response = await bridge().query('query:snapshot')
  return mapSnapshot(response.snapshot)
}

// Helper: display-unit price per base unit is not always an integer number of
// piasters (e.g. 42 EGP/kg = 4.2 piasters/gram), so sale lines carry their
// authoritative total and the backend derives the stored unit price from it.
export function saleLinePayload(line: { itemId: string; qty: number; price: number }, items: Item[]) {
  const item = items.find(candidate => candidate.id === line.itemId)
  const factorValue = item?.unitFactor || 1
  const qtyBase = toBase(line.qty, factorValue)
  return { itemId: line.itemId, quantity: qtyBase, lineTotalMinor: toMinor(line.qty * line.price) }
}

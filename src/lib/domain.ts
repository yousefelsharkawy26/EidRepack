// Domain types and pure presentation helpers for the renderer.
// Phase B: no persistence, no credentials, no seed data here — the SQLite
// backend is the single source of truth and this module only shapes its
// snapshot for display (EGP floats and display units).

export type ItemType = 'raw' | 'packaging' | 'finished'
export type UserRole = 'owner' | 'sales' | 'warehouse' | 'purchasing'

export interface ItemUnit {
  label: string
  factor: number // base units per one display unit
}

export interface Item {
  id: string
  name: string
  sku: string
  type: ItemType
  baseUnit: string // display label (كجم، عبوة…)
  unitFactor: number
  stock: number
  minStock: number
  unitCost: number
  salePrice: number
  active?: boolean
  recipe?: RecipeLine[]
}

export interface RecipeLine {
  itemId: string
  qty: number
  kind: 'raw' | 'packaging'
}

export interface Customer {
  id: string
  name: string
  phone: string
  whatsapp: string
  creditLimit: number
  balance: number
  creditDays: number
  blocked?: boolean
  blockReason?: string
  address?: string
  notes?: string
  active?: boolean
}

export interface Supplier {
  id: string
  name: string
  phone: string
  balance: number
  whatsapp?: string
  address?: string
  notes?: string
  creditDays?: number
  active?: boolean
}

export interface Sale {
  id: string
  number: string
  customerId: string
  date: string
  dueDate?: string
  total: number
  paid: number
  status: 'draft' | 'confirmed' | 'partial' | 'paid' | 'overdue' | 'cancelled'
  notes?: string
  creditOverrideBy?: string | null
  creditOverrideReason?: string | null
  lines: { id?: string; itemId: string; qty: number; price: number; cost: number }[]
}

export interface Purchase {
  id: string
  number: string
  supplierId: string
  date: string
  total: number
  paid: number
  extraCosts: number
  supplierInvoiceNumber?: string
  dueDate?: string
  itemId?: string
  quantity?: number
  unitCost?: number
  lotId?: string
}

export interface PurchaseDraft {
  id: string
  number: string
  supplierId: string
  date: string
  supplierInvoiceNumber?: string
  dueDate?: string
  itemId: string
  quantity: number
  unitPrice: number
  extraCosts: number
  paid: number
}

export interface PurchaseReturn {
  id: string
  number: string
  purchaseId: string
  supplierId: string
  itemId: string
  quantity: number
  value: number
  date: string
  reason: string
}

export interface SupplierPayment {
  id: string
  supplierId: string
  amount: number
  date: string
  method: 'cash' | 'transfer' | 'wallet'
  reference: string
  note: string
  reversed?: boolean
}

export interface Packing {
  id: string
  number: string
  itemId: string
  units: number
  waste: number
  unitCost: number
  date: string
  status?: 'confirmed' | 'cancelled'
  notes?: string
}

export interface Reminder {
  id: string
  saleId: string
  customerId: string
  ruleId?: string
  templateId?: string
  scheduledFor: string
  stage: string
  status: 'pending' | 'sent' | 'skipped' | 'cancelled' | 'failed'
  sentAt?: string
}

export interface ReminderRule {
  id: string
  name: string
  offsetDays: number
  stage: string
  templateId: string
  active: boolean
}

export interface MessageTemplate {
  id: string
  name: string
  stage: string
  body: string
}

export interface PromiseToPay {
  id: string
  saleId: string
  customerId: string
  promisedDate: string
  amount: number
  notes: string
  status: 'open' | 'kept' | 'broken'
}

export interface CustomerPayment {
  id: string
  saleId: string
  customerId: string
  amount: number
  date: string
  method: 'cash' | 'transfer' | 'wallet'
  note: string
  reversed?: boolean
}

export interface CustomerRefund {
  id: string
  customerId: string
  saleId?: string
  amount: number
  date: string
  method: string
  notes?: string
}

export interface MessageLog {
  id: string
  reminderId: string
  customerId: string
  body: string
  status: 'sent' | 'failed'
  createdAt: string
}

export interface User {
  id: string
  username: string
  displayName: string
  role: UserRole
  active: boolean
}

export interface AuditEntry {
  id: string
  at: string
  userId: string
  userName?: string | null
  action: string
  entity: string
  entityId: string
  detail: string
}

export interface AppSettings {
  companyName: string
  companyPhone: string
  defaultCreditDays: number
  costingMethod: 'FIFO' | 'WAVG'
}

export interface StockLot {
  id: string
  itemId: string
  code: string
  quantity: number
  initialQuantity: number
  unitCost: number
  receivedAt: string
  expiryDate?: string
  source: 'purchase' | 'packing' | 'opening' | 'return' | 'adjustment'
  active: boolean
}

export type StockMovementType = 'opening' | 'purchase' | 'purchase-return' | 'packing-consumption' | 'packing-production' | 'sale' | 'sales-return' | 'adjustment'

export interface StockMovement {
  id: string
  at: string
  itemId: string
  lotId?: string
  type: StockMovementType
  quantityChange: number
  balanceAfter: number
  unitCost: number
  reference: string
  note: string
  userId: string
}

export interface SalesReturn {
  id: string
  number: string
  saleId: string
  customerId: string
  itemId: string
  quantity: number
  value: number
  cost: number
  date: string
  reason: string
  originalSalesLineId?: string
}

export interface OpeningEntry {
  id: string
  partyId: string
  amount: number
  date: string
  dueDate?: string | null
  notes?: string
}

export interface AppState {
  items: Item[]
  customers: Customer[]
  suppliers: Supplier[]
  sales: Sale[]
  purchases: Purchase[]
  purchaseDrafts: PurchaseDraft[]
  supplierPayments: SupplierPayment[]
  purchaseReturns: PurchaseReturn[]
  packings: Packing[]
  reminders: Reminder[]
  reminderRules: ReminderRule[]
  messageTemplates: MessageTemplate[]
  promises: PromiseToPay[]
  customerPayments: CustomerPayment[]
  refunds: CustomerRefund[]
  messageLog: MessageLog[]
  users: User[]
  auditLog: AuditEntry[]
  lots: StockLot[]
  stockLedger: StockMovement[]
  salesReturns: SalesReturn[]
  customerOpenings: OpeningEntry[]
  supplierOpenings: OpeningEntry[]
  activity: { id: string; title: string; detail: string; at: string; type: 'sale' | 'packing' | 'purchase' | 'payment' }[]
  settings: AppSettings
  nextNumbers: Record<'INV' | 'PUR' | 'D-PUR' | 'PCK' | 'RET' | 'PRT', string>
  today: string
}

export const money = (amount: number) =>
  new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(amount)

export const quantity = (amount: number, unit = '') =>
  new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(amount) + (unit ? ' ' + unit : '')

// Local (device timezone) calendar dates — never UTC, so documents created after
// midnight in Egypt (UTC+2/+3) carry the correct local day.
export const localDateString = (date: Date) =>
  date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')

export const today = () => localDateString(new Date())

export const daysFromNow = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localDateString(date)
}

export const addDays = (isoDate: string, days: number) => {
  const date = new Date(isoDate + 'T12:00:00')
  date.setDate(date.getDate() + days)
  return localDateString(date)
}

// Relative Arabic label for an ISO timestamp ("الآن"، "منذ ٣ ساعات"…).
export function activityTime(at: string) {
  const time = new Date(at).getTime()
  if (!Number.isFinite(time)) return at
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000))
  if (minutes < 1) return 'الآن'
  if (minutes < 60) return 'منذ ' + quantity(minutes, 'دقيقة')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return 'منذ ' + quantity(hours, 'ساعة')
  if (hours < 48) return 'أمس'
  const days = Math.floor(hours / 24)
  if (days < 30) return 'منذ ' + quantity(days, 'أيام')
  return at.slice(0, 10)
}

// BR-PAY-02: the "overdue" status is derived, never stored — an unpaid invoice
// past its due date counts as overdue automatically, even if created months ago.
export const saleStatus = (sale: Pick<Sale, 'status' | 'total' | 'paid' | 'dueDate'>): Sale['status'] => {
  if (sale.status === 'draft' || sale.status === 'cancelled') return sale.status
  const remaining = sale.total - sale.paid
  if (remaining <= 0) return 'paid'
  if (sale.dueDate && sale.dueDate < today()) return 'overdue'
  return sale.paid > 0 ? 'partial' : 'confirmed'
}

export function renderTemplate(template: string, customer: Customer, sale: Sale, companyName = 'مدير التعبئة للتجارة') {
  const remaining = sale.total - sale.paid
  return template
    .replace(/\{اسم_العميل\}/g, customer.name)
    .replace(/\{رقم_الفاتورة\}/g, sale.number)
    .replace(/\{المبلغ_المتبقي\}/g, money(remaining))
    .replace(/\{تاريخ_الاستحقاق\}/g, sale.dueDate || '—')
    .replace(/\{اجمالي_المديونية\}/g, money(customer.balance))
    .replace(/\{اسم_المنشأة\}/g, companyName)
}

// FIFO allocation preview across an item's tracked lots (oldest first) — used
// only to preview packing consumption; the backend performs the authoritative
// allocation when the document is confirmed.
export function allocateFromLots(lots: StockLot[], itemId: string, quantityNeeded: number) {
  const itemLots = lots
    .filter(lot => lot.itemId === itemId && lot.quantity > 0 && lot.active !== false)
    .sort((first, second) => first.receivedAt.localeCompare(second.receivedAt))
  let remaining = Math.max(0, quantityNeeded)
  const allocations: { lotId: string; quantity: number; unitCost: number }[] = []
  for (const lot of itemLots) {
    if (remaining <= 0.000001) break
    const take = Math.min(lot.quantity, remaining)
    if (take > 0) allocations.push({ lotId: lot.id, quantity: take, unitCost: lot.unitCost })
    remaining -= take
  }
  return { allocations, uncovered: Math.max(0, remaining) }
}

export function packingEstimate(state: AppState, finishedId: string, units: number, waste: number) {
  const product = state.items.find(item => item.id === finishedId)
  if (!product?.recipe) return { product, inputs: [], available: 0, rawCost: 0, packagingCost: 0, unitCost: 0 }
  const inputs = product.recipe.map(line => {
    const item = state.items.find(candidate => candidate.id === line.itemId)!
    const needed = line.kind === 'raw' ? line.qty * units + waste : line.qty * units
    return { item, line, needed, enough: item.stock >= needed }
  })
  const rawCost = inputs.filter(input => input.line.kind === 'raw').reduce((sum, input) => sum + input.needed * input.item.unitCost, 0)
  const packagingCost = inputs.filter(input => input.line.kind === 'packaging').reduce((sum, input) => sum + input.needed * input.item.unitCost, 0)
  return { product, inputs, available: Math.min(...inputs.map(input => Math.floor(input.item.stock / input.line.qty))), rawCost, packagingCost, unitCost: (rawCost + packagingCost) / Math.max(units, 1) }
}

export function packingCapacity(state: AppState, finishedId: string, availableRaw: number, waste: number) {
  const product = state.items.find(item => item.id === finishedId)
  const rawLine = product?.recipe?.find(line => line.kind === 'raw')
  if (!product?.recipe?.length || !rawLine || !Number.isFinite(availableRaw) || availableRaw < 0 || !Number.isFinite(waste) || waste < 0) return 0
  const capacities = product.recipe.map(line => {
    const item = state.items.find(candidate => candidate.id === line.itemId)
    if (!item || !Number.isFinite(line.qty) || line.qty <= 0) return 0
    const available = line.kind === 'raw'
      ? Math.max(0, Math.min(item.stock, item.id === rawLine.itemId ? availableRaw : item.stock) - waste)
      : item.stock
    return Math.floor(available / line.qty)
  })
  return capacities.length ? Math.max(0, Math.min(...capacities)) : 0
}

export function creditCheck(customer: Customer, creditAmount: number) {
  const used = customer.balance
  const available = Math.max(customer.creditLimit - used, 0)
  return { used, available, projected: used + creditAmount, allowed: !customer.blocked && creditAmount <= available }
}

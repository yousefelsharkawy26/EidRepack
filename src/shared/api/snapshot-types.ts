import type { ItemType, UserRole } from "../../lib/domain";

export interface SnapshotSettings {
  companyName: string;
  companyPhone: string;
  currency: string;
  costingMethod: "FIFO" | "WAVG";
  defaultCreditDays: number;
}

export interface SnapshotItem {
  id: string;
  sku: string;
  name: string;
  type: ItemType;
  unit: { label: string; factor: number; baseUnitId: string };
  stockBase: number;
  minStockBase: number;
  unitCostBaseMinor?: number;
  salePriceBaseMinor?: number;
  isActive: boolean;
  recipe: { itemId: string; qtyPerUnitBase: number; kind: "raw" | "packaging" }[];
}

export interface SnapshotCustomer {
  id: string; name: string; phone: string; whatsapp: string;
  creditLimitMinor: number; creditDays: number; isBlocked: boolean;
  blockReason: string | null; notes: string | null; isActive: boolean; balanceMinor: number;
}

export interface SnapshotOpening {
  id: string;
  customer_id?: string;
  supplier_id?: string;
  balance_delta_minor: number;
  effective_date: string;
  due_date?: string | null;
  notes?: string | null;
  reason?: string | null;
  created_at?: string;
}

export interface SnapshotSupplier {
  id: string; name: string; phone: string; whatsapp: string | null;
  address: string | null; notes: string | null; creditDays: number;
  isActive: boolean; balanceMinor: number;
}

export interface SnapshotSaleLine {
  id: string; itemId: string; qtyBase: number; unitPriceBaseMinor: number;
  unitCostBaseMinor: number; lineTotalMinor: number; cogsTotalMinor: number;
}

export interface SnapshotSale {
  id: string; number: string; customerId: string; date: string; dueDate: string | null;
  status: "confirmed" | "partial" | "paid" | "overdue" | "cancelled";
  totalMinor: number; paidMinor: number; creditOverrideBy: string | null;
  creditOverrideReason: string | null; notes: string | null; lines: SnapshotSaleLine[];
}

export interface SnapshotPurchase {
  id: string; number: string; supplierId: string; date: string; dueDate: string | null;
  status: string; totalMinor: number; paidMinor: number; extraCostsMinor: number;
  supplierInvoiceNumber: string | null; itemId: string | null; qtyBase: number;
  landedCostTotalMinor: number; lotId: string | null;
}

export interface SnapshotPurchaseDraft {
  id: string; number: string; supplierId: string; itemId: string; date: string;
  qtyBase: number; unitPriceBaseMinor: number; extraCostsMinor: number; paidMinor: number;
  supplierInvoiceNumber: string | null; dueDate: string | null;
}

export interface SnapshotPacking {
  id: string; number: string; date: string; itemId: string; plannedUnits: number;
  producedUnits: number; wasteQtyBase: number; unitCostMinor: number;
  status: "confirmed" | "cancelled"; notes: string | null;
}

export interface SnapshotLot {
  id: string; itemId: string; code: string; qtyBase: number; qtyInitialBase: number;
  costTotalMinor: number; costRemainingMinor: number; receivedAt: string;
  expiryDate: string | null; source: string; isActive: boolean;
}

export interface SnapshotReminder {
  id: string; saleId: string; customerId: string; ruleId: string | null;
  templateId: string | null; scheduledFor: string; status: string;
  sentAt: string | null; stage: string;
}

export interface SnapshotReminderRule {
  id: string; name: string; offsetDays: number; stage: string; templateId: string;
  isActive: boolean; customerId: string | null;
}

export interface SnapshotMessageTemplate {
  id: string; name: string; stage: string; body: string; channel: string;
}

export interface SnapshotPromise {
  id: string; saleId: string; customerId: string; promisedDate: string;
  amountMinor: number; status: "open" | "kept" | "broken"; notes: string;
}

export interface SnapshotPaymentAllocation {
  docType: string; saleId: string | null; purchaseId: string | null;
  amountMinor: number; isInitial: boolean;
}

export interface SnapshotPayment {
  id: string; partyType: "customer" | "supplier"; customerId: string | null;
  supplierId: string | null; direction: string; amountMinor: number;
  method: "cash" | "transfer" | "wallet"; date: string; reference: string | null;
  notes: string | null; isReversed: boolean; allocations: SnapshotPaymentAllocation[];
}

export interface SnapshotRefund {
  id: string; customerId: string; saleId: string | null;
  amountMinor: number; method: string; date: string; notes: string | null;
}

export interface SnapshotReturnLine {
  itemId: string; qtyBase: number; valueMinor: number; costMinor: number;
  originalSalesLineId: string | null;
}

export interface SnapshotReturn {
  id: string; number: string; type: "sales" | "purchase"; saleId: string | null;
  purchaseId: string | null; date: string; reason: string; lines: SnapshotReturnLine[];
}

export interface SnapshotStockMovement {
  id: string; itemId: string; lotId: string | null; type: string; qtyBase: number;
  balanceAfterBase: number; costMinor: number | null; refType: string | null;
  refId: string | null; createdAt: string; notes: string | null; createdBy: string | null;
}

export interface SnapshotMessageLog {
  id: string; reminderId: string | null; customerId: string | null;
  toPhone: string; body: string; status: string; createdAt: string;
}

export interface SnapshotAuditEntry {
  id: string; at: string; userId: string | null; userName: string | null;
  action: string; entity: string; entityId: string;
}

export interface SnapshotUser {
  id: string; username: string; display_name: string; role: UserRole;
  is_active: number; created_at: string;
}

export interface Snapshot {
  generatedAt: string;
  today: string;
  settings: SnapshotSettings;
  users: SnapshotUser[];
  items: SnapshotItem[];
  customers: SnapshotCustomer[];
  customerOpenings: SnapshotOpening[];
  customerAdjustments: SnapshotOpening[];
  suppliers: SnapshotSupplier[];
  supplierOpenings: SnapshotOpening[];
  sales: SnapshotSale[];
  purchases: SnapshotPurchase[];
  purchaseDrafts: SnapshotPurchaseDraft[];
  packings: SnapshotPacking[];
  lots: SnapshotLot[];
  reminders: SnapshotReminder[];
  reminderRules: SnapshotReminderRule[];
  messageTemplates: SnapshotMessageTemplate[];
  promises: SnapshotPromise[];
  payments: SnapshotPayment[];
  refunds: SnapshotRefund[];
  returns: SnapshotReturn[];
  stockMovements: SnapshotStockMovement[];
  messageLog: SnapshotMessageLog[];
  auditLog: SnapshotAuditEntry[];
  nextNumbers: { INV: string; PUR: string; "D-PUR": string; PCK: string; RET: string; PRT: string };
}

export interface SnapshotEnvelope { snapshot: Snapshot }

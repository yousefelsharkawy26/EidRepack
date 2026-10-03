import type { Purchase, PurchaseDraft, PurchaseReturn } from "../../lib/domain";
import type { Snapshot } from "../../shared/api/snapshot-types";
import { toEgp } from "../../shared/lib/money";
import { toDisplay } from "../../shared/lib/units";

export function mapPurchases(rows: Snapshot["purchases"], factor: (itemId: string) => number): Purchase[] {
  return rows.map((row) => ({
    id: row.id, number: row.number, supplierId: row.supplierId, date: row.date,
    ...(row.dueDate ? { dueDate: row.dueDate } : {}), total: toEgp(row.totalMinor), paid: toEgp(row.paidMinor),
    extraCosts: toEgp(row.extraCostsMinor || 0),
    ...(row.supplierInvoiceNumber ? { supplierInvoiceNumber: row.supplierInvoiceNumber } : {}),
    ...(row.itemId ? { itemId: row.itemId } : {}),
    quantity: row.itemId ? toDisplay(row.qtyBase, factor(row.itemId)) : 0,
    unitCost: row.itemId && row.qtyBase > 0 ? toEgp(row.landedCostTotalMinor) / toDisplay(row.qtyBase, factor(row.itemId)) : 0,
    ...(row.lotId ? { lotId: row.lotId } : {}),
  }));
}

export function mapPurchaseDrafts(rows: Snapshot["purchaseDrafts"], factor: (itemId: string) => number): PurchaseDraft[] {
  return rows.map((row) => ({
    id: row.id, number: row.number, supplierId: row.supplierId, itemId: row.itemId, date: row.date,
    ...(row.supplierInvoiceNumber ? { supplierInvoiceNumber: row.supplierInvoiceNumber } : {}),
    ...(row.dueDate ? { dueDate: row.dueDate } : {}),
    quantity: toDisplay(row.qtyBase, factor(row.itemId)),
    unitPrice: toEgp(row.unitPriceBaseMinor) * factor(row.itemId),
    extraCosts: toEgp(row.extraCostsMinor), paid: toEgp(row.paidMinor),
  }));
}

export function mapPurchaseReturns(snapshot: Snapshot, factor: (itemId: string) => number): PurchaseReturn[] {
  return snapshot.returns
    .filter((row) => row.type === "purchase")
    .flatMap((row) => row.lines.map((line) => ({
      id: row.id, number: row.number, purchaseId: row.purchaseId || "",
      supplierId: snapshot.purchases.find((purchase) => purchase.id === row.purchaseId)?.supplierId || "",
      itemId: line.itemId, quantity: toDisplay(line.qtyBase, factor(line.itemId)),
      value: toEgp(line.valueMinor), date: row.date, reason: row.reason || "",
    })));
}

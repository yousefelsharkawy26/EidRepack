import type { Item, StockLot, StockMovement } from "../../lib/domain";
import type { Snapshot, SnapshotItem } from "../../shared/api/snapshot-types";
import { toEgp } from "../../shared/lib/money";
import { toDisplay } from "../../shared/lib/units";

export function mapItems(rows: SnapshotItem[], factor: (itemId: string) => number): Item[] {
  return rows.map((item) => ({
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
    recipe: item.recipe.map((line) => ({
      itemId: line.itemId,
      qty: toDisplay(line.qtyPerUnitBase, factor(line.itemId)),
      kind: line.kind,
    })),
  }));
}

export function mapLots(rows: Snapshot["lots"], factor: (itemId: string) => number): StockLot[] {
  return rows.map((row) => ({
    id: row.id, itemId: row.itemId, code: row.code,
    quantity: toDisplay(row.qtyBase, factor(row.itemId)),
    initialQuantity: toDisplay(row.qtyInitialBase, factor(row.itemId)),
    unitCost: row.qtyInitialBase > 0 ? toEgp(row.costTotalMinor) / toDisplay(row.qtyInitialBase, factor(row.itemId)) : 0,
    receivedAt: row.receivedAt, ...(row.expiryDate ? { expiryDate: row.expiryDate } : {}),
    source: row.source as StockLot["source"], active: row.isActive,
  }));
}

export function mapStockLedger(rows: Snapshot["stockMovements"], factor: (itemId: string) => number): StockMovement[] {
  return rows.map((row) => ({
    id: row.id, at: row.createdAt, itemId: row.itemId, ...(row.lotId ? { lotId: row.lotId } : {}),
    type: row.type as StockMovement["type"],
    quantityChange: toDisplay(row.qtyBase, factor(row.itemId)),
    balanceAfter: toDisplay(row.balanceAfterBase, factor(row.itemId)),
    unitCost: row.costMinor != null && row.qtyBase ? toEgp(row.costMinor) / Math.abs(toDisplay(row.qtyBase, factor(row.itemId)) || 1) : 0,
    reference: row.refId || row.refType || "", note: row.notes || "", userId: row.createdBy || "",
  }));
}

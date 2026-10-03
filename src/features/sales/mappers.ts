import type { Sale, SalesReturn } from "../../lib/domain";
import type { Snapshot } from "../../shared/api/snapshot-types";
import { toEgp } from "../../shared/lib/money";
import { toDisplay } from "../../shared/lib/units";

export function mapSales(rows: Snapshot["sales"], factor: (itemId: string) => number): Sale[] {
  return rows.map((row) => ({
    id: row.id, number: row.number, customerId: row.customerId, date: row.date,
    ...(row.dueDate ? { dueDate: row.dueDate } : {}), status: row.status,
    total: toEgp(row.totalMinor), paid: toEgp(row.paidMinor),
    ...(row.notes ? { notes: row.notes } : {}),
    creditOverrideBy: row.creditOverrideBy, creditOverrideReason: row.creditOverrideReason,
    lines: row.lines.map((line) => ({
      id: line.id, itemId: line.itemId, qty: toDisplay(line.qtyBase, factor(line.itemId)),
      price: line.qtyBase > 0 ? toEgp(line.lineTotalMinor ?? line.unitPriceBaseMinor * line.qtyBase) / toDisplay(line.qtyBase, factor(line.itemId)) : 0,
      cost: line.qtyBase > 0 ? toEgp(line.cogsTotalMinor ?? line.unitCostBaseMinor * line.qtyBase) / toDisplay(line.qtyBase, factor(line.itemId)) : 0,
    })),
  }));
}

export function mapSalesReturns(snapshot: Snapshot, factor: (itemId: string) => number): SalesReturn[] {
  return snapshot.returns
    .filter((row) => row.type === "sales")
    .flatMap((row) => row.lines.map((line) => ({
      id: row.id, number: row.number, saleId: row.saleId || "",
      customerId: snapshot.sales.find((sale) => sale.id === row.saleId)?.customerId || "",
      itemId: line.itemId, quantity: toDisplay(line.qtyBase, factor(line.itemId)),
      value: toEgp(line.valueMinor), cost: toEgp(line.costMinor || 0),
      date: row.date, reason: row.reason || "",
      ...(line.originalSalesLineId ? { originalSalesLineId: line.originalSalesLineId } : {}),
    })));
}

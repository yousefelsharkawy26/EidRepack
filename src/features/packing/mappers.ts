import type { AppState, Packing } from "../../lib/domain";
import type { Snapshot } from "../../shared/api/snapshot-types";
import { toEgp } from "../../shared/lib/money";
import { toDisplay } from "../../shared/lib/units";

export function mapPackings(rows: Snapshot["packings"], items: AppState["items"]): Packing[] {
  return rows.map((row) => {
    const rawLine = items.find((item) => item.id === row.itemId)?.recipe?.find((line) => line.kind === "raw");
    const factor = items.find((item) => item.id === rawLine?.itemId)?.unitFactor || 1;
    return {
      id: row.id, number: row.number, date: row.date, itemId: row.itemId,
      units: row.producedUnits, waste: toDisplay(row.wasteQtyBase || 0, factor),
      unitCost: toEgp(row.unitCostMinor || 0), status: row.status,
      ...(row.notes ? { notes: row.notes } : {}),
    };
  });
}

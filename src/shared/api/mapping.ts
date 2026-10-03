import type { SnapshotItem } from "./snapshot-types";

export function itemFactors(items: SnapshotItem[]) {
  const factors = new Map(items.map((item) => [item.id, item.unit.factor || 1]));
  return (itemId: string) => factors.get(itemId) || 1;
}

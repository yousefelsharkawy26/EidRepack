import type { OpeningEntry, Supplier } from "../../lib/domain";
import type { Snapshot } from "../../shared/api/snapshot-types";
import { toEgp } from "../../shared/lib/money";

export function mapSuppliers(rows: Snapshot["suppliers"]): Supplier[] {
  return rows.map((row) => ({
    id: row.id, name: row.name, phone: row.phone,
    ...(row.whatsapp ? { whatsapp: row.whatsapp } : {}),
    ...(row.address ? { address: row.address } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    creditDays: row.creditDays, balance: toEgp(row.balanceMinor), active: row.isActive,
  }));
}

export function mapSupplierOpenings(rows: Snapshot["supplierOpenings"]): OpeningEntry[] {
  return rows.map((row) => ({
    id: row.id, partyId: row.supplier_id || "", amount: toEgp(row.balance_delta_minor),
    date: row.effective_date,
    ...(row.due_date !== undefined ? { dueDate: row.due_date } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
  }));
}

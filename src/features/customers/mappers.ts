import type { Customer, OpeningEntry } from "../../lib/domain";
import type { Snapshot } from "../../shared/api/snapshot-types";
import { toEgp } from "../../shared/lib/money";

export function mapCustomers(rows: Snapshot["customers"]): Customer[] {
  return rows.map((row) => ({
    id: row.id, name: row.name, phone: row.phone, whatsapp: row.whatsapp,
    creditLimit: toEgp(row.creditLimitMinor), balance: toEgp(row.balanceMinor),
    creditDays: row.creditDays, blocked: row.isBlocked,
    ...(row.blockReason ? { blockReason: row.blockReason } : {}),
    ...(row.notes ? { notes: row.notes } : {}), active: row.isActive,
  }));
}

export function mapCustomerOpenings(rows: Snapshot["customerOpenings"]): OpeningEntry[] {
  return rows.map((row) => ({
    id: row.id, partyId: row.customer_id || "", amount: toEgp(row.balance_delta_minor),
    date: row.effective_date,
    ...(row.due_date !== undefined ? { dueDate: row.due_date } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
  }));
}

export function mapCustomerAdjustments(rows: Snapshot["customerAdjustments"]): OpeningEntry[] {
  return rows.map((row) => ({
    id: row.id, partyId: row.customer_id || "", amount: toEgp(row.balance_delta_minor),
    date: row.effective_date,
  }));
}

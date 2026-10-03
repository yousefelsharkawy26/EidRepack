import type { CustomerPayment, CustomerRefund, PromiseToPay, SupplierPayment } from "../../lib/domain";
import type { Snapshot } from "../../shared/api/snapshot-types";
import { toEgp } from "../../shared/lib/money";

export function mapPromises(rows: Snapshot["promises"]): PromiseToPay[] {
  return rows.map((row) => ({
    id: row.id, saleId: row.saleId, customerId: row.customerId, promisedDate: row.promisedDate,
    amount: toEgp(row.amountMinor), notes: row.notes || "", status: row.status,
  }));
}

export function mapCustomerPayments(rows: Snapshot["payments"]): CustomerPayment[] {
  return rows.filter((row) => row.partyType === "customer" && !row.isReversed).map((row) => ({
    id: row.id, customerId: row.customerId || "", saleId: row.allocations[0]?.saleId || "",
    amount: toEgp(row.amountMinor), date: row.date, method: row.method,
    note: row.notes || "", reversed: false,
  }));
}

export function mapSupplierPayments(rows: Snapshot["payments"]): SupplierPayment[] {
  return rows.filter((row) => row.partyType === "supplier" && !row.isReversed && row.notes !== "دفعة عند اعتماد الفاتورة").map((row) => ({
    id: row.id, supplierId: row.supplierId || "", amount: toEgp(row.amountMinor), date: row.date,
    method: row.method, reference: row.reference || "", note: row.notes || "",
  }));
}

export function mapRefunds(rows: Snapshot["refunds"]): CustomerRefund[] {
  return rows.map((row) => ({
    id: row.id, customerId: row.customerId,
    ...(row.saleId ? { saleId: row.saleId } : {}),
    amount: toEgp(row.amountMinor), date: row.date, method: row.method,
    ...(row.notes ? { notes: row.notes } : {}),
  }));
}

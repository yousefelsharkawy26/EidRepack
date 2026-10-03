import { FileBarChart } from "lucide-react";
import type { AppState, Supplier } from "../../lib/domain";
import { money } from "../../lib/domain";
import { PaginationBar, usePagination } from "../../shared/ui/Pagination";

export default function SupplierList({ state, canManage, onEdit, onPay, onPrint }: {
  state: AppState; canManage: boolean; onEdit: (supplier: Supplier) => void;
  onPay: (supplier: Supplier) => void; onPrint: (supplier: Supplier) => void;
}) {
  const { pageItems, pagination } = usePagination(state.suppliers);
  return <section className="card card-flush"><table>
    <thead><tr><th>المورد</th><th>الهاتف / واتساب</th><th>فترة السداد</th><th>الرصيد المستحق</th><th>آخر فاتورة</th><th>الإجراءات</th></tr></thead>
    <tbody>{pageItems.map((supplier) => {
      const lastPurchase = state.purchases.filter((purchase) => purchase.supplierId === supplier.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      return <tr key={supplier.id}><td className="name-cell"><b>{supplier.name}</b><small>{supplier.address || supplier.notes || "لا توجد ملاحظات"}</small></td>
        <td>{supplier.phone || "—"}<small>{supplier.whatsapp ? "واتساب: " + supplier.whatsapp : ""}</small></td>
      <td>{supplier.creditDays ?? 15} يوم</td><td className="text-emphasis">{money(supplier.balance)}</td>
        <td>{lastPurchase?.number || "—"}{lastPurchase?.dueDate && <small>استحقاق {lastPurchase.dueDate}</small>}</td>
        <td className="supplier-actions">{canManage && <><button className="secondary" onClick={() => onEdit(supplier)}>تعديل</button><button className="secondary" disabled={!supplier.balance} onClick={() => onPay(supplier)}>تسجيل سداد</button></>}
          <button className="secondary" onClick={() => onPrint(supplier)}><FileBarChart size={14} /> كشف الحساب</button>
        </td></tr>;
    })}</tbody>
  </table><PaginationBar state={pagination}/></section>;
}

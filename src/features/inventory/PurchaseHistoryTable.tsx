import { Copy } from "lucide-react";
import { useApp } from "../../app/AppProvider";
import type { AppState } from "../../lib/domain";
import { money } from "../../lib/domain";
import { PaginationBar, usePagination } from "../../shared/ui/Pagination";

export default function PurchaseHistoryTable({ state }: { state: AppState }) {
  const { setScreen, currentUser } = useApp();
  const ordered = [...state.purchases].sort((a, b) => b.date.localeCompare(a.date));
  const { pageItems, pagination } = usePagination(ordered);
  const canCopy = currentUser?.permissions.screens.includes("purchases") ?? false;

  return <section className="card card-flush inventory-history-card" role="tabpanel" aria-labelledby="inventory-table-purchases">
    <div className="card-title panel-title-inset"><div><h3>سجل فواتير الشراء</h3><span>الفواتير المعتمدة للعرض والنسخ كمسودات جديدة</span></div></div>
    <div className="data-table"><table>
      <thead><tr><th>الفاتورة</th><th>المورد</th><th>الصنف</th><th>التاريخ</th><th>الإجمالي</th><th>المدفوع</th><th>نسخ</th></tr></thead>
      <tbody>{pageItems.map(purchase => <tr key={purchase.id}>
        <td className="name-cell"><b>{purchase.number}</b></td>
        <td>{state.suppliers.find(supplier => supplier.id === purchase.supplierId)?.name || "مورد غير متاح"}</td>
        <td>{state.items.find(item => item.id === purchase.itemId)?.name || "—"}</td>
        <td>{purchase.date}</td><td>{money(purchase.total)}</td><td>{money(purchase.paid)}</td>
        <td><button className="secondary" disabled={!canCopy || !purchase.itemId || !purchase.quantity} onClick={() => {
          localStorage.setItem("repack.pendingPurchaseCopyId", purchase.id);
          setScreen("purchases");
        }}><Copy size={14}/> كمسودة جديدة</button></td>
      </tr>)}</tbody>
    </table>{ordered.length === 0 && <p className="empty-state">لا توجد فواتير شراء حتى الآن.</p>}</div>
    <PaginationBar state={pagination}/>
  </section>;
}

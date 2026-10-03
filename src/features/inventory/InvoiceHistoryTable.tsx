import { Copy } from "lucide-react";
import type { AppState } from "../../lib/domain";
import { money } from "../../lib/domain";
import { useApp } from "../../app/AppProvider";
import { PaginationBar, usePagination } from "../../shared/ui/Pagination";

export default function InvoiceHistoryTable({ state, busy }: { state:AppState; busy:boolean }) {
  const { setScreen, currentUser } = useApp();
  const ordered = [...state.sales].sort((a,b)=>b.date.localeCompare(a.date));
  const { pageItems, pagination } = usePagination(ordered);
  return <section className="card card-flush inventory-history-card" role="tabpanel" aria-labelledby="inventory-table-sales">
    <div className="card-title panel-title-inset"><div><h3>سجل فواتير البيع</h3><span>للعرض والنسخ كفاتورة جديدة من مساحة المبيعات</span></div></div>
    <div className="data-table"><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>التاريخ</th><th>الإجمالي</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{pageItems.map(sale => <tr key={sale.id}>
      <td className="name-cell"><b>{sale.number}</b></td><td>{state.customers.find(entry=>entry.id===sale.customerId)?.name || "عميل غير متاح"}</td><td>{sale.date}</td><td>{money(sale.total)}</td>
      <td>{sale.status === "overdue" ? "متأخرة" : sale.status === "paid" ? "مدفوعة" : sale.status === "partial" ? "مدفوعة جزئيًا" : sale.status === "cancelled" ? "ملغاة" : "معتمدة"}</td>
      <td><button className="secondary" disabled={busy || sale.status === "cancelled" || !currentUser?.permissions.screens.includes("sales")} onClick={() => { localStorage.setItem("repack.pendingSaleCopyId", sale.id); setScreen("sales"); }}><Copy size={14}/> نسخ في المبيعات</button></td>
    </tr>)}</tbody></table></div>
    <PaginationBar state={pagination}/>
  </section>;
}

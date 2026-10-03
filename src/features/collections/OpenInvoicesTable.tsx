import { Ban, Clock3, FileBarChart, HandCoins } from "lucide-react";
import { saleStatus, type AppState, type Sale } from "../../lib/domain";
import StatusBadge from "../../shared/ui/StatusBadge";
import { PaginationBar, usePagination } from "../../shared/ui/Pagination";

interface Props {
  state: AppState; open: Sale[]; isOwner: boolean; busy: boolean;
  onPrint: (sale: Sale) => void; onCollect: (sale: Sale) => void;
  onPromise: (sale: Sale) => void; onReturn: (sale: Sale) => void;
  onWriteOff: (sale: Sale) => void;
}

export default function OpenInvoicesTable({ state, open, isOwner, busy, onPrint, onCollect, onPromise, onReturn, onWriteOff }: Props) {
  const { pageItems, pagination } = usePagination(open);
  return <section className="card card-flush"><table>
    <thead><tr><th>الفاتورة</th><th>العميل</th><th>تاريخ الاستحقاق</th><th>المتبقي</th><th>الحالة</th><th /></tr></thead>
    <tbody>{pageItems.map((sale) => {
      const customer = state.customers.find((entry) => entry.id === sale.customerId);
      const status = saleStatus(sale);
      return <tr key={sale.id}><td className="name-cell"><b>{sale.number}</b><small>تاريخ الفاتورة: {sale.date}</small></td>
        <td>{customer?.name}</td><td>{sale.dueDate || "—"}</td><td className="text-emphasis">{new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(sale.total - sale.paid)}</td>
        <td><StatusBadge status={status} /></td><td className="table-actions-cell">
          <button className="secondary" onClick={() => onPrint(sale)}><FileBarChart size={14} /> طباعة</button>
          <button className="secondary" onClick={() => onCollect(sale)}><HandCoins size={14} /> تحصيل</button>
          <button className="secondary" onClick={() => onPromise(sale)}><Clock3 size={14} /> وعد</button>
          <button className="secondary" onClick={() => onReturn(sale)}>مرتجع</button>
          {isOwner && <button className="danger" disabled={busy} onClick={() => onWriteOff(sale)}><Ban size={14} /> شطب</button>}
        </td></tr>;
    })}</tbody>
  </table><PaginationBar state={pagination}/></section>;
}

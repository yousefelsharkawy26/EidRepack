import { RotateCcw } from "lucide-react";
import type { AppState, CustomerPayment } from "../../lib/domain";
import { money } from "../../shared/lib/money";
import { PaginationBar, usePagination } from "../../shared/ui/Pagination";

export default function PaymentsHistory({ state, isOwner, busy, onReverse }: { state: AppState; isOwner: boolean; busy: boolean; onReverse: (payment: CustomerPayment) => void }) {
  const ordered = [...state.customerPayments].sort((a,b)=>b.date.localeCompare(a.date));
  const { pageItems, pagination } = usePagination(ordered);
  return <section className="card card-flush panel-spaced">
    <div className="card-title panel-title-inset"><div><h3>آخر الدفعات المحصلة</h3><span>عكس الدفعة متاح للمالك فقط ويُسجَّل في سجل التدقيق</span></div></div>
    {state.customerPayments.length ? <><table><thead><tr><th>العميل</th><th>الفاتورة</th><th>المبلغ</th><th>الطريقة</th><th>التاريخ</th><th /></tr></thead>
      <tbody>{pageItems.map((payment) => <tr key={payment.id}>
        <td className="name-cell"><b>{state.customers.find((customer) => customer.id === payment.customerId)?.name || "—"}</b><small>{payment.note}</small></td>
        <td>{state.sales.find((sale) => sale.id === payment.saleId)?.number || "—"}</td><td className="text-emphasis">{money(payment.amount)}</td>
        <td>{{ cash: "نقدي", transfer: "تحويل", wallet: "محفظة" }[payment.method] || payment.method}</td><td>{payment.date}</td>
        <td>{isOwner && <button className="secondary" disabled={busy} onClick={() => onReverse(payment)}><RotateCcw size={14} /> عكس</button>}</td>
      </tr>)}</tbody></table><PaginationBar state={pagination}/></> : <p className="muted-empty empty-state-inset">لم تُسجَّل أي دفعات بعد.</p>}
  </section>;
}

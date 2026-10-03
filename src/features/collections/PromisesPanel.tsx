import type { AppState, Sale } from "../../lib/domain";
import { money } from "../../shared/lib/money";

export default function PromisesPanel({ state, open }: { state: AppState; open: Sale[] }) {
  return <div className="split panel-spaced">
    <section className="card"><div className="card-title"><h3>وعود سداد مفتوحة</h3></div>
      {state.promises.filter((promise) => promise.status === "open").length ? state.promises.filter((promise) => promise.status === "open").map((promise) =>
        <div className="mini-stat" key={promise.id}><span>{state.sales.find((sale) => sale.id === promise.saleId)?.number} · {promise.promisedDate}</span><strong>{money(promise.amount)}</strong></div>) : <p className="muted-empty">لا توجد وعود سداد مفتوحة.</p>}
    </section>
    <section className="card"><div className="card-title"><h3>ملخص التحصيل</h3></div>
      <div className="mini-stat"><span>إجمالي المتبقي</span><strong>{money(open.reduce((sum, sale) => sum + sale.total - sale.paid, 0))}</strong></div>
      <div className="mini-stat"><span>فواتير متأخرة</span><strong className="negative-text">{open.filter((sale) => sale.dueDate && sale.dueDate < state.today).length}</strong></div>
    </section>
  </div>;
}

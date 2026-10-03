import type { AppState } from "../../lib/domain";
import { quantity } from "../../lib/domain";

export default function LotsTable({ state, lots }: { state: AppState; lots: AppState["lots"] }) {
  return <section className="card"><div className="card-title"><h3>تنبيهات الدفعات والصلاحية</h3></div>
    {lots.length ? lots.map((lot) => <div className="notice" key={lot.id}>
      <b>{state.items.find((item) => item.id === lot.itemId)?.name} · {lot.code}</b>
      <span>ينتهي في {lot.expiryDate} · المتبقي {quantity(lot.quantity)}</span>
      </div>) : <p className="muted-empty">لا توجد دفعات تقترب من انتهاء الصلاحية.</p>}
  </section>;
}

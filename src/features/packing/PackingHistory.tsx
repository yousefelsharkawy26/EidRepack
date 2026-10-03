import { Ban, Copy } from "lucide-react";
import type { AppState, Packing } from "../../lib/domain";
import { quantity } from "../../lib/domain";
import { PaginationBar, usePagination } from "../../shared/ui/Pagination";

export default function PackingHistory({ state, packings, onCancel, onCopy, canCancel }: { state: AppState; packings: Packing[]; onCancel: (packing: Packing) => void; onCopy: (packing: Packing) => void; canCancel: boolean }) {
  const sorted = [...packings].sort((a,b)=>b.date.localeCompare(a.date));
  const { pageItems, pagination } = usePagination(sorted);
  if (!packings.length) return null;
  return <section className="card card-flush panel-spaced"><div className="card-title panel-title-inset"><div><h3>سجل أوامر التعبئة</h3><span>الأوامر المعتمدة للعرض والنسخ؛ الإلغاء متاح فقط قبل استهلاك دفعة الإنتاج</span></div></div>
    <div className="data-table"><table><thead><tr><th>الأمر</th><th>المنتج</th><th>العبوات</th><th>الفاقد</th><th>التاريخ</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{pageItems.map((packing) => {
      const item = state.items.find((entry) => entry.id === packing.itemId);
      const cancelled = packing.status === "cancelled";
      return <tr key={packing.id}><td className="name-cell"><b>{packing.number}</b></td><td>{item?.name || "—"}</td><td>{quantity(packing.units, item?.baseUnit)}</td><td>{quantity(packing.waste, state.items.find(entry => entry.id === item?.recipe?.find(line => line.kind === 'raw')?.itemId)?.baseUnit)}</td><td>{packing.date}</td><td><span className={"status " + (cancelled ? "gray" : "green")}>{cancelled ? "ملغى" : "معتمد"}</span></td>
        <td className="table-actions-cell"><button className="secondary" disabled={!item?.active} onClick={() => onCopy(packing)}><Copy size={14} /> كأمر جديد</button>{canCancel && !cancelled && <button className="danger" onClick={() => onCancel(packing)}><Ban size={14} /> إلغاء</button>}</td></tr>;
    })}</tbody></table></div><PaginationBar state={pagination}/>
  </section>;
}

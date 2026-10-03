import { Ban } from "lucide-react";
import type { AppState, Packing } from "../../lib/domain";
import { quantity } from "../../lib/domain";

export default function PackingHistory({ state, packings, onCancel }: { state: AppState; packings: Packing[]; onCancel: (packing: Packing) => void }) {
  if (!packings.length) return null;
  return <section className="card card-flush panel-spaced"><div className="card-title panel-title-inset"><div><h3>إلغاء أوامر التعبئة</h3><span>متاح فقط إذا لم يُستهلك أي جزء من دفعة الإنتاج</span></div></div>
    <table><thead><tr><th>الأمر</th><th>المنتج</th><th>العبوات</th><th>التاريخ</th><th /></tr></thead><tbody>{packings.map((packing) => {
      const item = state.items.find((entry) => entry.id === packing.itemId);
      return <tr key={packing.id}><td className="name-cell"><b>{packing.number}</b></td><td>{item?.name || "—"}</td><td>{quantity(packing.units, item?.baseUnit)}</td><td>{packing.date}</td>
        <td><button className="danger" onClick={() => onCancel(packing)}><Ban size={14} /> إلغاء الأمر</button></td></tr>;
    })}</tbody></table>
  </section>;
}

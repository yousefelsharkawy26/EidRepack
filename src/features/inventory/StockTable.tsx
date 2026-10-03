import type { Item, UserRole } from "../../lib/domain";
import { money, quantity } from "../../lib/domain";

interface Props {
  items: Item[];
  role: UserRole;
  onAdjust: (item: Item) => void;
  onEdit: (item: Item) => void;
  onToggleActive: (item: Item) => void;
}

export default function StockTable({ items, role, onAdjust, onEdit, onToggleActive }: Props) {
  return <section className="card card-flush">
    <table>
      <thead><tr><th>الصنف</th><th>النوع</th><th>الرصيد الحالي</th><th>الحد الأدنى</th><th>متوسط التكلفة</th><th>قيمة المخزون</th><th>الحالة</th><th>إدارة</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id} className={item.active === false ? "inactive-item" : ""}>
        <td className="name-cell"><b>{item.name}</b><small>{item.sku} · {item.baseUnit}</small></td>
        <td>{item.type === "raw" ? "مادة خام" : item.type === "packaging" ? "تغليف" : "منتج جاهز"}</td>
        <td>{quantity(item.stock, item.baseUnit)}</td><td>{quantity(item.minStock, item.baseUnit)}</td>
        <td>{money(item.unitCost)}</td><td>{money(item.stock * item.unitCost)}</td>
        <td><span className={"status " + (item.active === false ? "gray" : item.stock <= item.minStock ? "red" : item.stock <= item.minStock * 1.5 ? "yellow" : "green")}>
          {item.active === false ? "معطل" : item.stock <= item.minStock ? "أعد الطلب" : "سليم"}
        </span></td>
        <td className="table-actions-cell-tight"><button className="secondary" onClick={() => onAdjust(item)}>جرد</button>
          {role === "owner" && <><button className="secondary" onClick={() => onEdit(item)}>تعديل</button><button className="secondary" onClick={() => onToggleActive(item)}>{item.active === false ? "تفعيل" : "تعطيل"}</button></>}
        </td>
      </tr>)}</tbody>
    </table>
  </section>;
}

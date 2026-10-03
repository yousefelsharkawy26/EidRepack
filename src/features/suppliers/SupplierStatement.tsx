import type { AppState, Purchase } from "../../lib/domain";
import { money, quantity } from "../../lib/domain";
import { PaginationBar, usePagination } from "../../shared/ui/Pagination";

export default function SupplierStatement({ state, canManage, returnedValue, returnedQuantity, returnableQuantity, onReturn }: {
  state: AppState; canManage: boolean; returnedValue: (purchase: Purchase) => number;
  returnedQuantity: (purchase: Purchase) => number; returnableQuantity: (purchase: Purchase) => number;
  onReturn: (purchase: Purchase, quantity: number) => void;
}) {
  const ordered = [...state.purchases].sort((a, b) => b.date.localeCompare(a.date));
  const { pageItems, pagination } = usePagination(ordered);
  return <section className="card supplier-purchases"><div className="card-title"><div><h3>فواتير الشراء ومرتجعات المورد</h3><span>حد المرتجع هو الكمية المتبقية في الفاتورة ورصيد الصنف الحالي</span></div></div>
    <div className="supplier-purchase-table"><table><thead><tr><th>الفاتورة</th><th>المورد</th><th>الصنف</th><th>كمية الشراء</th><th>مرتجع سابق</th><th>الرصيد القابل للمرتجع</th><th>قيمة الفاتورة</th><th /></tr></thead>
      <tbody>{pageItems.map((purchase) => {
        const item = state.items.find((candidate) => candidate.id === purchase.itemId);
        const qty = purchase.quantity || 0; const returned = returnedQuantity(purchase); const maxReturn = returnableQuantity(purchase);
        return <tr key={purchase.id}><td className="name-cell"><b>{purchase.number}</b><small>{purchase.supplierInvoiceNumber || purchase.date}</small></td>
          <td>{state.suppliers.find((supplier) => supplier.id === purchase.supplierId)?.name || "—"}</td><td>{item?.name || "بيانات الصنف غير متاحة"}</td>
          <td>{qty ? quantity(qty, item?.baseUnit) : "—"}</td><td>{quantity(returned, item?.baseUnit)}</td><td>{quantity(maxReturn, item?.baseUnit)}</td><td>{money(purchase.total - returnedValue(purchase))}</td>
          <td><button className="secondary" disabled={!canManage || maxReturn <= 0} onClick={() => onReturn(purchase, maxReturn)}>تسجيل مرتجع</button></td></tr>;
      })}</tbody>
    </table><PaginationBar state={pagination}/></div>
  </section>;
}

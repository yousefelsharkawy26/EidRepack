import type { Dispatch, SetStateAction } from "react";
import type { AppState, Item, Supplier } from "../../lib/domain";
import { daysFromNow, money } from "../../lib/domain";
import { Field } from "../../shared/ui/Field";

interface Props {
  state: AppState; rawItems: Item[]; supplier?: Supplier | undefined; effectiveSupplierId: string; setSupplierId: Dispatch<SetStateAction<string>>;
  effectiveItemId: string; setItemId: Dispatch<SetStateAction<string>>; qty: number; setQty: Dispatch<SetStateAction<number>>;
  price: number; setPrice: Dispatch<SetStateAction<number>>; shipping: number; setShipping: Dispatch<SetStateAction<number>>;
  paid: number; setPaid: Dispatch<SetStateAction<number>>; purchaseDate: string; setPurchaseDate: Dispatch<SetStateAction<string>>;
  supplierInvoiceNumber: string; setSupplierInvoiceNumber: Dispatch<SetStateAction<string>>; dueDate: string; setDueDate: Dispatch<SetStateAction<string>>;
  total: number; landed: number; supplierCreditDays: number;
}

export default function PurchaseForm(p: Props) {
  return <div className="workspace"><section className="form-card"><div className="form-top">
    <Field label="المورد"><select value={p.effectiveSupplierId} onChange={(event) => p.setSupplierId(event.target.value)}>{p.state.suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></Field>
    <Field label="التاريخ"><input type="date" value={p.purchaseDate} onChange={(event) => p.setPurchaseDate(event.target.value)} /></Field>
    <Field label="رقم فاتورة المورد"><input value={p.supplierInvoiceNumber} onChange={(event) => p.setSupplierInvoiceNumber(event.target.value)} placeholder="اختياري" /></Field>
  </div><div className="lines"><div className="line-grid header"><span>الصنف</span><span>الكمية</span><span>سعر الكيلو / الوحدة</span><span>الإجمالي</span><span /></div>
    <div className="line-grid"><div className="field"><select value={p.effectiveItemId} onChange={(event) => p.setItemId(event.target.value)}>{p.rawItems.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
      <div className="field"><input type="number" value={p.qty} min="1" onChange={(event) => p.setQty(Number(event.target.value))} /></div>
      <div className="field"><input type="number" value={p.price} min="0" onChange={(event) => p.setPrice(Number(event.target.value))} /></div><div className="line-total">{money(p.qty * p.price)}</div><span /></div>
  </div><div className="purchase-controls-grid">
    <Field label="مصاريف إضافية (شحن/تحميل)"><input type="number" min="0" value={p.shipping} onChange={(event) => p.setShipping(Number(event.target.value))} /></Field>
    <Field label="المبلغ المدفوع الآن"><input type="number" min="0" max={p.total} value={p.paid} onChange={(event) => p.setPaid(Number(event.target.value))} /></Field>
    {p.paid < p.total && <Field label="تاريخ استحقاق الرصيد"><input type="date" value={p.dueDate || daysFromNow(p.supplierCreditDays)} onChange={(event) => p.setDueDate(event.target.value)} /></Field>}
  </div><div className="totals"><div className="total-row"><span>التكلفة الفعلية للوحدة بعد المصاريف</span><span>{money(p.landed)}</span></div><div className="total-row final"><span>إجمالي الفاتورة</span><span>{money(p.total)}</span></div></div>
  </section><aside className="customer-panel"><h3>معاينة التكلفة</h3><p>تُوزَّع مصاريف الشحن على بنود الفاتورة لتكوين التكلفة الفعلية.</p>
    <div className="mini-stat"><span>سعر الشراء</span><strong>{money(p.price)}</strong></div><div className="mini-stat"><span>نصيب الوحدة من الشحن</span><strong>{money(p.shipping / Math.max(p.qty, 1))}</strong></div>
    <div className="mini-stat"><span>التكلفة الفعلية</span><strong className="purchase-cost-value">{money(p.landed)}</strong></div><div className="mini-stat"><span>المتبقي للمورد</span><strong>{money(p.total - p.paid)}</strong></div>
  </aside></div>;
}

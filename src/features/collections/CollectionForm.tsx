import type { Dispatch, SetStateAction } from "react";
import Modal from "../../components/Modal";
import type { AppState, Sale } from "../../lib/domain";
import { money } from "../../shared/lib/money";

type PaymentMethod = "cash" | "transfer" | "wallet";
interface Props {
  state: AppState; open: boolean; openSales: Sale[]; selected: Sale | null;
  paymentCustomerId: string; setPaymentCustomerId: Dispatch<SetStateAction<string>>;
  amount: number; setAmount: Dispatch<SetStateAction<number>>;
  paymentMethod: PaymentMethod; setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
  paymentDate: string; setPaymentDate: Dispatch<SetStateAction<string>>;
  promiseDate: string; setPromiseDate: Dispatch<SetStateAction<string>>;
  onSelectSale: (sale: Sale) => void; onRecordPayment: () => void;
  onSavePromise: () => void; onClose: () => void;
}

export default function CollectionForm({ state, open, openSales, selected, paymentCustomerId, setPaymentCustomerId, amount, setAmount, paymentMethod, setPaymentMethod, paymentDate, setPaymentDate, promiseDate, setPromiseDate, onSelectSale, onRecordPayment, onSavePromise, onClose }: Props) {
  if (!open) return null;
  return <Modal title="تسجيل تحصيل أو وعد بالسداد" onClose={onClose}>
    {!selected && <>
      <div className="field"><label>العميل</label><select autoFocus value={paymentCustomerId} onChange={(event) => setPaymentCustomerId(event.target.value)}>
        <option value="">اختر العميل</option>{state.customers.filter((customer) => openSales.some((sale) => sale.customerId === customer.id)).map((customer) => <option key={customer.id} value={customer.id}>
          {customer.name} · إجمالي المتبقي {money(openSales.filter((sale) => sale.customerId === customer.id).reduce((sum, sale) => sum + sale.total - sale.paid, 0))}
        </option>)}
      </select></div>
      {paymentCustomerId && <div className="field field-spaced"><label>الفاتورة المفتوحة</label><select value="" onChange={(event) => {
        const sale = openSales.find((candidate) => candidate.id === event.target.value);
        if (sale) onSelectSale(sale);
      }}><option value="">اختر الفاتورة</option>{openSales.filter((sale) => sale.customerId === paymentCustomerId).map((sale) => <option key={sale.id} value={sale.id}>
        {sale.number} · المتبقي {money(sale.total - sale.paid)} · الاستحقاق {sale.dueDate || "—"}
      </option>)}</select></div>}
        <p className="text-secondary">تُسجَّل الدفعة على الفاتورة التي تختارها فقط؛ لا يوجد اختيار تلقائي.</p>
    </>}
    {selected && <>
      <p>{selected.number} · {state.customers.find((customer) => customer.id === selected.customerId)?.name} · المتبقي {money(selected.total - selected.paid)}</p>
      <div className="field"><label>مبلغ التحصيل</label><input autoFocus type="number" min="0.01" max={selected.total - selected.paid} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></div>
      <div className="supplier-form-grid field-spaced">
        <div className="field"><label>طريقة الدفع</label><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
          <option value="cash">نقدي</option><option value="transfer">تحويل بنكي</option><option value="wallet">محفظة إلكترونية</option>
        </select></div>
        <div className="field"><label>تاريخ الدفعة</label><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></div>
      </div>
      <div className="field field-spaced"><label>تاريخ وعد السداد (للوعد فقط)</label><input type="date" value={promiseDate} onChange={(event) => setPromiseDate(event.target.value)} /></div>
      <div className="modal-actions"><button className="primary" onClick={onRecordPayment}>تسجيل الدفعة</button><button className="secondary" onClick={onSavePromise}>تسجيل الوعد</button><button className="danger" onClick={onClose}>إلغاء</button></div>
    </>}
  </Modal>;
}

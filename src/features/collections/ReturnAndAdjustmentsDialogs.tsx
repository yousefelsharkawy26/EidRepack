import type { Dispatch, SetStateAction } from "react";
import Modal from "../../components/Modal";
import type { AppState, CustomerPayment, Sale } from "../../lib/domain";
import { money } from "../../shared/lib/money";
import { quantity } from "../../shared/lib/units";
import { statusLabel } from "../../shared/ui/StatusBadge";
import { saleStatus } from "../../lib/domain";

interface Props {
  state: AppState; busy: boolean;
  returnOpen: boolean; setReturnOpen: Dispatch<SetStateAction<boolean>>;
  returning: Sale | null; setReturning: Dispatch<SetStateAction<Sale | null>>;
  returnLineIndex: number; setReturnLineIndex: Dispatch<SetStateAction<number>>;
  returnQty: number; setReturnQty: Dispatch<SetStateAction<number>>;
  returnReason: string; setReturnReason: Dispatch<SetStateAction<string>>;
  returnableQuantity: (sale: Sale, lineIndex: number) => number; onConfirmReturn: () => void;
  reversingPayment: CustomerPayment | null; setReversingPayment: Dispatch<SetStateAction<CustomerPayment | null>>;
  reversalReason: string; setReversalReason: Dispatch<SetStateAction<string>>; onConfirmReversal: () => void;
}

export default function ReturnAndAdjustmentsDialogs(props: Props) {
  const { state, busy, returnOpen, setReturnOpen, returning, setReturning, returnLineIndex, setReturnLineIndex, returnQty, setReturnQty, returnReason, setReturnReason, returnableQuantity, onConfirmReturn, reversingPayment, setReversingPayment, reversalReason, setReversalReason, onConfirmReversal } = props;
  const closeReturn = () => { setReturnOpen(false); setReturning(null); };
  return <>
    {returnOpen && <Modal title="مرتجع مبيعات" onClose={closeReturn}>
      <div className="field"><label>الفاتورة</label><select value={returning?.id || ""} onChange={(event) => {
        const sale = state.sales.find((candidate) => candidate.id === event.target.value) || null;
        setReturning(sale); setReturnLineIndex(0); setReturnQty(1);
      }}><option value="">اختر الفاتورة</option>{state.sales.filter((sale) => sale.status !== "draft" && sale.lines.some((_, index) => returnableQuantity(sale, index) > 0)).map((sale) => <option key={sale.id} value={sale.id}>
        {sale.number} · {state.customers.find((customer) => customer.id === sale.customerId)?.name} · {statusLabel(saleStatus(sale))}
      </option>)}</select></div>
      {returning && <>
        {returning.lines.length > 1 && <div className="field field-spaced"><label>البند المرتجع</label><select value={returnLineIndex} onChange={(event) => { setReturnLineIndex(Number(event.target.value)); setReturnQty(1); }}>
          {returning.lines.map((line, index) => { const item = state.items.find((candidate) => candidate.id === line.itemId); return <option key={index} value={index} disabled={returnableQuantity(returning, index) <= 0}>{item?.name || line.itemId} · قابل للمرتجع {quantity(returnableQuantity(returning, index), item?.baseUnit)}</option>; })}
        </select></div>}
        <p>يُعاد المنتج للمخزون ويُخفض رصيد العميل بما لا يتجاوز المتبقي على الفاتورة؛ وأي مبلغ مدفوع زيادة يُسجَّل كمبلغ مردود للعميل في كشف الحساب.</p>
        <div className="field"><label>الكمية المرتجعة (الحد الأقصى {quantity(returnableQuantity(returning, returnLineIndex), state.items.find((item) => item.id === returning.lines[returnLineIndex]?.itemId)?.baseUnit)})</label>
          <input autoFocus type="number" min="0.01" step="0.01" max={returnableQuantity(returning, returnLineIndex)} value={returnQty} onChange={(event) => setReturnQty(Number(event.target.value))} /></div>
        <div className="field field-spaced"><label>سبب المرتجع</label><input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></div>
        <div className="modal-actions"><button className="primary" onClick={onConfirmReturn}>اعتماد المرتجع</button><button className="danger" onClick={closeReturn}>إلغاء</button></div>
      </>}
    </Modal>}
    {reversingPayment && <Modal title="عكس دفعة محصلة" onClose={() => setReversingPayment(null)}>
      <p>سيُعاد مبلغ {money(reversingPayment.amount)} إلى رصيد العميل وتُعاد فتح الفاتورة المرتبطة، مع بقاء الدفعتين (الأصلية والعكسية) في السجل للتدقيق.</p>
      <div className="field field-spaced"><label>سبب العكس</label><input autoFocus value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="مثال: دفعة سُجلت لعميل آخر بالخطأ" /></div>
      <div className="modal-actions"><button className="danger" onClick={onConfirmReversal} disabled={busy}>تأكيد العكس</button><button className="secondary" onClick={() => setReversingPayment(null)}>رجوع</button></div>
    </Modal>}
  </>;
}

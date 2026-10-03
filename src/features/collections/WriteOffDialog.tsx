import type { Dispatch, SetStateAction } from "react";
import Modal from "../../components/Modal";
import type { Sale } from "../../lib/domain";
import { money } from "../../shared/lib/money";

export default function WriteOffDialog({ sale, setSale, reason, setReason, busy, onConfirm }: {
  sale: Sale | null; setSale: Dispatch<SetStateAction<Sale | null>>;
  reason: string; setReason: Dispatch<SetStateAction<string>>; busy: boolean; onConfirm: () => void;
}) {
  if (!sale) return null;
  return <Modal title={"شطب مديونية الفاتورة " + sale.number} onClose={() => setSale(null)}>
    <p>سيُشطب المتبقي {money(sale.total - sale.paid)} وتُقفل الفاتورة مع بقاء السجل كاملًا في قاعدة البيانات وسجل التدقيق. هذا الإجراء للمالك فقط.</p>
    <div className="field field-spaced"><label>سبب الشطب</label><input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: عميل متعثر منذ أكثر من سنة" /></div>
    <div className="modal-actions"><button className="danger" onClick={onConfirm} disabled={busy}>تأكيد الشطب</button><button className="secondary" onClick={() => setSale(null)}>رجوع</button></div>
  </Modal>;
}

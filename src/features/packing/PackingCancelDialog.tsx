import type { Dispatch, SetStateAction } from "react";
import type { Packing } from "../../lib/domain";
import Modal from "../../components/Modal";

export default function PackingCancelDialog({ packing, reason, setReason, busy, onClose, onConfirm }: { packing: Packing | null; reason: string; setReason: Dispatch<SetStateAction<string>>; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  if (!packing) return null;
  return <Modal title={"إلغاء أمر التعبئة " + packing.number} onClose={onClose}><p>ستعود كل المدخلات إلى دفعاتها وتُبطل دفعة الإنتاج. لا يمكن الإلغاء إذا بيع أو استُهلك أي جزء من الإنتاج.</p>
    <div className="field field-spaced"><label>سبب الإلغاء</label><input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: خطأ في كمية الإنتاج" /></div>
    <div className="modal-actions"><button className="danger" onClick={onConfirm} disabled={busy}>تأكيد الإلغاء</button><button className="secondary" onClick={onClose}>رجوع</button></div>
  </Modal>;
}

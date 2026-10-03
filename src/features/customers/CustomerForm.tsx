import type { Dispatch, SetStateAction } from "react";
import Modal from "../../components/Modal";
import type { Customer } from "../../lib/domain";

export default function CustomerForm({ open, editing, isOwner, busy, onClose, onSave, name, setName, phone, setPhone, whatsapp, setWhatsapp, creditLimit, setCreditLimit, creditDays, setCreditDays, openingBalance, setOpeningBalance, notes, setNotes }: {
  open: boolean; editing: Customer | null; isOwner: boolean; busy: boolean; onClose: () => void; onSave: () => void;
  name: string; setName: Dispatch<SetStateAction<string>>; phone: string; setPhone: Dispatch<SetStateAction<string>>;
  whatsapp: string; setWhatsapp: Dispatch<SetStateAction<string>>; creditLimit: number; setCreditLimit: Dispatch<SetStateAction<number>>;
  creditDays: number; setCreditDays: Dispatch<SetStateAction<number>>; openingBalance: number; setOpeningBalance: Dispatch<SetStateAction<number>>;
  notes: string; setNotes: Dispatch<SetStateAction<string>>;
}) {
  if (!open) return null;
  return <Modal title={editing ? "تعديل بيانات العميل" : "عميل جديد"} onClose={onClose}><div className="field"><label>اسم العميل</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: سوبر ماركت الهدى" /></div>
    <div className="supplier-form-grid field-spaced"><div className="field"><label>الهاتف</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div><div className="field"><label>رقم واتساب</label><input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="01xxxxxxxxx" /></div>
      {isOwner && <><div className="field"><label>حد الائتمان بالجنيه</label><input type="number" min="0" value={creditLimit} onChange={(e) => setCreditLimit(Number(e.target.value))} placeholder="0 = بيع نقدي فقط" /></div><div className="field"><label>فترة السداد (أيام)</label><input type="number" min="0" value={creditDays} onChange={(e) => setCreditDays(Number(e.target.value))} /></div></>}
      {!editing && isOwner && <div className="field"><label>رصيد افتتاحي مستحق على العميل</label><input type="number" min="0" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(Number(e.target.value))} /></div>}
    </div>{!isOwner && <p className="text-secondary field-spaced">حدود الائتمان والأرصدة الافتتاحية يديرها المالك فقط.</p>}
    <div className="field field-spaced"><label>ملاحظات</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="شروط خاصة، مواعيد تسليم…" /></div>
    <div className="modal-actions"><button className="primary" onClick={onSave} disabled={busy}>{editing ? "حفظ التعديلات" : "حفظ العميل"}</button><button className="secondary" onClick={onClose}>إلغاء</button></div>
  </Modal>;
}

import type { Dispatch, SetStateAction } from "react";
import Modal from "../../components/Modal";
import type { AppState, Purchase, Supplier } from "../../lib/domain";
import { money, quantity } from "../../lib/domain";

type PaymentMethod = "cash" | "transfer" | "wallet";
interface Props {
  state: AppState; busy: boolean;
  returningPurchase: Purchase | null; setReturningPurchase: Dispatch<SetStateAction<Purchase | null>>;
  returnQuantity: number; setReturnQuantity: Dispatch<SetStateAction<number>>; returnReason: string; setReturnReason: Dispatch<SetStateAction<string>>;
  returnableQuantity: (purchase: Purchase) => number; onConfirmReturn: () => void;
  supplierFormOpen: boolean; setSupplierFormOpen: Dispatch<SetStateAction<boolean>>; editing: Supplier | null; onSaveSupplier: () => void;
  name: string; setName: Dispatch<SetStateAction<string>>; phone: string; setPhone: Dispatch<SetStateAction<string>>; whatsapp: string; setWhatsapp: Dispatch<SetStateAction<string>>;
  address: string; setAddress: Dispatch<SetStateAction<string>>; notes: string; setNotes: Dispatch<SetStateAction<string>>;
  creditDays: number; setCreditDays: Dispatch<SetStateAction<number>>; openingBalance: number; setOpeningBalance: Dispatch<SetStateAction<number>>;
  payingSupplier: Supplier | null; setPayingSupplier: Dispatch<SetStateAction<Supplier | null>>; paymentAmount: number; setPaymentAmount: Dispatch<SetStateAction<number>>;
  paymentDate: string; setPaymentDate: Dispatch<SetStateAction<string>>; paymentMethod: PaymentMethod; setPaymentMethod: Dispatch<SetStateAction<PaymentMethod>>;
  paymentReference: string; setPaymentReference: Dispatch<SetStateAction<string>>; paymentNote: string; setPaymentNote: Dispatch<SetStateAction<string>>; onRecordPayment: () => void;
}

type ReturnDialogProps = Pick<Props, "state" | "busy" | "returnableQuantity"> & {
  purchase: Purchase | null; setPurchase: Dispatch<SetStateAction<Purchase | null>>;
  amount: number; setAmount: Dispatch<SetStateAction<number>>; reason: string;
  setReason: Dispatch<SetStateAction<string>>; onConfirm: () => void;
};
function SupplierReturnDialog({ state, busy, purchase, setPurchase, amount, setAmount, reason, setReason, returnableQuantity, onConfirm }: ReturnDialogProps) {
  if (!purchase) return null;
  const close = () => setPurchase(null);
  return <Modal title="مرتجع مشتريات للمورد" onClose={close}><p>{purchase.number} · {state.suppliers.find((entry) => entry.id === purchase.supplierId)?.name} · المتاح للمرتجع {quantity(returnableQuantity(purchase), state.items.find((item) => item.id === purchase.itemId)?.baseUnit)}</p>
    <div className="field"><label>الكمية المرتجعة</label><input autoFocus type="number" min="0.01" max={returnableQuantity(purchase)} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></div>
    <div className="field field-spaced"><label>سبب المرتجع</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>
    <p>قيمة إشعار الدائن: {money(amount * (purchase.unitCost || 0))}</p>
    <div className="modal-actions"><button className="primary" onClick={onConfirm} disabled={busy}>اعتماد المرتجع</button><button className="secondary" onClick={close}>إلغاء</button></div>
  </Modal>;
}

type SupplierFormProps = Pick<Props, "editing" | "busy" | "name" | "setName" | "phone" | "setPhone" | "whatsapp" | "setWhatsapp" | "creditDays" | "setCreditDays" | "openingBalance" | "setOpeningBalance" | "address" | "setAddress" | "notes" | "setNotes"> & { open: boolean; setOpen: Dispatch<SetStateAction<boolean>>; onSave: () => void };
export function SupplierForm({ open, setOpen, editing, busy, onSave, name, setName, phone, setPhone, whatsapp, setWhatsapp, creditDays, setCreditDays, openingBalance, setOpeningBalance, address, setAddress, notes, setNotes }: SupplierFormProps) {
  if (!open) return null;
  return <Modal title={editing ? "تعديل بيانات المورد" : "إضافة مورد"} onClose={() => setOpen(false)}><div className="field"><label>اسم المورد</label><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></div>
    <div className="supplier-form-grid"><div className="field"><label>الهاتف</label><input value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
      <div className="field"><label>واتساب</label><input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} /></div>
      <div className="field"><label>فترة السداد الافتراضية بالأيام</label><input type="number" min="0" value={creditDays} onChange={(event) => setCreditDays(Number(event.target.value))} /></div>
      {!editing && <div className="field"><label>الرصيد الافتتاحي المستحق</label><input type="number" min="0" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(Number(event.target.value))} /></div>}
      <div className="field"><label>العنوان</label><input value={address} onChange={(event) => setAddress(event.target.value)} /></div>
      <div className="field"><label>ملاحظات</label><input value={notes} onChange={(event) => setNotes(event.target.value)} /></div>
    </div><div className="modal-actions"><button className="primary" onClick={onSave} disabled={busy}>حفظ البيانات</button><button className="secondary" onClick={() => setOpen(false)}>إلغاء</button></div>
  </Modal>;
}

type PaymentFormProps = Pick<Props, "busy"> & {
  supplier: Supplier | null; setSupplier: Dispatch<SetStateAction<Supplier | null>>;
  amount: number; setAmount: Dispatch<SetStateAction<number>>; date: string;
  setDate: Dispatch<SetStateAction<string>>; method: PaymentMethod;
  setMethod: Dispatch<SetStateAction<PaymentMethod>>; reference: string;
  setReference: Dispatch<SetStateAction<string>>; note: string;
  setNote: Dispatch<SetStateAction<string>>; onSave: () => void;
};
export function PaymentForm({ supplier, setSupplier, busy, amount, setAmount, date, setDate, method, setMethod, reference, setReference, note, setNote, onSave }: PaymentFormProps) {
  if (!supplier) return null;
  return <Modal title="تسجيل سداد مورد" onClose={() => setSupplier(null)}><p>{supplier.name} · الرصيد المستحق {money(supplier.balance)}</p>
    <div className="field"><label>مبلغ السداد</label><input type="number" min="0.01" max={supplier.balance} step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></div>
    <div className="supplier-form-grid"><div className="field"><label>تاريخ السداد</label><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      <div className="field"><label>وسيلة السداد</label><select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}><option value="cash">نقدي</option><option value="transfer">تحويل بنكي</option><option value="wallet">محفظة إلكترونية</option></select></div>
      <div className="field"><label>رقم مرجعي</label><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="رقم إيصال/تحويل" /></div>
      <div className="field"><label>ملاحظات</label><input value={note} onChange={(event) => setNote(event.target.value)} /></div>
    </div><div className="modal-actions"><button className="primary" onClick={onSave} disabled={busy}>اعتماد السداد</button><button className="secondary" onClick={() => setSupplier(null)}>إلغاء</button></div>
  </Modal>;
}

export default function SupplierForms(props: Props) {
  return <>
    <SupplierReturnDialog state={props.state} busy={props.busy} purchase={props.returningPurchase} setPurchase={props.setReturningPurchase} amount={props.returnQuantity} setAmount={props.setReturnQuantity} reason={props.returnReason} setReason={props.setReturnReason} returnableQuantity={props.returnableQuantity} onConfirm={props.onConfirmReturn} />
    <SupplierForm {...props} open={props.supplierFormOpen} setOpen={props.setSupplierFormOpen} onSave={props.onSaveSupplier} />
    <PaymentForm {...props} supplier={props.payingSupplier} setSupplier={props.setPayingSupplier} amount={props.paymentAmount} setAmount={props.setPaymentAmount} date={props.paymentDate} setDate={props.setPaymentDate} method={props.paymentMethod} setMethod={props.setPaymentMethod} reference={props.paymentReference} setReference={props.setPaymentReference} note={props.paymentNote} setNote={props.setPaymentNote} onSave={props.onRecordPayment} />
  </>;
}

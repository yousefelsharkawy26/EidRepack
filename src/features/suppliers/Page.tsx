import { useState } from "react";
import { toBase, toMinor } from "../../lib/api";
import { useApp } from "../../app/AppProvider";
import { daysFromNow, money, Purchase, quantity, Supplier, today } from "../../lib/domain";
import { Plus } from "lucide-react";
import { printSupplierStatement } from "../print";
import SupplierList from "./SupplierList";
import SupplierStatement from "./SupplierStatement";
import SupplierForms from "./SupplierForms";

function Suppliers() {
  const { state, currentUser } = useApp();
  if (!state || !currentUser) return null;
  return <SuppliersContent />;
}

function SuppliersContent() {
  const { state: snapshot, run, busy, currentUser: session, notify } = useApp();
  const state = snapshot!;
  const currentUser = session!;
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [creditDays, setCreditDays] = useState(15);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [payingSupplier, setPayingSupplier] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "transfer" | "wallet"
  >("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [returningPurchase, setReturningPurchase] = useState<Purchase | null>(
    null,
  );
  const [returnQuantity, setReturnQuantity] = useState(1);
  const [returnReason, setReturnReason] = useState("بضاعة مرتجعة للمورد");
  const canManage =
    currentUser.role === "owner" || currentUser.role === "purchasing";
  const openForm = (supplier?: Supplier) => {
    setEditing(supplier || null);
    setName(supplier?.name || "");
    setPhone(supplier?.phone || "");
    setWhatsapp(supplier?.whatsapp || "");
    setAddress(supplier?.address || "");
    setNotes(supplier?.notes || "");
    setCreditDays(supplier?.creditDays ?? 15);
    setOpeningBalance(supplier?.balance || 0);
    setSupplierFormOpen(true);
  };
  // UX hint — backend is authoritative.
  const saveSupplier = () => {
    if (
      !name.trim() ||
      !Number.isFinite(creditDays) ||
      creditDays < 0 ||
      (!editing && (!Number.isFinite(openingBalance) || openingBalance < 0))
    )
      return notify("أدخل اسم المورد وفترة سداد ورصيدًا افتتاحيًا صحيحًا.");
    void run(
      "supplier:save",
      {
          id: editing?.id,
          name: name.trim(),
          phone: phone.trim(),
          whatsapp: whatsapp.trim(),
          address: address.trim(),
          notes: notes.trim(),
          creditDays: Math.round(creditDays),
          openingBalanceMinor:
            !editing && openingBalance > 0
              ? toMinor(openingBalance)
              : undefined,
      },
      editing
        ? "تم تحديث بيانات المورد."
        : "تمت إضافة المورد ورصيده الافتتاحي.",
    ).then((ok) => {
      if (ok) setSupplierFormOpen(false);
    });
  };
  const recordPayment = () => {
    if (
      !payingSupplier ||
      !Number.isFinite(paymentAmount) ||
      paymentAmount <= 0 ||
      paymentAmount > payingSupplier.balance ||
      !paymentDate
    )
      return notify("أدخل مبلغ سداد صحيحًا لا يتجاوز رصيد المورد.");
    void run(
      "supplier:pay",
      {
          supplierId: payingSupplier.id,
          amountMinor: toMinor(paymentAmount),
          method: paymentMethod,
          date: paymentDate,
          reference: paymentReference.trim() || undefined,
          notes: paymentNote.trim() || "سداد للمورد",
      },
      "تم تسجيل السداد وتحديث رصيد المورد وكشف حسابه.",
    ).then((ok) => {
      if (ok) {
        setPayingSupplier(null);
        setPaymentAmount(0);
        setPaymentReference("");
        setPaymentNote("");
        setPaymentDate(today());
      }
    });
  };
  const returnedValue = (purchase: Purchase) =>
    state.purchaseReturns
      .filter((item) => item.purchaseId === purchase.id)
      .reduce((sum, item) => sum + item.value, 0);
  const returnedQuantity = (purchase: Purchase) =>
    state.purchaseReturns
      .filter((item) => item.purchaseId === purchase.id)
      .reduce((sum, item) => sum + item.quantity, 0);
  const returnableQuantity = (purchase: Purchase) =>
    Math.max(
      0,
      Math.min(
        (purchase.quantity || 0) - returnedQuantity(purchase),
        state.items.find((item) => item.id === purchase.itemId)?.stock || 0,
      ),
    );
  // Later supplier payments are allocated FIFO (oldest invoice first) so a
  // purchase settled later no longer stays "due" forever.
  const outstandingByPurchase = (supplierId: string) => {
    let pool = state.supplierPayments
      .filter((payment) => payment.supplierId === supplierId)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const result = new Map<string, number>();
    state.purchases
      .filter((purchase) => purchase.supplierId === supplierId)
      .sort((first, second) => first.date.localeCompare(second.date))
      .forEach((purchase) => {
        const remaining = Math.max(
          purchase.total - purchase.paid - returnedValue(purchase),
          0,
        );
        const applied = Math.min(remaining, pool);
        pool -= applied;
        result.set(purchase.id, remaining - applied);
      });
    return result;
  };
  const outstanding = new Map<string, number>();
  state.suppliers.forEach((supplier) =>
    outstandingByPurchase(supplier.id).forEach((value, key) =>
      outstanding.set(key, value),
    ),
  );
  const dueSoon = state.purchases
    .filter(
      (purchase) =>
        (outstanding.get(purchase.id) || 0) > 0 &&
        purchase.dueDate &&
        purchase.dueDate <= daysFromNow(7),
    )
    .sort((first, second) =>
      (first.dueDate || "").localeCompare(second.dueDate || ""),
    );
  const confirmPurchaseReturn = () => {
    if (!returningPurchase) return;
    const item = state.items.find(
      (candidate) => candidate.id === returningPurchase.itemId,
    );
    const available = returnableQuantity(returningPurchase);
    const unitCost = returningPurchase.unitCost;
    if (
      !item ||
      !returningPurchase.itemId ||
      unitCost == null ||
      !Number.isFinite(unitCost) ||
      unitCost < 0 ||
      !Number.isFinite(returnQuantity) ||
      returnQuantity <= 0 ||
      returnQuantity > available ||
      !returnReason.trim()
    )
      return notify(
        "كمية أو بيانات المرتجع غير صالحة؛ تحقق من رصيد المخزون المتاح.",
      );
    void run(
      "purchase:return",
      {
          purchaseId: returningPurchase.id,
          itemId: item.id,
          lotId: returningPurchase.lotId,
          quantity: toBase(returnQuantity, item.unitFactor || 1),
          valueMinor: toMinor(returnQuantity * unitCost),
          number: state.nextNumbers.PRT,
          date: state.today,
          reason: returnReason.trim(),
      },
      "تم اعتماد مرتجع الشراء وتحديث المخزون ورصيد المورد.",
    ).then((ok) => {
      if (ok) {
        setReturningPurchase(null);
        setReturnQuantity(1);
        setReturnReason("بضاعة مرتجعة للمورد");
      }
    });
  };
  return (
    <>
      <div className="section-header">
        <div>
          <h2>الموردون</h2>
          <p>بيانات الموردين، الالتزامات، والسداد</p>
        </div>
        {canManage && (
          <button className="primary" onClick={() => openForm()}>
            <Plus size={15} /> إضافة مورد
          </button>
        )}
      </div>
      {dueSoon.length > 0 && (
        <section className="card supplier-due">
          <div className="card-title">
            <h3>فواتير تستحق خلال ٧ أيام أو متأخرة</h3>
            <span className="status yellow">{dueSoon.length}</span>
          </div>
          {dueSoon.map((purchase) => (
            <div className="mini-stat" key={purchase.id}>
              <span>
                {
                  state.suppliers.find(
                    (item) => item.id === purchase.supplierId,
                  )?.name
                }{" "}
                · {purchase.number} · الاستحقاق {purchase.dueDate}
              </span>
              <strong>{money(outstanding.get(purchase.id) || 0)}</strong>
            </div>
          ))}
        </section>
      )}
      <SupplierList
        state={state}
        canManage={canManage}
        onEdit={openForm}
        onPay={(supplier) => { setPayingSupplier(supplier); setPaymentAmount(supplier.balance); }}
        onPrint={(supplier) => { void printSupplierStatement(state, supplier.id).then((ok) => { if (!ok) notify("تعذرت الطباعة؛ تحقق من إعدادات الطابعة أو السماح بالنوافذ المنبثقة."); }); }}
      />
      <SupplierStatement
        state={state}
        canManage={canManage}
        returnedValue={returnedValue}
        returnedQuantity={returnedQuantity}
        returnableQuantity={returnableQuantity}
        onReturn={(purchase, max) => { setReturningPurchase(purchase); setReturnQuantity(Math.min(1, max)); }}
      />
      <SupplierForms
        state={state} busy={busy}
        returningPurchase={returningPurchase} setReturningPurchase={setReturningPurchase}
        returnQuantity={returnQuantity} setReturnQuantity={setReturnQuantity}
        returnReason={returnReason} setReturnReason={setReturnReason}
        returnableQuantity={returnableQuantity} onConfirmReturn={confirmPurchaseReturn}
        supplierFormOpen={supplierFormOpen} setSupplierFormOpen={setSupplierFormOpen}
        editing={editing} onSaveSupplier={saveSupplier}
        name={name} setName={setName} phone={phone} setPhone={setPhone}
        whatsapp={whatsapp} setWhatsapp={setWhatsapp} address={address} setAddress={setAddress}
        notes={notes} setNotes={setNotes} creditDays={creditDays} setCreditDays={setCreditDays}
        openingBalance={openingBalance} setOpeningBalance={setOpeningBalance}
        payingSupplier={payingSupplier} setPayingSupplier={setPayingSupplier}
        paymentAmount={paymentAmount} setPaymentAmount={setPaymentAmount}
        paymentDate={paymentDate} setPaymentDate={setPaymentDate}
        paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
        paymentReference={paymentReference} setPaymentReference={setPaymentReference}
        paymentNote={paymentNote} setPaymentNote={setPaymentNote}
        onRecordPayment={recordPayment}
      />
    </>
  );
}

export default Suppliers;

import { useState } from "react";
import { callOperation, SessionUser, toBase, toMinor } from "../lib/api";
import { AppState, daysFromNow, money, Purchase, quantity, Supplier, today } from "../lib/domain";
import { FileBarChart, Plus } from "lucide-react";
import { printSupplierStatement } from "../lib/helpers";
import Modal from "../components/Modal";

function Suppliers({
  state,
  run,
  busy,
  currentUser,
  notify,
}: {
  state: AppState;
  run: (
    action: () => Promise<unknown>,
    successMessage?: string,
  ) => Promise<boolean>;
  busy: boolean;
  currentUser: SessionUser;
  notify: (message: string) => void;
}) {
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
  const saveSupplier = () => {
    if (
      !name.trim() ||
      !Number.isFinite(creditDays) ||
      creditDays < 0 ||
      (!editing && (!Number.isFinite(openingBalance) || openingBalance < 0))
    )
      return notify("أدخل اسم المورد وفترة سداد ورصيدًا افتتاحيًا صحيحًا.");
    void run(
      () =>
        callOperation("saveSupplier", {
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
        }),
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
      () =>
        callOperation("recordSupplierPayment", {
          supplierId: payingSupplier.id,
          amountMinor: toMinor(paymentAmount),
          method: paymentMethod,
          date: paymentDate,
          reference: paymentReference.trim() || undefined,
          notes: paymentNote.trim() || "سداد للمورد",
        }),
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
      () =>
        callOperation("returnPurchase", {
          purchaseId: returningPurchase.id,
          itemId: item.id,
          lotId: returningPurchase.lotId,
          quantity: toBase(returnQuantity, item.unitFactor || 1),
          valueMinor: toMinor(returnQuantity * unitCost),
          number: state.nextNumbers.PRT,
          date: state.today,
          reason: returnReason.trim(),
        }),
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
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>المورد</th>
              <th>الهاتف / واتساب</th>
              <th>فترة السداد</th>
              <th>الرصيد المستحق</th>
              <th>آخر فاتورة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {state.suppliers.map((supplier) => {
              const lastPurchase = state.purchases
                .filter((purchase) => purchase.supplierId === supplier.id)
                .sort((first, second) =>
                  second.date.localeCompare(first.date),
                )[0];
              return (
                <tr key={supplier.id}>
                  <td className="name-cell">
                    <b>{supplier.name}</b>
                    <small>
                      {supplier.address || supplier.notes || "لا توجد ملاحظات"}
                    </small>
                  </td>
                  <td>
                    {supplier.phone || "—"}
                    <small>
                      {supplier.whatsapp ? "واتساب: " + supplier.whatsapp : ""}
                    </small>
                  </td>
                  <td>{supplier.creditDays ?? 15} يوم</td>
                  <td style={{ fontWeight: 700 }}>{money(supplier.balance)}</td>
                  <td>
                    {lastPurchase?.number || "—"}
                    {lastPurchase?.dueDate && (
                      <small>استحقاق {lastPurchase.dueDate}</small>
                    )}
                  </td>
                  <td className="supplier-actions">
                    {canManage && (
                      <>
                        <button
                          className="secondary"
                          onClick={() => openForm(supplier)}
                        >
                          تعديل
                        </button>
                        <button
                          className="secondary"
                          disabled={!supplier.balance}
                          onClick={() => {
                            setPayingSupplier(supplier);
                            setPaymentAmount(supplier.balance);
                          }}
                        >
                          تسجيل سداد
                        </button>
                      </>
                    )}
                    <button
                      className="secondary"
                      onClick={() => {
                        void printSupplierStatement(state, supplier.id).then(
                          (ok) => {
                            if (!ok)
                              notify(
                                "تعذرت الطباعة؛ تحقق من إعدادات الطابعة أو السماح بالنوافذ المنبثقة.",
                              );
                          },
                        );
                      }}
                    >
                      <FileBarChart size={14} /> كشف الحساب
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="card supplier-purchases">
        <div className="card-title">
          <div>
            <h3>فواتير الشراء ومرتجعات المورد</h3>
            <span>
              حد المرتجع هو الكمية المتبقية في الفاتورة ورصيد الصنف الحالي
            </span>
          </div>
        </div>
        <div className="supplier-purchase-table">
          <table>
            <thead>
              <tr>
                <th>الفاتورة</th>
                <th>المورد</th>
                <th>الصنف</th>
                <th>كمية الشراء</th>
                <th>مرتجع سابق</th>
                <th>الرصيد القابل للمرتجع</th>
                <th>قيمة الفاتورة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...state.purchases]
                .sort((first, second) => second.date.localeCompare(first.date))
                .map((purchase) => {
                  const item = state.items.find(
                    (candidate) => candidate.id === purchase.itemId,
                  );
                  const qty = purchase.quantity || 0;
                  const returned = returnedQuantity(purchase);
                  const maxReturn = returnableQuantity(purchase);
                  return (
                    <tr key={purchase.id}>
                      <td className="name-cell">
                        <b>{purchase.number}</b>
                        <small>
                          {purchase.supplierInvoiceNumber || purchase.date}
                        </small>
                      </td>
                      <td>
                        {state.suppliers.find(
                          (supplier) => supplier.id === purchase.supplierId,
                        )?.name || "—"}
                      </td>
                      <td>{item?.name || "بيانات الصنف غير متاحة"}</td>
                      <td>{qty ? quantity(qty, item?.baseUnit) : "—"}</td>
                      <td>{quantity(returned, item?.baseUnit)}</td>
                      <td>{quantity(maxReturn, item?.baseUnit)}</td>
                      <td>{money(purchase.total - returnedValue(purchase))}</td>
                      <td>
                        <button
                          className="secondary"
                          disabled={!canManage || maxReturn <= 0}
                          onClick={() => {
                            setReturningPurchase(purchase);
                            setReturnQuantity(Math.min(1, maxReturn));
                          }}
                        >
                          تسجيل مرتجع
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
      {returningPurchase && (
        <Modal
          title="مرتجع مشتريات للمورد"
          onClose={() => setReturningPurchase(null)}
        >
          <p>
            {returningPurchase.number} ·{" "}
            {
              state.suppliers.find(
                (supplier) => supplier.id === returningPurchase.supplierId,
              )?.name
            }{" "}
            · المتاح للمرتجع{" "}
            {quantity(
              returnableQuantity(returningPurchase),
              state.items.find((item) => item.id === returningPurchase.itemId)
                ?.baseUnit,
            )}
          </p>
          <div className="field">
            <label>الكمية المرتجعة</label>
            <input
              autoFocus
              type="number"
              min="0.01"
              max={returnableQuantity(returningPurchase)}
              step="0.01"
              value={returnQuantity}
              onChange={(event) =>
                setReturnQuantity(Number(event.target.value))
              }
            />
          </div>
          <div className="field" style={{ marginTop: 11 }}>
            <label>سبب المرتجع</label>
            <input
              value={returnReason}
              onChange={(event) => setReturnReason(event.target.value)}
            />
          </div>
          <p>
            قيمة إشعار الدائن:{" "}
            {money(returnQuantity * (returningPurchase.unitCost || 0))}
          </p>
          <div className="modal-actions">
            <button
              className="primary"
              onClick={confirmPurchaseReturn}
              disabled={busy}
            >
              اعتماد المرتجع
            </button>
            <button
              className="secondary"
              onClick={() => setReturningPurchase(null)}
            >
              إلغاء
            </button>
          </div>
        </Modal>
      )}
      {supplierFormOpen && (
        <Modal
          title={editing ? "تعديل بيانات المورد" : "إضافة مورد"}
          onClose={() => setSupplierFormOpen(false)}
        >
          <div className="field">
            <label>اسم المورد</label>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="supplier-form-grid">
            <div className="field">
              <label>الهاتف</label>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="field">
              <label>واتساب</label>
              <input
                value={whatsapp}
                onChange={(event) => setWhatsapp(event.target.value)}
              />
            </div>
            <div className="field">
              <label>فترة السداد الافتراضية بالأيام</label>
              <input
                type="number"
                min="0"
                value={creditDays}
                onChange={(event) => setCreditDays(Number(event.target.value))}
              />
            </div>
            {!editing && (
              <div className="field">
                <label>الرصيد الافتتاحي المستحق</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={openingBalance}
                  onChange={(event) =>
                    setOpeningBalance(Number(event.target.value))
                  }
                />
              </div>
            )}
            <div className="field">
              <label>العنوان</label>
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div className="field">
              <label>ملاحظات</label>
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button className="primary" onClick={saveSupplier} disabled={busy}>
              حفظ البيانات
            </button>
            <button
              className="secondary"
              onClick={() => setSupplierFormOpen(false)}
            >
              إلغاء
            </button>
          </div>
        </Modal>
      )}
      {payingSupplier && (
        <Modal title="تسجيل سداد مورد" onClose={() => setPayingSupplier(null)}>
          <p>
            {payingSupplier.name} · الرصيد المستحق{" "}
            {money(payingSupplier.balance)}
          </p>
          <div className="field">
            <label>مبلغ السداد</label>
            <input
              type="number"
              min="0.01"
              max={payingSupplier.balance}
              step="0.01"
              value={paymentAmount}
              onChange={(event) => setPaymentAmount(Number(event.target.value))}
            />
          </div>
          <div className="supplier-form-grid">
            <div className="field">
              <label>تاريخ السداد</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            </div>
            <div className="field">
              <label>وسيلة السداد</label>
              <select
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(
                    event.target.value as "cash" | "transfer" | "wallet",
                  )
                }
              >
                <option value="cash">نقدي</option>
                <option value="transfer">تحويل بنكي</option>
                <option value="wallet">محفظة إلكترونية</option>
              </select>
            </div>
            <div className="field">
              <label>رقم مرجعي</label>
              <input
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                placeholder="رقم إيصال/تحويل"
              />
            </div>
            <div className="field">
              <label>ملاحظات</label>
              <input
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button className="primary" onClick={recordPayment} disabled={busy}>
              اعتماد السداد
            </button>
            <button
              className="secondary"
              onClick={() => setPayingSupplier(null)}
            >
              إلغاء
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default Suppliers;

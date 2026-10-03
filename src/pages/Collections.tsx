import { useState } from "react";
import { callOperation, SessionUser, toBase, toMinor } from "../lib/api";
import { AppState, CustomerPayment, daysFromNow, money, quantity, Sale, saleStatus, today } from "../lib/domain";
import { Ban, Clock3, FileBarChart, HandCoins, Plus, RotateCcw } from "lucide-react";
import { printSaleInvoice, statusClass, statusLabel } from "../lib/helpers";
import Modal from "../components/Modal";

function Collections({
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
  const [selected, setSelected] = useState<Sale | null>(null);
  const [amount, setAmount] = useState(0);
  const [promiseDate, setPromiseDate] = useState(daysFromNow(3));
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentCustomerId, setPaymentCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "transfer" | "wallet"
  >("cash");
  const [paymentDate, setPaymentDate] = useState(today());
  const [returning, setReturning] = useState<Sale | null>(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnLineIndex, setReturnLineIndex] = useState(0);
  const [returnQty, setReturnQty] = useState(1);
  const [returnReason, setReturnReason] = useState("بضاعة مرتجعة صالحة");
  const [writeOffSale, setWriteOffSale] = useState<Sale | null>(null);
  const [writeOffReason, setWriteOffReason] = useState("");
  const [reversingPayment, setReversingPayment] =
    useState<CustomerPayment | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const isOwner = currentUser.role === "owner";
  const open = state.sales.filter(
    (sale) => sale.status !== "cancelled" && sale.total > sale.paid,
  );
  // Quantity still returnable on a specific invoice line after earlier returns.
  const returnableQuantity = (sale: Sale, lineIndex: number) => {
    const line = sale.lines[lineIndex];
    if (!line) return 0;
    const totalReturned = state.salesReturns
      .filter((item) => item.saleId === sale.id && item.itemId === line.itemId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const earlierQty = sale.lines
      .slice(0, lineIndex)
      .filter((candidate) => candidate.itemId === line.itemId)
      .reduce((sum, candidate) => sum + candidate.qty, 0);
    return (
      line.qty - Math.min(line.qty, Math.max(0, totalReturned - earlierQty))
    );
  };
  const openPaymentModal = (sale: Sale | null) => {
    setSelected(sale);
    setAmount(sale ? sale.total - sale.paid : 0);
    setPaymentCustomerId(sale?.customerId || "");
    setPaymentDate(today());
    setPaymentMethod("cash");
    setPromiseDate(daysFromNow(3));
    setPaymentModalOpen(true);
  };
  const openReturnModal = (sale: Sale | null) => {
    setReturning(sale);
    setReturnLineIndex(0);
    setReturnQty(1);
    setReturnModalOpen(true);
  };
  const recordPayment = () => {
    if (!selected) return notify("اختر العميل والفاتورة أولًا.");
    const remaining = selected.total - selected.paid;
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining)
      return notify("أدخل مبلغ تحصيل صحيحًا لا يتجاوز المتبقي.");
    if (!paymentDate) return notify("اختر تاريخ الدفعة.");
    const finalPayment = remaining - amount < 0.005;
    // The backend allocates the payment to the invoice atomically, syncs its
    // status, and closes reminders/promises when the invoice settles.
    void run(
      () =>
        callOperation("recordCollection", {
          customerId: selected.customerId,
          saleId: selected.id,
          amountMinor: toMinor(amount),
          method: paymentMethod,
          date: paymentDate,
          notes: finalPayment
            ? "سداد كامل من مركز التحصيل"
            : "سداد جزئي من مركز التحصيل",
        }),
      finalPayment
        ? "تمت تسوية الفاتورة وإلغاء التذكيرات المستقبلية."
        : "تم تسجيل الدفعة وتحديث الرصيد المتبقي.",
    ).then((ok) => {
      if (ok) {
        setSelected(null);
        setPaymentModalOpen(false);
      }
    });
  };
  const savePromise = () => {
    if (!selected) return;
    if (!promiseDate) return notify("اختر تاريخ وعد السداد.");
    const remaining = selected.total - selected.paid;
    // Recording the promise reschedules the invoice's pending reminders to the
    // promised date inside the same backend transaction.
    void run(
      () =>
        callOperation("recordPromise", {
          saleId: selected.id,
          customerId: selected.customerId,
          amountMinor: toMinor(remaining),
          promisedDate: promiseDate,
          notes: "وعد مسجل من مركز التحصيل",
        }),
      "تم تسجيل وعد السداد وإعادة جدولة التذكيرات المعلقة.",
    ).then((ok) => {
      if (ok) {
        setSelected(null);
        setPaymentModalOpen(false);
      }
    });
  };
  const confirmReturn = () => {
    if (!returning) return notify("اختر الفاتورة أولًا.");
    const line = returning.lines[returnLineIndex];
    if (!line?.id) return notify("اختر بندًا صالحًا من الفاتورة.");
    const maxReturn = returnableQuantity(returning, returnLineIndex);
    if (!Number.isFinite(returnQty) || returnQty <= 0 || returnQty > maxReturn)
      return notify(
        "كمية المرتجع غير صالحة؛ الحد الأقصى لهذا البند " +
          quantity(maxReturn) +
          ".",
      );
    if (!returnReason.trim()) return notify("سجّل سبب المرتجع.");
    const factor =
      state.items.find((candidate) => candidate.id === line.itemId)
        ?.unitFactor || 1;
    // The backend restores the original lot, prices the return from the sale
    // line, refunds any overpaid amount, and closes reminders when settled.
    void run(
      () =>
        callOperation("returnSale", {
          saleId: returning.id,
          number: state.nextNumbers["RET"],
          date: state.today,
          reason: returnReason.trim(),
          lines: [
            {
              originalSalesLineId: line.id,
              quantity: toBase(returnQty, factor),
            },
          ],
        }),
      "تم اعتماد المرتجع: عاد المخزون وخُفّض رصيد العميل بما يطابق الفاتورة.",
    ).then((ok) => {
      if (ok) {
        setReturning(null);
        setReturnModalOpen(false);
        setReturnLineIndex(0);
        setReturnQty(1);
      }
    });
  };
  const confirmWriteOff = () => {
    if (!writeOffSale) return;
    if (!writeOffReason.trim()) return notify("سبب الشطب مطلوب لسجل التدقيق.");
    void run(
      () =>
        callOperation("writeOffSale", {
          saleId: writeOffSale.id,
          reason: writeOffReason.trim(),
        }),
      "تم شطب المديونية وإقفال الفاتورة وإلغاء تذكيراتها.",
    ).then((ok) => {
      if (ok) {
        setWriteOffSale(null);
        setWriteOffReason("");
      }
    });
  };
  const confirmReversal = () => {
    if (!reversingPayment) return;
    if (!reversalReason.trim())
      return notify("سبب عكس الدفعة مطلوب لسجل التدقيق.");
    void run(
      () =>
        callOperation("reversePayment", {
          paymentId: reversingPayment.id,
          reason: reversalReason.trim(),
        }),
      "تم عكس الدفعة وإعادة فتح الفاتورة المرتبطة بها.",
    ).then((ok) => {
      if (ok) {
        setReversingPayment(null);
        setReversalReason("");
      }
    });
  };
  return (
    <>
      <div className="section-header">
        <div>
          <h2>التحصيل والمديونية</h2>
          <p>سجل الدفعات، تخصيص التحصيل، ووعود السداد</p>
        </div>
        <button
          className="primary"
          disabled={!open.length}
          onClick={() => openPaymentModal(null)}
        >
          <Plus size={15} /> تسجيل دفعة
        </button>
        <button className="secondary" onClick={() => openReturnModal(null)}>
          مرتجع مبيعات
        </button>
      </div>
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>الفاتورة</th>
              <th>العميل</th>
              <th>تاريخ الاستحقاق</th>
              <th>المتبقي</th>
              <th>الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {open.map((sale) => {
              const customer = state.customers.find(
                (c) => c.id === sale.customerId,
              );
              const status = saleStatus(sale);
              return (
                <tr key={sale.id}>
                  <td className="name-cell">
                    <b>{sale.number}</b>
                    <small>تاريخ الفاتورة: {sale.date}</small>
                  </td>
                  <td>{customer?.name}</td>
                  <td>{sale.dueDate || "—"}</td>
                  <td style={{ fontWeight: 700 }}>
                    {money(sale.total - sale.paid)}
                  </td>
                  <td>
                    <span className={"status " + statusClass(status)}>
                      {statusLabel(status)}
                    </span>
                  </td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button
                      className="secondary"
                      onClick={() => {
                        void printSaleInvoice(state, sale).then((ok) => {
                          if (!ok)
                            notify(
                              "تعذرت الطباعة؛ تحقق من إعدادات الطابعة أو السماح بالنوافذ المنبثقة.",
                            );
                        });
                      }}
                    >
                      <FileBarChart size={14} /> طباعة
                    </button>
                    <button
                      className="secondary"
                      onClick={() => openPaymentModal(sale)}
                    >
                      <HandCoins size={14} /> تحصيل
                    </button>
                    <button
                      className="secondary"
                      onClick={() => openPaymentModal(sale)}
                    >
                      <Clock3 size={14} /> وعد
                    </button>
                    <button
                      className="secondary"
                      onClick={() => openReturnModal(sale)}
                    >
                      مرتجع
                    </button>
                    {isOwner && (
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() => {
                          setWriteOffSale(sale);
                          setWriteOffReason("");
                        }}
                      >
                        <Ban size={14} /> شطب
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="split" style={{ marginTop: 17 }}>
        <section className="card">
          <div className="card-title">
            <h3>وعود سداد مفتوحة</h3>
          </div>
          {state.promises.filter((promise) => promise.status === "open")
            .length ? (
            state.promises
              .filter((promise) => promise.status === "open")
              .map((promise) => (
                <div className="mini-stat" key={promise.id}>
                  <span>
                    {
                      state.sales.find((sale) => sale.id === promise.saleId)
                        ?.number
                    }{" "}
                    · {promise.promisedDate}
                  </span>
                  <strong>{money(promise.amount)}</strong>
                </div>
              ))
          ) : (
            <p style={{ color: "#7c8b85", fontSize: 11 }}>
              لا توجد وعود سداد مفتوحة.
            </p>
          )}
        </section>
        <section className="card">
          <div className="card-title">
            <h3>ملخص التحصيل</h3>
          </div>
          <div className="mini-stat">
            <span>إجمالي المتبقي</span>
            <strong>
              {money(
                open.reduce((sum, sale) => sum + sale.total - sale.paid, 0),
              )}
            </strong>
          </div>
          <div className="mini-stat">
            <span>فواتير متأخرة</span>
            <strong style={{ color: "#bf4d41" }}>
              {open.filter((sale) => saleStatus(sale) === "overdue").length}
            </strong>
          </div>
        </section>
      </div>
      <section
        className="card"
        style={{ marginTop: 17, padding: 0, overflow: "hidden" }}
      >
        <div className="card-title" style={{ padding: "14px 16px 0" }}>
          <div>
            <h3>آخر الدفعات المحصلة</h3>
            <span>عكس الدفعة متاح للمالك فقط ويُسجَّل في سجل التدقيق</span>
          </div>
        </div>
        {state.customerPayments.length ? (
          <table>
            <thead>
              <tr>
                <th>العميل</th>
                <th>الفاتورة</th>
                <th>المبلغ</th>
                <th>الطريقة</th>
                <th>التاريخ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.customerPayments.slice(0, 10).map((payment) => (
                <tr key={payment.id}>
                  <td className="name-cell">
                    <b>
                      {state.customers.find(
                        (customer) => customer.id === payment.customerId,
                      )?.name || "—"}
                    </b>
                    <small>{payment.note}</small>
                  </td>
                  <td>
                    {state.sales.find((sale) => sale.id === payment.saleId)
                      ?.number || "—"}
                  </td>
                  <td style={{ fontWeight: 700 }}>{money(payment.amount)}</td>
                  <td>
                    {{ cash: "نقدي", transfer: "تحويل", wallet: "محفظة" }[
                      payment.method
                    ] || payment.method}
                  </td>
                  <td>{payment.date}</td>
                  <td>
                    {isOwner && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setReversingPayment(payment);
                          setReversalReason("");
                        }}
                      >
                        <RotateCcw size={14} /> عكس
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: "#7c8b85", fontSize: 11, padding: "0 16px 14px" }}>
            لم تُسجَّل أي دفعات بعد.
          </p>
        )}
      </section>
      {paymentModalOpen && (
        <Modal
          title="تسجيل تحصيل أو وعد بالسداد"
          onClose={() => {
            setPaymentModalOpen(false);
            setSelected(null);
          }}
        >
          {!selected && (
            <>
              <div className="field">
                <label>العميل</label>
                <select
                  autoFocus
                  value={paymentCustomerId}
                  onChange={(event) => setPaymentCustomerId(event.target.value)}
                >
                  <option value="">اختر العميل</option>
                  {state.customers
                    .filter((customer) =>
                      open.some((sale) => sale.customerId === customer.id),
                    )
                    .map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} · إجمالي المتبقي{" "}
                        {money(
                          open
                            .filter((sale) => sale.customerId === customer.id)
                            .reduce(
                              (sum, sale) => sum + sale.total - sale.paid,
                              0,
                            ),
                        )}
                      </option>
                    ))}
                </select>
              </div>
              {paymentCustomerId && (
                <div className="field" style={{ marginTop: 11 }}>
                  <label>الفاتورة المفتوحة</label>
                  <select
                    value=""
                    onChange={(event) => {
                      const sale = open.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      if (sale) {
                        setSelected(sale);
                        setAmount(sale.total - sale.paid);
                      }
                    }}
                  >
                    <option value="">اختر الفاتورة</option>
                    {open
                      .filter((sale) => sale.customerId === paymentCustomerId)
                      .map((sale) => (
                        <option key={sale.id} value={sale.id}>
                          {sale.number} · المتبقي{" "}
                          {money(sale.total - sale.paid)} · الاستحقاق{" "}
                          {sale.dueDate || "—"}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <p style={{ color: "#788982", fontSize: 11 }}>
                تُسجَّل الدفعة على الفاتورة التي تختارها فقط؛ لا يوجد اختيار
                تلقائي.
              </p>
            </>
          )}
          {selected && (
            <>
              <p>
                {selected.number} ·{" "}
                {
                  state.customers.find(
                    (customer) => customer.id === selected.customerId,
                  )?.name
                }{" "}
                · المتبقي {money(selected.total - selected.paid)}
              </p>
              <div className="field">
                <label>مبلغ التحصيل</label>
                <input
                  autoFocus
                  type="number"
                  min="0.01"
                  max={selected.total - selected.paid}
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(Number(event.target.value))}
                />
              </div>
              <div className="supplier-form-grid" style={{ marginTop: 11 }}>
                <div className="field">
                  <label>طريقة الدفع</label>
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
                  <label>تاريخ الدفعة</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(event) => setPaymentDate(event.target.value)}
                  />
                </div>
              </div>
              <div className="field" style={{ marginTop: 11 }}>
                <label>تاريخ وعد السداد (للوعد فقط)</label>
                <input
                  type="date"
                  value={promiseDate}
                  onChange={(event) => setPromiseDate(event.target.value)}
                />
              </div>
              <div className="modal-actions">
                <button className="primary" onClick={recordPayment}>
                  تسجيل الدفعة
                </button>
                <button className="secondary" onClick={savePromise}>
                  تسجيل الوعد
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setPaymentModalOpen(false);
                    setSelected(null);
                  }}
                >
                  إلغاء
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {returnModalOpen && (
        <Modal
          title="مرتجع مبيعات"
          onClose={() => {
            setReturnModalOpen(false);
            setReturning(null);
          }}
        >
          <div className="field">
            <label>الفاتورة</label>
            <select
              value={returning?.id || ""}
              onChange={(event) => {
                const sale =
                  state.sales.find(
                    (candidate) => candidate.id === event.target.value,
                  ) || null;
                setReturning(sale);
                setReturnLineIndex(0);
                setReturnQty(1);
              }}
            >
              <option value="">اختر الفاتورة</option>
              {state.sales
                .filter(
                  (sale) =>
                    sale.status !== "draft" &&
                    sale.lines.some(
                      (_, index) => returnableQuantity(sale, index) > 0,
                    ),
                )
                .map((sale) => (
                  <option key={sale.id} value={sale.id}>
                    {sale.number} ·{" "}
                    {
                      state.customers.find(
                        (customer) => customer.id === sale.customerId,
                      )?.name
                    }{" "}
                    · {statusLabel(saleStatus(sale))}
                  </option>
                ))}
            </select>
          </div>
          {returning && (
            <>
              {returning.lines.length > 1 && (
                <div className="field" style={{ marginTop: 11 }}>
                  <label>البند المرتجع</label>
                  <select
                    value={returnLineIndex}
                    onChange={(event) => {
                      setReturnLineIndex(Number(event.target.value));
                      setReturnQty(1);
                    }}
                  >
                    {returning.lines.map((line, index) => {
                      const item = state.items.find(
                        (candidate) => candidate.id === line.itemId,
                      );
                      return (
                        <option
                          key={index}
                          value={index}
                          disabled={returnableQuantity(returning, index) <= 0}
                        >
                          {item?.name || line.itemId} · قابل للمرتجع{" "}
                          {quantity(
                            returnableQuantity(returning, index),
                            item?.baseUnit,
                          )}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              <p>
                يُعاد المنتج للمخزون ويُخفض رصيد العميل بما لا يتجاوز المتبقي
                على الفاتورة؛ وأي مبلغ مدفوع زيادة يُسجَّل كمبلغ مردود للعميل في
                كشف الحساب.
              </p>
              <div className="field">
                <label>
                  الكمية المرتجعة (الحد الأقصى{" "}
                  {quantity(
                    returnableQuantity(returning, returnLineIndex),
                    state.items.find(
                      (item) =>
                        item.id === returning.lines[returnLineIndex]?.itemId,
                    )?.baseUnit,
                  )}
                  )
                </label>
                <input
                  autoFocus
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={returnableQuantity(returning, returnLineIndex)}
                  value={returnQty}
                  onChange={(event) => setReturnQty(Number(event.target.value))}
                />
              </div>
              <div className="field" style={{ marginTop: 11 }}>
                <label>سبب المرتجع</label>
                <input
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                />
              </div>
              <div className="modal-actions">
                <button className="primary" onClick={confirmReturn}>
                  اعتماد المرتجع
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setReturnModalOpen(false);
                    setReturning(null);
                  }}
                >
                  إلغاء
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {writeOffSale && (
        <Modal
          title={"شطب مديونية الفاتورة " + writeOffSale.number}
          onClose={() => setWriteOffSale(null)}
        >
          <p>
            سيُشطب المتبقي {money(writeOffSale.total - writeOffSale.paid)}{" "}
            وتُقفل الفاتورة مع بقاء السجل كاملًا في قاعدة البيانات وسجل التدقيق.
            هذا الإجراء للمالك فقط.
          </p>
          <div className="field" style={{ marginTop: 11 }}>
            <label>سبب الشطب</label>
            <input
              autoFocus
              value={writeOffReason}
              onChange={(event) => setWriteOffReason(event.target.value)}
              placeholder="مثال: عميل متعثر منذ أكثر من سنة"
            />
          </div>
          <div className="modal-actions">
            <button
              className="danger"
              onClick={confirmWriteOff}
              disabled={busy}
            >
              تأكيد الشطب
            </button>
            <button className="secondary" onClick={() => setWriteOffSale(null)}>
              رجوع
            </button>
          </div>
        </Modal>
      )}
      {reversingPayment && (
        <Modal title="عكس دفعة محصلة" onClose={() => setReversingPayment(null)}>
          <p>
            سيُعاد مبلغ {money(reversingPayment.amount)} إلى رصيد العميل وتُعاد
            فتح الفاتورة المرتبطة، مع بقاء الدفعتين (الأصلية والعكسية) في السجل
            للتدقيق.
          </p>
          <div className="field" style={{ marginTop: 11 }}>
            <label>سبب العكس</label>
            <input
              autoFocus
              value={reversalReason}
              onChange={(event) => setReversalReason(event.target.value)}
              placeholder="مثال: دفعة سُجلت لعميل آخر بالخطأ"
            />
          </div>
          <div className="modal-actions">
            <button
              className="danger"
              onClick={confirmReversal}
              disabled={busy}
            >
              تأكيد العكس
            </button>
            <button
              className="secondary"
              onClick={() => setReversingPayment(null)}
            >
              رجوع
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default Collections;

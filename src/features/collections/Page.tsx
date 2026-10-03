import { toBase, toMinor } from "../../lib/api";
import { useApp } from "../../app/AppProvider";
import { daysFromNow, quantity, Sale, today } from "../../lib/domain";
import { Plus } from "lucide-react";
import { printSaleInvoice } from "../print";
import OpenInvoicesTable from "./OpenInvoicesTable";
import PromisesPanel from "./PromisesPanel";
import PaymentsHistory from "./PaymentsHistory";
import CollectionForm from "./CollectionForm";
import ReturnAndAdjustmentsDialogs from "./ReturnAndAdjustmentsDialogs";
import WriteOffDialog from "./WriteOffDialog";
import { useCollectionDraft } from "./useCollectionDraft";

function Collections() {
  const { state, currentUser } = useApp();
  if (!state || !currentUser) return null;
  return <CollectionsContent />;
}

function CollectionsContent() {
  const { state: snapshot, run, busy, currentUser: session, notify } = useApp();
  const state = snapshot!;
  const currentUser = session!;
  const {
    selected, setSelected, amount, setAmount, promiseDate, setPromiseDate,
    paymentModalOpen, setPaymentModalOpen, paymentCustomerId, setPaymentCustomerId,
    paymentMethod, setPaymentMethod, paymentDate, setPaymentDate,
    returning, setReturning, returnModalOpen, setReturnModalOpen,
    returnLineIndex, setReturnLineIndex, returnQty, setReturnQty,
    returnReason, setReturnReason, writeOffSale, setWriteOffSale,
    writeOffReason, setWriteOffReason, reversingPayment, setReversingPayment,
    reversalReason, setReversalReason,
  } = useCollectionDraft();
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
  // UX hint — backend is authoritative.
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
      "customer:collect",
      {
          customerId: selected.customerId,
          saleId: selected.id,
          amountMinor: toMinor(amount),
          method: paymentMethod,
          date: paymentDate,
          notes: finalPayment
            ? "سداد كامل من مركز التحصيل"
            : "سداد جزئي من مركز التحصيل",
      },
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
      "customer:promise",
      {
          saleId: selected.id,
          customerId: selected.customerId,
          amountMinor: toMinor(remaining),
          promisedDate: promiseDate,
          notes: "وعد مسجل من مركز التحصيل",
      },
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
      // line, refunds overpaid amounts, and closes reminders when settled.
    void run(
      "sale:return",
      {
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
      },
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
      "customer:writeoff",
      {
          saleId: writeOffSale.id,
          reason: writeOffReason.trim(),
      },
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
      "payment:reverse",
      {
          paymentId: reversingPayment.id,
          reason: reversalReason.trim(),
      },
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
      <OpenInvoicesTable
        state={state}
        open={open}
        isOwner={isOwner}
        busy={busy}
        onPrint={(sale) => {
          void printSaleInvoice(state, sale).then((ok) => {
            if (!ok) notify("تعذرت الطباعة؛ تحقق من إعدادات الطابعة أو السماح بالنوافذ المنبثقة.");
          });
        }}
        onCollect={openPaymentModal}
        onPromise={openPaymentModal}
        onReturn={openReturnModal}
        onWriteOff={(sale) => { setWriteOffSale(sale); setWriteOffReason(""); }}
      />
      <PromisesPanel state={state} open={open} />
      <PaymentsHistory
        state={state}
        isOwner={isOwner}
        busy={busy}
        onReverse={(payment) => { setReversingPayment(payment); setReversalReason(""); }}
      />
      <CollectionForm
        state={state}
        open={paymentModalOpen}
        openSales={open}
        selected={selected}
        paymentCustomerId={paymentCustomerId}
        setPaymentCustomerId={setPaymentCustomerId}
        amount={amount}
        setAmount={setAmount}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        paymentDate={paymentDate}
        setPaymentDate={setPaymentDate}
        promiseDate={promiseDate}
        setPromiseDate={setPromiseDate}
        onSelectSale={(sale) => { setSelected(sale); setAmount(sale.total - sale.paid); }}
        onRecordPayment={recordPayment}
        onSavePromise={savePromise}
        onClose={() => { setPaymentModalOpen(false); setSelected(null); }}
      />
      <ReturnAndAdjustmentsDialogs
        state={state}
        busy={busy}
        returnOpen={returnModalOpen}
        setReturnOpen={setReturnModalOpen}
        returning={returning}
        setReturning={setReturning}
        returnLineIndex={returnLineIndex}
        setReturnLineIndex={setReturnLineIndex}
        returnQty={returnQty}
        setReturnQty={setReturnQty}
        returnReason={returnReason}
        setReturnReason={setReturnReason}
        returnableQuantity={returnableQuantity}
        onConfirmReturn={confirmReturn}
        reversingPayment={reversingPayment}
        setReversingPayment={setReversingPayment}
        reversalReason={reversalReason}
        setReversalReason={setReversalReason}
        onConfirmReversal={confirmReversal}
      />
      <WriteOffDialog sale={writeOffSale} setSale={setWriteOffSale} reason={writeOffReason} setReason={setWriteOffReason} busy={busy} onConfirm={confirmWriteOff} />
    </>
  );
}

export default Collections;

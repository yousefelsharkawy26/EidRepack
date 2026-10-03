import { useState } from "react";
import { toBase, toMinor } from "../../lib/api";
import { useApp } from "../../app/AppProvider";
import { daysFromNow, PurchaseDraft, today } from "../../lib/domain";
import PurchaseForm from "./PurchaseForm";
import { PurchaseActions, PurchaseDraftsPanel } from "./PurchaseDraftsPanel";

function Purchases() {
  const { state: snapshot, run, busy, notify } = useApp();
  const state = snapshot;
  const rawItems = state?.items.filter(
    (item) => item.type !== "finished" && item.active !== false,
  ) || [];
  const [supplierId, setSupplierId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(25);
  const [price, setPrice] = useState(40);
  const [shipping, setShipping] = useState(0);
  const [paid, setPaid] = useState(0);
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [repeatPurchaseId, setRepeatPurchaseId] = useState("");
  if (!state) return null;
  const total = qty * price + shipping;
  const landed = total / Math.max(qty, 1);
  const supplier =
    state.suppliers.find((s) => s.id === supplierId) || state.suppliers[0];
  const effectiveSupplierId = supplier?.id || "";
  const selectedItem =
    rawItems.find((item) => item.id === itemId) || rawItems[0];
  const effectiveItemId = selectedItem?.id || "";
  const supplierCreditDays =
    supplier?.creditDays ?? state.settings.defaultCreditDays;
  // UX hint — backend is authoritative.
  const validForm = () =>
    Boolean(
      supplier &&
      selectedItem &&
      purchaseDate &&
      Number.isFinite(qty) &&
      qty > 0 &&
      Number.isFinite(price) &&
      price >= 0 &&
      Number.isFinite(shipping) &&
      shipping >= 0 &&
      Number.isFinite(paid) &&
      paid >= 0 &&
      paid <= total,
    );
  const loadDraft = (draft: PurchaseDraft) => {
    setEditingDraftId(draft.id);
    setSupplierId(draft.supplierId);
    setItemId(draft.itemId);
    setPurchaseDate(draft.date);
    setQty(draft.quantity);
    setPrice(draft.unitPrice);
    setShipping(draft.extraCosts);
    setPaid(draft.paid);
    setSupplierInvoiceNumber(draft.supplierInvoiceNumber || "");
    setDueDate(draft.dueDate || "");
    notify("تم تحميل المسودة لاستكمالها أو اعتمادها.");
  };
  const factorOf = (itemId: string) =>
    state.items.find((item) => item.id === itemId)?.unitFactor || 1;
  const draftPayload = (existingNumber?: string) => ({
    id: editingDraftId || undefined,
    number: existingNumber || state.nextNumbers["D-PUR"],
    supplierId: effectiveSupplierId,
    itemId: effectiveItemId,
    date: purchaseDate,
    supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
    dueDate:
      paid < total ? dueDate || daysFromNow(supplierCreditDays) : undefined,
    quantity: toBase(qty, factorOf(effectiveItemId)),
    unitPriceMinor: Math.round((price * 100) / factorOf(effectiveItemId)),
    extraCostsMinor: toMinor(shipping),
    paidMinor: toMinor(paid),
  });
  const saveDraft = () => {
    if (!validForm())
      return notify(
        "راجع بيانات المسودة؛ الكمية والمبالغ والمورد والصنف مطلوبة.",
      );
    const existing = state.purchaseDrafts.find(
      (draft) => draft.id === editingDraftId,
    );
    void run(
      "purchase-draft:save",
      draftPayload(existing?.number),
      "تم حفظ المسودة دون التأثير على المخزون أو رصيد المورد.",
    ).then((result) => {
      const saved = result && result.ok ? result.data as { id?: string } : null;
      if (!editingDraftId && saved?.id) setEditingDraftId(saved.id);
    });
  };
  const confirm = () => {
    const selectedSupplier = state.suppliers.find(
      (candidate) => candidate.id === effectiveSupplierId,
    );
    if (!selectedSupplier || !validForm())
      return notify(
        "راجع بيانات الفاتورة؛ الكمية والمبالغ والمورد والصنف مطلوبة.",
      );
    void run(
        "purchase:confirm",
        {
          draftId: editingDraftId || undefined,
          number: state.nextNumbers.PUR,
          supplierId: effectiveSupplierId,
          itemId: effectiveItemId,
          date: purchaseDate,
          quantity: toBase(qty, factorOf(effectiveItemId)),
          subtotalMinor: toMinor(qty * price),
          lineTotalMinor: toMinor(qty * price),
          extraCostsMinor: toMinor(shipping),
          totalMinor: toMinor(total),
          paidMinor: toMinor(paid),
          method: "cash",
          supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
          dueDate:
            paid < total
              ? dueDate || daysFromNow(supplierCreditDays)
              : undefined,
        },
      "تم اعتماد فاتورة الشراء وإضافة دفعة للمخزون بالتكلفة الفعلية.",
    ).then((ok) => {
      if (ok) setEditingDraftId(null);
    });
  };
  const duplicateAsDraft = () => {
    const previous = state.purchases.find(
      (purchase) => purchase.id === repeatPurchaseId,
    );
    if (
      !previous ||
      !previous.itemId ||
      !previous.quantity ||
      previous.quantity <= 0
    )
      return notify("الفاتورة المختارة لا تحتوي بيانات كافية لتكرارها.");
    const previousQuantity = previous.quantity;
    const nextSupplier = state.suppliers.find(
      (item) => item.id === previous.supplierId,
    );
    const unitPrice = Math.max(
      0,
      (previous.total - previous.extraCosts) / previous.quantity,
    );
    const payload = {
      number: state.nextNumbers["D-PUR"],
      supplierId: previous.supplierId,
      itemId: previous.itemId,
      date: state.today,
      quantity: toBase(previous.quantity, factorOf(previous.itemId)),
      unitPriceMinor: Math.round((unitPrice * 100) / factorOf(previous.itemId)),
      extraCostsMinor: toMinor(previous.extraCosts),
      paidMinor: 0,
      dueDate: daysFromNow(
        nextSupplier?.creditDays ?? state.settings.defaultCreditDays,
      ),
    };
    void run("purchase-draft:save", payload,
      "تم إنشاء مسودة جديدة من الفاتورة السابقة؛ راجع الكميات والأسعار قبل الاعتماد.",
    ).then((result) => {
      if (!result || !result.ok) return;
      const saved = result.data as { id?: string };
      setRepeatPurchaseId("");
      setEditingDraftId(saved.id || null);
      setSupplierId(previous.supplierId);
      setItemId(previous.itemId || "");
      setPurchaseDate(state.today);
      setQty(previousQuantity);
      setPrice(unitPrice);
      setShipping(previous.extraCosts);
      setPaid(0);
      setSupplierInvoiceNumber("");
      setDueDate(payload.dueDate);
    });
  };
  const deleteDraft = (draft: PurchaseDraft) => {
    if (
      !window.confirm(
        "حذف المسودة " + draft.number + "؟ لن يتأثر المخزون أو رصيد المورد.",
      )
    )
      return;
    void run(
      "purchase-draft:delete", { id: draft.id },
      "تم حذف المسودة.",
    ).then((ok) => {
      if (ok && editingDraftId === draft.id) setEditingDraftId(null);
    });
  };
  return (
    <>
      <PurchaseActions editing={!!editingDraftId} busy={busy} onSaveDraft={saveDraft} onConfirm={confirm} />
      <PurchaseDraftsPanel
        state={state}
        onLoad={loadDraft}
        onDelete={deleteDraft}
        repeatPurchaseId={repeatPurchaseId}
        setRepeatPurchaseId={setRepeatPurchaseId}
        onDuplicate={duplicateAsDraft}
        busy={busy}
      />
      <PurchaseForm
        state={state}
        rawItems={rawItems}
        supplier={supplier}
        effectiveSupplierId={effectiveSupplierId}
        setSupplierId={setSupplierId}
        effectiveItemId={effectiveItemId}
        setItemId={setItemId}
        qty={qty} setQty={setQty}
        price={price} setPrice={setPrice}
        shipping={shipping} setShipping={setShipping}
        paid={paid} setPaid={setPaid}
        purchaseDate={purchaseDate} setPurchaseDate={setPurchaseDate}
        supplierInvoiceNumber={supplierInvoiceNumber} setSupplierInvoiceNumber={setSupplierInvoiceNumber}
        dueDate={dueDate} setDueDate={setDueDate}
        total={total} landed={landed} supplierCreditDays={supplierCreditDays}
      />
    </>
  );
}

export default Purchases;

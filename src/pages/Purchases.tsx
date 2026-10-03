import { useState } from "react";
import { callOperation, toBase, toMinor } from "../lib/api";
import {
  AppState,
  daysFromNow,
  money,
  PurchaseDraft,
  quantity,
  today,
} from "../lib/domain";
import { ArchiveRestore, CheckCircle2, Clock3, Trash2 } from "lucide-react";

function Purchases({
  state,
  run,
  busy,
  notify,
}: {
  state: AppState;
  run: (
    action: () => Promise<unknown>,
    successMessage?: string,
  ) => Promise<boolean>;
  busy: boolean;
  notify: (message: string) => void;
}) {
  const rawItems = state.items.filter(
    (item) => item.type !== "finished" && item.active !== false,
  );
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
    void run(async () => {
      const result = await callOperation(
        "savePurchaseDraft",
        draftPayload(existing?.number),
      );
      if (!editingDraftId && result?.id) setEditingDraftId(result.id);
    }, "تم حفظ المسودة دون التأثير على المخزون أو رصيد المورد.");
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
      () =>
        callOperation("confirmPurchase", {
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
        }),
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
    void run(async () => {
      const result = await callOperation("savePurchaseDraft", payload);
      setRepeatPurchaseId("");
      setEditingDraftId(result?.id || null);
      setSupplierId(previous.supplierId);
      setItemId(previous.itemId || "");
      setPurchaseDate(state.today);
      setQty(previousQuantity);
      setPrice(unitPrice);
      setShipping(previous.extraCosts);
      setPaid(0);
      setSupplierInvoiceNumber("");
      setDueDate(payload.dueDate);
    }, "تم إنشاء مسودة جديدة من الفاتورة السابقة؛ راجع الكميات والأسعار قبل الاعتماد.");
  };
  const deleteDraft = (draft: PurchaseDraft) => {
    if (
      !window.confirm(
        "حذف المسودة " + draft.number + "؟ لن يتأثر المخزون أو رصيد المورد.",
      )
    )
      return;
    void run(
      () => callOperation("deletePurchaseDraft", { id: draft.id }),
      "تم حذف المسودة.",
    ).then((ok) => {
      if (ok && editingDraftId === draft.id) setEditingDraftId(null);
    });
  };
  return (
    <>
      <div className="section-header">
        <div>
          <h2>{editingDraftId ? "استكمال مسودة شراء" : "فاتورة شراء جديدة"}</h2>
          <p>المسودات لا تؤثر على المخزون أو رصيد المورد حتى الاعتماد</p>
        </div>
        <div className="toolbar">
          <button className="secondary" onClick={saveDraft} disabled={busy}>
            <Clock3 size={15} /> حفظ كمسودة
          </button>
          <button className="primary" onClick={confirm} disabled={busy}>
            <CheckCircle2 size={15} /> اعتماد + إضافة للمخزون
          </button>
        </div>
      </div>
      {state.purchaseDrafts.length > 0 && (
        <section className="card purchase-drafts">
          <div className="card-title">
            <div>
              <h3>مسودات الشراء</h3>
              <span>{state.purchaseDrafts.length} مسودة غير معتمدة</span>
            </div>
          </div>
          <div className="draft-list">
            {state.purchaseDrafts.map((draft) => (
              <div className="draft-row" key={draft.id}>
                <div>
                  <b>{draft.number}</b>
                  <small>
                    {state.suppliers.find(
                      (item) => item.id === draft.supplierId,
                    )?.name || "مورد غير متاح"}{" "}
                    ·{" "}
                    {state.items.find((item) => item.id === draft.itemId)
                      ?.name || "صنف غير متاح"}{" "}
                    ·{" "}
                    {quantity(
                      draft.quantity,
                      state.items.find((item) => item.id === draft.itemId)
                        ?.baseUnit,
                    )}
                  </small>
                </div>
                <strong>
                  {money(draft.quantity * draft.unitPrice + draft.extraCosts)}
                </strong>
                <button className="secondary" onClick={() => loadDraft(draft)}>
                  استكمال
                </button>
                <button
                  className="danger"
                  onClick={() => deleteDraft(draft)}
                  aria-label={"حذف " + draft.number}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {state.purchases.length > 0 && (
        <section className="card repeat-purchase">
          <div className="field">
            <label>تكرار فاتورة شراء سابقة كمسودة</label>
            <select
              value={repeatPurchaseId}
              onChange={(event) => setRepeatPurchaseId(event.target.value)}
            >
              <option value="">اختر فاتورة سابقة</option>
              {[...state.purchases]
                .sort((first, second) => second.date.localeCompare(first.date))
                .map((purchase) => (
                  <option key={purchase.id} value={purchase.id}>
                    {purchase.number} ·{" "}
                    {state.suppliers.find(
                      (item) => item.id === purchase.supplierId,
                    )?.name || "مورد"}{" "}
                    · {purchase.date}
                  </option>
                ))}
            </select>
          </div>
          <button
            className="secondary"
            disabled={!repeatPurchaseId || busy}
            onClick={duplicateAsDraft}
          >
            <ArchiveRestore size={15} /> تكرار كمسودة
          </button>
        </section>
      )}
      <div className="workspace">
        <section className="form-card">
          <div className="form-top">
            <div className="field">
              <label>المورد</label>
              <select
                value={effectiveSupplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                {state.suppliers.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>التاريخ</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(event) => setPurchaseDate(event.target.value)}
              />
            </div>
            <div className="field">
              <label>رقم فاتورة المورد</label>
              <input
                value={supplierInvoiceNumber}
                onChange={(event) =>
                  setSupplierInvoiceNumber(event.target.value)
                }
                placeholder="اختياري"
              />
            </div>
          </div>
          <div className="lines">
            <div className="line-grid header">
              <span>الصنف</span>
              <span>الكمية</span>
              <span>سعر الكيلو / الوحدة</span>
              <span>الإجمالي</span>
              <span />
            </div>
            <div className="line-grid">
              <div className="field">
                <select
                  value={effectiveItemId}
                  onChange={(e) => setItemId(e.target.value)}
                >
                  {rawItems.map((i) => (
                    <option value={i.id} key={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <input
                  type="number"
                  value={qty}
                  min="1"
                  onChange={(e) => setQty(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <input
                  type="number"
                  value={price}
                  min="0"
                  onChange={(e) => setPrice(Number(e.target.value))}
                />
              </div>
              <div className="line-total">{money(qty * price)}</div>
              <span />
            </div>
          </div>
          <div
            style={{
              padding: "0 18px 15px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div className="field">
              <label>مصاريف إضافية (شحن/تحميل)</label>
              <input
                type="number"
                min="0"
                value={shipping}
                onChange={(e) => setShipping(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>المبلغ المدفوع الآن</label>
              <input
                type="number"
                min="0"
                max={total}
                value={paid}
                onChange={(e) => setPaid(Number(e.target.value))}
              />
            </div>
            {paid < total && (
              <div className="field">
                <label>تاريخ استحقاق الرصيد</label>
                <input
                  type="date"
                  value={dueDate || daysFromNow(supplierCreditDays)}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
            )}
          </div>
          <div className="totals">
            <div className="total-row">
              <span>التكلفة الفعلية للوحدة بعد المصاريف</span>
              <span>{money(landed)}</span>
            </div>
            <div className="total-row final">
              <span>إجمالي الفاتورة</span>
              <span>{money(total)}</span>
            </div>
          </div>
        </section>
        <aside className="customer-panel">
          <h3>معاينة التكلفة</h3>
          <p>تُوزَّع مصاريف الشحن على بنود الفاتورة لتكوين التكلفة الفعلية.</p>
          <div className="mini-stat">
            <span>سعر الشراء</span>
            <strong>{money(price)}</strong>
          </div>
          <div className="mini-stat">
            <span>نصيب الوحدة من الشحن</span>
            <strong>{money(shipping / Math.max(qty, 1))}</strong>
          </div>
          <div className="mini-stat">
            <span>التكلفة الفعلية</span>
            <strong style={{ color: "#14785c" }}>{money(landed)}</strong>
          </div>
          <div className="mini-stat">
            <span>المتبقي للمورد</span>
            <strong>{money(total - paid)}</strong>
          </div>
        </aside>
      </div>
    </>
  );
}

export default Purchases;

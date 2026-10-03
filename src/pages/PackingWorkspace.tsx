import { useMemo, useState } from "react";
import Modal from "../components/Modal";
import { callOperation, SessionUser, toBase } from "../lib/api";
import {
  AppState,
  money,
  Packing,
  packingCapacity,
  packingEstimate,
  quantity,
} from "../lib/domain";
import { Ban, CheckCircle2 } from "lucide-react";

function PackingWorkspace({
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
  const finished = state.items.filter(
    (item) => item.type === "finished" && item.active !== false,
  );
  const [itemId, setItemId] = useState("");
  const [units, setUnits] = useState(180);
  const [waste, setWaste] = useState(1);
  const [mode, setMode] = useState<"target" | "reverse">("target");
  const product =
    state.items.find(
      (item) => item.id === itemId && item.type === "finished",
    ) || finished[0];
  const activeItemId = product?.id || "";
  const [availableRaw, setAvailableRaw] = useState(() => {
    const rawId = product?.recipe?.find((line) => line.kind === "raw")?.itemId;
    return state.items.find((item) => item.id === rawId)?.stock || 0;
  });
  const rawLine = product?.recipe?.find((line) => line.kind === "raw");
  const rawItem = state.items.find((item) => item.id === rawLine?.itemId);
  const [lotMode, setLotMode] = useState<"fifo" | "manual">("fifo");
  const [manualLotIds, setManualLotIds] = useState<Record<string, string[]>>(
    {},
  );
  const maxUnits = useMemo(
    () => packingCapacity(state, activeItemId, availableRaw, waste),
    [state, activeItemId, availableRaw, waste],
  );
  const plannedUnits = mode === "reverse" ? maxUnits : units;
  const estimate = useMemo(
    () => packingEstimate(state, activeItemId, plannedUnits, waste),
    [state, activeItemId, plannedUnits, waste],
  );
  const lotOptions = useMemo(
    () =>
      Object.fromEntries(
        [...new Set(estimate.inputs.map((input) => input.item.id))].map(
          (inputId) => {
            const item = state.items.find(
              (candidate) => candidate.id === inputId,
            );
            if (!item) return [inputId, []];
            let remaining = Math.max(0, item.stock);
            const availableLots: {
              id: string;
              lotId?: string;
              code: string;
              available: number;
            }[] = state.lots
              .filter((lot) => lot.itemId === inputId && lot.quantity > 0)
              .sort((first, second) =>
                first.receivedAt.localeCompare(second.receivedAt),
              )
              .flatMap((lot) => {
                const available = Math.min(remaining, lot.quantity);
                remaining -= available;
                return available > 0
                  ? [{ id: lot.id, lotId: lot.id, code: lot.code, available }]
                  : [];
              });
            if (remaining > 0)
              availableLots.push({
                id: "untracked-" + inputId,
                code: "رصيد غير متتبع",
                available: remaining,
              });
            return [inputId, availableLots];
          },
        ),
      ),
    [estimate.inputs, state.items, state.lots],
  );
  const allocationResults = estimate.inputs.map((input) => {
    const options = lotOptions[input.item.id] || [];
    const selected =
      lotMode === "manual"
        ? (manualLotIds[input.item.id] ?? options.map((option) => option.id))
        : options.map((option) => option.id);
    let remaining = Math.max(0, input.needed);
    const used = options
      .filter((option) => selected.includes(option.id))
      .flatMap((option) => {
        const usedQuantity = Math.min(remaining, option.available);
        remaining -= usedQuantity;
        return usedQuantity > 0
          ? [
              {
                itemId: input.item.id,
                lotId: option.lotId,
                quantity: usedQuantity,
                code: option.code,
              },
            ]
          : [];
      });
    return {
      item: input.item,
      needed: input.needed,
      options,
      selected,
      used,
      remaining,
      enough: remaining <= 0.000001,
    };
  });
  const lotAllocations = allocationResults.flatMap((result) =>
    result.used.map(({ itemId, lotId, quantity }) => ({
      itemId,
      lotId,
      quantity,
    })),
  );
  const enterManualLots = () => {
    setManualLotIds((current) => {
      const next = { ...current };
      estimate.inputs.forEach((input) => {
        if (next[input.item.id] === undefined)
          next[input.item.id] = (lotOptions[input.item.id] || []).map(
            (option) => option.id,
          );
      });
      return next;
    });
    setLotMode("manual");
  };
  const toggleLot = (itemId: string, lotId: string, checked: boolean) =>
    setManualLotIds((current) => {
      const selected =
        current[itemId] ??
        (lotOptions[itemId] || []).map((option) => option.id);
      return {
        ...current,
        [itemId]: checked
          ? [...new Set([...selected, lotId])]
          : selected.filter((id) => id !== lotId),
      };
    });
  const factorOf = (itemId: string) =>
    state.items.find((item) => item.id === itemId)?.unitFactor || 1;
  const rawFactor = rawItem?.unitFactor || 1;
  const confirm = () => {
    if (!Number.isInteger(plannedUnits) || plannedUnits <= 0)
      return notify(
        "أدخل عددًا صحيحًا موجبًا للعبوات، وتأكد من توفر كمية تكفي لإنتاج عبوة واحدة على الأقل.",
      );
    if (!Number.isFinite(waste) || waste < 0)
      return notify("أدخل كمية فاقد صحيحة لا تقل عن صفر.");
    if (estimate.inputs.some((input) => !input.enough))
      return notify("لا يمكن الاعتماد: كمية أحد المدخلات غير كافية.");
    if (allocationResults.some((result) => !result.enough))
      return notify(
        "الدفعات المحددة لا تغطي الكمية المطلوبة؛ اختر دفعات إضافية أو استخدم FIFO.",
      );
    if (!product)
      return notify(
        "لا يوجد منتج جاهز معرّف؛ أضف منتجًا من شاشة المخزون أولًا.",
      );
    const wasteBase = toBase(waste, rawFactor);
    // Mirror the backend arithmetic exactly: per-unit recipe quantity in base
    // units × produced units (+ waste on raw lines), so the exact-equality
    // validation server-side always passes.
    const inputs = estimate.inputs.map((input) => ({
      itemId: input.item.id,
      quantity:
        toBase(input.line.qty, factorOf(input.item.id)) * plannedUnits +
        (input.line.kind === "raw" ? wasteBase : 0),
    }));
    let lotAllocationsPayload:
      | { itemId: string; lotId: string; quantity: number }[]
      | undefined;
    if (lotMode === "manual") {
      lotAllocationsPayload = [];
      for (const result of allocationResults) {
        const target =
          inputs.find((entry) => entry.itemId === result.item.id)?.quantity ||
          0;
        const converted = result.used
          .filter((entry) => entry.lotId)
          .map((entry) => ({
            itemId: entry.itemId,
            lotId: entry.lotId as string,
            quantity: toBase(entry.quantity, factorOf(entry.itemId)),
          }));
        const difference =
          target - converted.reduce((sum, entry) => sum + entry.quantity, 0);
        if (difference !== 0) {
          if (!converted.length)
            return notify(
              "الدفعات المحددة لا تغطي الكمية المطلوبة لصنف " +
                result.item.name +
                ".",
            );
          converted[converted.length - 1].quantity += difference;
        }
        lotAllocationsPayload.push(...converted);
      }
    }
    void run(
      () =>
        callOperation("confirmPacking", {
          number: state.nextNumbers.PCK,
          finishedItemId: activeItemId,
          date: state.today,
          plannedUnits,
          producedUnits: plannedUnits,
          wasteQty: wasteBase,
          inputs,
          lotAllocations: lotAllocationsPayload,
        }),
      "تم اعتماد أمر التعبئة، خصم المدخلات وإنشاء دفعة إنتاج جديدة.",
    );
  };
  const [cancelling, setCancelling] = useState<Packing | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const confirmCancelPacking = () => {
    if (!cancelling) return;
    if (!cancelReason.trim())
      return notify("سجّل سبب الإلغاء ليظهر في سجل التدقيق.");
    void run(
      () =>
        callOperation("cancelPacking", {
          id: cancelling.id,
          reason: cancelReason.trim(),
        }),
      "تم إلغاء أمر التعبئة وإعادة المدخلات إلى دفعاتها.",
    ).then((ok) => {
      if (ok) {
        setCancelling(null);
        setCancelReason("");
      }
    });
  };
  const confirmedPackings = state.packings.filter(
    (packing) => packing.status !== "cancelled",
  );
  return (
    <>
      <div className="section-header">
        <div>
          <h2>أمر تعبئة جديد</h2>
          <p>احسب احتياج الخام والتغليف والتكلفة قبل الاعتماد</p>
        </div>
        <button
          className="primary"
          onClick={confirm}
          disabled={plannedUnits <= 0 || busy}
        >
          <CheckCircle2 size={15} /> اعتماد أمر التعبئة
        </button>
      </div>
      <div className="packing-layout">
        <section className="form-card" style={{ padding: 18 }}>
          <div className="field">
            <label>المنتج النهائي</label>
            <select
              value={activeItemId}
              onChange={(event) => {
                const nextId = event.target.value;
                setItemId(nextId);
                const nextRaw = state.items.find(
                  (item) =>
                    item.id ===
                    state.items
                      .find((productItem) => productItem.id === nextId)
                      ?.recipe?.find((line) => line.kind === "raw")?.itemId,
                );
                setAvailableRaw(nextRaw?.stock || 0);
              }}
            >
              {finished.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div
            className="packing-mode"
            role="group"
            aria-label="طريقة حساب أمر التعبئة"
          >
            <button
              type="button"
              className={mode === "target" ? "active" : ""}
              onClick={() => setMode("target")}
            >
              عدد عبوات محدد
            </button>
            <button
              type="button"
              className={mode === "reverse" ? "active" : ""}
              onClick={() => setMode("reverse")}
            >
              العبوات الممكنة من الخام
            </button>
          </div>
          {mode === "target" ? (
            <div className="field" style={{ marginTop: 14 }}>
              <label>عدد العبوات المطلوب إنتاجها</label>
              <input
                type="number"
                min="1"
                step="1"
                value={units}
                onChange={(event) => setUnits(Number(event.target.value))}
              />
            </div>
          ) : (
            <>
              <div className="field" style={{ marginTop: 14 }}>
                <label>
                  كمية الخام المتاحة
                  {rawItem ? " (" + rawItem.baseUnit + ")" : ""}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={rawItem?.stock}
                  value={availableRaw}
                  onChange={(event) =>
                    setAvailableRaw(Number(event.target.value))
                  }
                />
                <small>
                  رصيد الصنف الفعلي:{" "}
                  {rawItem ? quantity(rawItem.stock, rawItem.baseUnit) : "—"}
                </small>
              </div>
              <div className="capacity-result">
                <span>أقصى إنتاج ممكن وفق الخام والتغليف</span>
                <strong>{quantity(maxUnits, product?.baseUnit)}</strong>
              </div>
            </>
          )}
          <div className="field" style={{ marginTop: 14 }}>
            <label>
              الفاقد الفعلي من الخام
              {rawItem ? " (" + rawItem.baseUnit + ")" : ""}
            </label>
            <input
              type="number"
              min="0"
              step=".1"
              value={waste}
              onChange={(event) => setWaste(Number(event.target.value))}
            />
          </div>
          {mode === "target" && (
            <div style={{ display: "flex", gap: 7, marginTop: 16 }}>
              <button
                className="secondary"
                disabled={maxUnits <= 0}
                onClick={() => setUnits(maxUnits)}
              >
                استخدم الحد المتاح ({quantity(maxUnits, product?.baseUnit)})
              </button>
            </div>
          )}
          <div className="notice" style={{ marginTop: 16 }}>
            <b>تتبّع دفعات المدخلات</b>
            <span>
              يُسجل النظام الدفعات المستخدمة مع أمر التعبئة وحركات المخزون.
            </span>
          </div>
        </section>
        <section className="form-card" style={{ padding: 18 }}>
          <div className="card-title">
            <div>
              <h3>معاينة الاحتياج والتكلفة</h3>
              <span style={{ color: "#7c8b85", fontSize: 10 }}>
                {mode === "reverse"
                  ? "عدد العبوات محسوب تلقائيًا من الكمية المتاحة"
                  : "تحديث لحظي حسب الوصفة والفاقد"}
              </span>
            </div>
          </div>
          <div className="estimate">
            {estimate.inputs.map((input) => (
              <div className="estimate-row" key={input.item.id}>
                <div>
                  <b>{input.item.name}</b>
                  <br />
                  <small>
                    المتاح: {quantity(input.item.stock, input.item.baseUnit)}
                  </small>
                </div>
                <span>{quantity(input.needed, input.item.baseUnit)}</span>
                <span className={input.enough ? "ok" : "warn"}>
                  {input.enough ? "متاح ✓" : "غير كافٍ"}
                </span>
              </div>
            ))}
          </div>
          <div className="lot-allocation">
            <div className="lot-allocation-head">
              <div>
                <b>تخصيص دفعات المدخلات</b>
                <small>يمكن السحب من أكثر من دفعة لنفس الصنف</small>
              </div>
              <div className="lot-mode">
                <button
                  type="button"
                  className={lotMode === "fifo" ? "active" : ""}
                  onClick={() => setLotMode("fifo")}
                >
                  FIFO تلقائي
                </button>
                <button
                  type="button"
                  className={lotMode === "manual" ? "active" : ""}
                  onClick={enterManualLots}
                >
                  اختيار يدوي
                </button>
              </div>
            </div>
            {allocationResults.map((result) => (
              <div className="lot-item" key={result.item.id}>
                <div className="lot-item-title">
                  <b>{result.item.name}</b>
                  <span>
                    مطلوب {quantity(result.needed, result.item.baseUnit)}
                  </span>
                </div>
                {lotMode === "manual" && (
                  <div className="lot-options">
                    {result.options.length ? (
                      result.options.map((option) => (
                        <label className="lot-option" key={option.id}>
                          <input
                            type="checkbox"
                            checked={result.selected.includes(option.id)}
                            onChange={(event) =>
                              toggleLot(
                                result.item.id,
                                option.id,
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            {option.code} ·{" "}
                            {quantity(option.available, result.item.baseUnit)}
                          </span>
                        </label>
                      ))
                    ) : (
                      <small>لا توجد دفعات متاحة لهذا الصنف.</small>
                    )}
                  </div>
                )}
                <div
                  className={
                    "lot-allocation-result " + (result.enough ? "ok" : "warn")
                  }
                >
                  {result.enough
                    ? "المصدر: " +
                      result.used
                        .map(
                          (allocation) =>
                            allocation.code +
                            " (" +
                            quantity(
                              allocation.quantity,
                              result.item.baseUnit,
                            ) +
                            ")",
                        )
                        .join(" + ")
                    : "عجز في الدفعات المحددة: " +
                      quantity(result.remaining, result.item.baseUnit)}
                </div>
              </div>
            ))}
          </div>
          {mode === "reverse" && maxUnits <= 0 && (
            <div className="notice capacity-warning">
              <b>لا توجد كمية قابلة للتعبئة</b>
              <span>راجع رصيد الخام والتغليف والفاقد المدخل.</span>
            </div>
          )}
          <div className="summary-cost">
            <span>تكلفة العبوة التقديرية</span>
            <strong>{plannedUnits > 0 ? money(estimate.unitCost) : "—"}</strong>
            <small>
              خام {money(estimate.rawCost)} + تغليف{" "}
              {money(estimate.packagingCost)} · فاقد{" "}
              {quantity(waste, rawItem?.baseUnit || "")}
            </small>
          </div>
        </section>
      </div>
      {currentUser.role === "owner" && confirmedPackings.length > 0 && (
        <section
          className="card"
          style={{ marginTop: 17, padding: 0, overflow: "hidden" }}
        >
          <div className="card-title" style={{ padding: "14px 16px 0" }}>
            <div>
              <h3>إلغاء أوامر التعبئة</h3>
              <span>متاح فقط إذا لم يُستهلك أي جزء من دفعة الإنتاج</span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>الأمر</th>
                <th>المنتج</th>
                <th>العبوات</th>
                <th>التاريخ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {confirmedPackings.map((packing) => (
                <tr key={packing.id}>
                  <td className="name-cell">
                    <b>{packing.number}</b>
                  </td>
                  <td>
                    {state.items.find((item) => item.id === packing.itemId)
                      ?.name || "—"}
                  </td>
                  <td>
                    {quantity(
                      packing.units,
                      state.items.find((item) => item.id === packing.itemId)
                        ?.baseUnit,
                    )}
                  </td>
                  <td>{packing.date}</td>
                  <td>
                    <button
                      className="danger"
                      onClick={() => {
                        setCancelling(packing);
                        setCancelReason("");
                      }}
                    >
                      <Ban size={14} /> إلغاء الأمر
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {cancelling && (
        <Modal
          title={"إلغاء أمر التعبئة " + cancelling.number}
          onClose={() => setCancelling(null)}
        >
          <p>
            ستعود كل المدخلات إلى دفعاتها وتُبطل دفعة الإنتاج. لا يمكن الإلغاء
            إذا بيع أو استُهلك أي جزء من الإنتاج.
          </p>
          <div className="field" style={{ marginTop: 11 }}>
            <label>سبب الإلغاء</label>
            <input
              autoFocus
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="مثال: خطأ في كمية الإنتاج"
            />
          </div>
          <div className="modal-actions">
            <button
              className="danger"
              onClick={confirmCancelPacking}
              disabled={busy}
            >
              تأكيد الإلغاء
            </button>
            <button className="secondary" onClick={() => setCancelling(null)}>
              رجوع
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default PackingWorkspace;

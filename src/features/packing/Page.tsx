import { useMemo, useState } from "react";
import { toBase } from "../../lib/api";
import { useApp } from "../../app/AppProvider";
import { money, Packing, packingCapacity, packingEstimate, quantity } from "../../lib/domain";
import PackingForm from "./PackingForm";
import PackingHistory from "./PackingHistory";
import PackingCancelDialog from "./PackingCancelDialog";

function PackingWorkspace() {
  const { state, currentUser } = useApp();
  if (!state || !currentUser) return null;
  return <PackingContent />;
}

function PackingContent() {
  const { state: snapshot, run, busy, currentUser: session, notify } = useApp();
  const state = snapshot!;
  const currentUser = session!;
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
  // UX hint — backend is authoritative.
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
          const lastAllocation = converted[converted.length - 1];
          if (lastAllocation) lastAllocation.quantity += difference;
        }
        lotAllocationsPayload.push(...converted);
      }
    }
    void run(
        "packing:confirm",
        {
          number: state.nextNumbers.PCK,
          finishedItemId: activeItemId,
          date: state.today,
          plannedUnits,
          producedUnits: plannedUnits,
          wasteQty: wasteBase,
          inputs,
          lotAllocations: lotAllocationsPayload,
        },
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
        "packing:cancel",
        {
          id: cancelling.id,
          reason: cancelReason.trim(),
        },
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
      <PackingForm
        state={state}
        finished={finished}
        onSelectItem={(nextId) => {
          setItemId(nextId);
          const rawId = state.items.find((entry) => entry.id === nextId)?.recipe?.find((line) => line.kind === "raw")?.itemId;
          setAvailableRaw(state.items.find((entry) => entry.id === rawId)?.stock || 0);
        }}
        activeItemId={activeItemId}
        product={product}
        rawItem={rawItem}
        mode={mode}
        setMode={setMode}
        units={units}
        setUnits={setUnits}
        availableRaw={availableRaw}
        setAvailableRaw={setAvailableRaw}
        waste={waste}
        setWaste={setWaste}
        maxUnits={maxUnits}
        plannedUnits={plannedUnits}
        estimate={estimate}
        lotMode={lotMode}
        setLotMode={setLotMode}
        allocationResults={allocationResults}
        enterManualLots={enterManualLots}
        toggleLot={toggleLot}
        onConfirm={confirm}
        busy={busy}
      />
      {currentUser.role === "owner" && <PackingHistory state={state} packings={confirmedPackings} onCancel={(packing) => { setCancelling(packing); setCancelReason(""); }} />}
      <PackingCancelDialog
        packing={cancelling}
        reason={cancelReason}
        setReason={setCancelReason}
        busy={busy}
        onClose={() => setCancelling(null)}
        onConfirm={confirmCancelPacking}
      />
    </>
  );
}

export default PackingWorkspace;

import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2 } from "lucide-react";
import type { AppState, Item } from "../../lib/domain";
import { money, packingEstimate, quantity } from "../../lib/domain";
import { PageHeader } from "../../shared/ui/PageHeader";

type LotOption = { id: string; code: string; available: number };
type Allocation = { item: Item; needed: number; options: LotOption[]; selected: string[]; used: { code: string; quantity: number }[]; remaining: number; enough: boolean };
type Mode = "target" | "reverse";
type LotMode = "fifo" | "manual";
interface Props {
  state: AppState; finished: Item[]; onSelectItem: (itemId: string) => void;
  activeItemId: string; product?: Item | undefined; rawItem?: Item | undefined; mode: Mode; setMode: Dispatch<SetStateAction<Mode>>;
  units: number; setUnits: Dispatch<SetStateAction<number>>; availableRaw: number; setAvailableRaw: Dispatch<SetStateAction<number>>;
  waste: number; setWaste: Dispatch<SetStateAction<number>>; maxUnits: number; plannedUnits: number;
  estimate: ReturnType<typeof packingEstimate>; lotMode: LotMode; setLotMode: Dispatch<SetStateAction<LotMode>>;
  allocationResults: Allocation[]; enterManualLots: () => void; toggleLot: (itemId: string, lotId: string, checked: boolean) => void;
  onConfirm: () => void; busy: boolean;
}

export default function PackingForm(props: Props) {
  const { state, finished, onSelectItem, activeItemId, product, rawItem, mode, setMode, units, setUnits, availableRaw, setAvailableRaw, waste, setWaste, maxUnits, plannedUnits, estimate, lotMode, setLotMode, allocationResults, enterManualLots, toggleLot, onConfirm, busy } = props;
  return <>
    <PageHeader title="أمر تعبئة جديد" description="احسب احتياج الخام والتغليف والتكلفة قبل الاعتماد" actions={<button className="primary" onClick={onConfirm} disabled={plannedUnits <= 0 || busy}><CheckCircle2 size={15} /> اعتماد أمر التعبئة</button>} />
    <div className="packing-layout">
      <section className="form-card panel-inset">
        <div className="field"><label>المنتج النهائي</label><select value={activeItemId} onChange={(event) => onSelectItem(event.target.value)}>{finished.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
        <div className="packing-mode" role="group" aria-label="طريقة حساب أمر التعبئة"><button type="button" className={mode === "target" ? "active" : ""} onClick={() => setMode("target")}>عدد عبوات محدد</button><button type="button" className={mode === "reverse" ? "active" : ""} onClick={() => setMode("reverse")}>العبوات الممكنة من الخام</button></div>
        {mode === "target" ? <div className="field field-spaced"><label>عدد العبوات المطلوب إنتاجها</label><input type="number" min="1" step="1" value={units} onChange={(event) => setUnits(Number(event.target.value))} /></div> : <><div className="field field-spaced"><label>كمية الخام المتاحة{rawItem ? ` (${rawItem.baseUnit})` : ""}</label><input type="number" min="0" step="0.01" max={rawItem?.stock} value={availableRaw} onChange={(event) => setAvailableRaw(Number(event.target.value))} /><small>رصيد الصنف الفعلي: {rawItem ? quantity(rawItem.stock, rawItem.baseUnit) : "—"}</small></div><div className="capacity-result"><span>أقصى إنتاج ممكن وفق الخام والتغليف</span><strong>{quantity(maxUnits, product?.baseUnit)}</strong></div></>}
        <div className="field field-spaced"><label>الفاقد الفعلي من الخام{rawItem ? ` (${rawItem.baseUnit})` : ""}</label><input type="number" min="0" step=".1" value={waste} onChange={(event) => setWaste(Number(event.target.value))} /></div>
        {mode === "target" && <div className="packing-use-max"><button className="secondary" disabled={maxUnits <= 0} onClick={() => setUnits(maxUnits)}>استخدم الحد المتاح ({quantity(maxUnits, product?.baseUnit)})</button></div>}
        <div className="notice notice-spaced"><b>تتبّع دفعات المدخلات</b><span>يُسجل النظام الدفعات المستخدمة مع أمر التعبئة وحركات المخزون.</span></div>
      </section>
      <PackingEstimate state={state} estimate={estimate} rawItem={rawItem} waste={waste} plannedUnits={plannedUnits} mode={mode} maxUnits={maxUnits} lotMode={lotMode} setLotMode={setLotMode} allocationResults={allocationResults} enterManualLots={enterManualLots} toggleLot={toggleLot} />
    </div>
  </>;
}

export function PackingEstimate({ state, estimate, rawItem, waste, plannedUnits, mode, maxUnits, lotMode, setLotMode, allocationResults, enterManualLots, toggleLot }: Pick<Props, "state" | "estimate" | "rawItem" | "waste" | "plannedUnits" | "mode" | "maxUnits" | "lotMode" | "setLotMode" | "allocationResults" | "enterManualLots" | "toggleLot">) {
  return <section className="form-card panel-inset"><div className="card-title"><div><h3>معاينة الاحتياج والتكلفة</h3><span className="status-secondary">{mode === "reverse" ? "عدد العبوات محسوب تلقائيًا من الكمية المتاحة" : "تحديث لحظي حسب الوصفة والفاقد"}</span></div></div>
    <div className="estimate">{estimate.inputs.map((input) => <div className="estimate-row" key={input.item.id}><div><b>{input.item.name}</b><br /><small>المتاح: {quantity(input.item.stock, input.item.baseUnit)}</small></div><span>{quantity(input.needed, input.item.baseUnit)}</span><span className={input.enough ? "ok" : "warn"}>{input.enough ? "متاح ✓" : "غير كافٍ"}</span></div>)}</div>
    <div className="lot-allocation"><div className="lot-allocation-head"><div><b>تخصيص دفعات المدخلات</b><small>يمكن السحب من أكثر من دفعة لنفس الصنف</small></div><div className="lot-mode"><button type="button" className={lotMode === "fifo" ? "active" : ""} onClick={() => setLotMode("fifo")}>FIFO تلقائي</button><button type="button" className={lotMode === "manual" ? "active" : ""} onClick={enterManualLots}>اختيار يدوي</button></div></div>
      {allocationResults.map((result) => <div className="lot-item" key={result.item.id}><div className="lot-item-title"><b>{result.item.name}</b><span>مطلوب {quantity(result.needed, result.item.baseUnit)}</span></div>
        {lotMode === "manual" && <div className="lot-options">{result.options.length ? result.options.map((option) => <label className="lot-option" key={option.id}><input type="checkbox" checked={result.selected.includes(option.id)} onChange={(event) => toggleLot(result.item.id, option.id, event.target.checked)} /><span>{option.code} · {quantity(option.available, result.item.baseUnit)}</span></label>) : <small>لا توجد دفعات متاحة لهذا الصنف.</small>}</div>}
        <div className={"lot-allocation-result " + (result.enough ? "ok" : "warn")}>{result.enough ? "المصدر: " + result.used.map((allocation) => allocation.code + " (" + quantity(allocation.quantity, result.item.baseUnit) + ")").join(" + ") : "عجز في الدفعات المحددة: " + quantity(result.remaining, result.item.baseUnit)}</div>
      </div>)}
    </div>
    {mode === "reverse" && maxUnits <= 0 && <div className="notice capacity-warning"><b>لا توجد كمية قابلة للتعبئة</b><span>راجع رصيد الخام والتغليف والفاقد المدخل.</span></div>}
    <div className="summary-cost"><span>تكلفة العبوة التقديرية</span><strong>{plannedUnits > 0 ? money(estimate.unitCost) : "—"}</strong><small>خام {money(estimate.rawCost)} + تغليف {money(estimate.packagingCost)} · فاقد {quantity(waste, rawItem?.baseUnit || "")}</small></div>
  </section>;
}

import { ArchiveRestore, Clock3, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { AppState, PurchaseDraft } from "../../lib/domain";
import { money, quantity } from "../../lib/domain";

export function PurchaseDraftsPanel({ state, onLoad, onDelete, repeatPurchaseId, setRepeatPurchaseId, onDuplicate, busy }: { state: AppState; onLoad: (draft: PurchaseDraft) => void; onDelete: (draft: PurchaseDraft) => void; repeatPurchaseId: string; setRepeatPurchaseId: Dispatch<SetStateAction<string>>; onDuplicate: () => void; busy: boolean }) {
  return <>
    {state.purchaseDrafts.length > 0 && <section className="card purchase-drafts"><div className="card-title"><div><h3>مسودات الشراء</h3><span>{state.purchaseDrafts.length} مسودة غير معتمدة</span></div></div><div className="draft-list">{state.purchaseDrafts.map((draft) => <div className="draft-row" key={draft.id}><div><b>{draft.number}</b><small>{state.suppliers.find((item) => item.id === draft.supplierId)?.name || "مورد غير متاح"} · {state.items.find((item) => item.id === draft.itemId)?.name || "صنف غير متاح"} · {quantity(draft.quantity, state.items.find((item) => item.id === draft.itemId)?.baseUnit)}</small></div><strong>{money(draft.quantity * draft.unitPrice + draft.extraCosts)}</strong><button className="secondary" onClick={() => onLoad(draft)}>استكمال</button><button className="danger" onClick={() => onDelete(draft)} aria-label={"حذف " + draft.number}><Trash2 size={14} /></button></div>)}</div></section>}
    {state.purchases.length > 0 && <section className="card repeat-purchase"><div className="field"><label>تكرار فاتورة شراء سابقة كمسودة</label><select value={repeatPurchaseId} onChange={(event) => setRepeatPurchaseId(event.target.value)}><option value="">اختر فاتورة سابقة</option>{[...state.purchases].sort((a, b) => b.date.localeCompare(a.date)).map((purchase) => <option key={purchase.id} value={purchase.id}>{purchase.number} · {state.suppliers.find((item) => item.id === purchase.supplierId)?.name || "مورد"} · {purchase.date}</option>)}</select></div><button className="secondary" disabled={!repeatPurchaseId || busy} onClick={onDuplicate}><ArchiveRestore size={15} /> تكرار كمسودة</button></section>}
  </>;
}

export function PurchaseActions({ editing, busy, onSaveDraft, onConfirm }: { editing: boolean; busy: boolean; onSaveDraft: () => void; onConfirm: () => void }) {
  return <div className="section-header"><div><h2>{editing ? "استكمال مسودة شراء" : "فاتورة شراء جديدة"}</h2><p>المسودات لا تؤثر على المخزون أو رصيد المورد حتى الاعتماد</p></div><div className="toolbar"><button className="secondary" onClick={onSaveDraft} disabled={busy}><Clock3 size={15} /> حفظ كمسودة</button><button className="primary" onClick={onConfirm} disabled={busy}><ArchiveRestore size={15} /> اعتماد + إضافة للمخزون</button></div></div>;
}

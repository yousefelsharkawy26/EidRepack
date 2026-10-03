import { ArchiveRestore, Clock3, Trash2 } from "lucide-react";
import type { AppState, PurchaseDraft } from "../../lib/domain";
import { money, quantity } from "../../lib/domain";
import { PaginationBar, usePagination } from "../../shared/ui/Pagination";

export function PurchaseDraftsPanel({ state, onLoad, onDelete }: { state: AppState; onLoad: (draft: PurchaseDraft) => void; onDelete: (draft: PurchaseDraft) => void }) {
  const draftsPage = usePagination(state.purchaseDrafts);
  return <>
    {state.purchaseDrafts.length > 0 && <section className="card card-flush"><div className="card-title panel-title-inset"><div><h3>مسودات الشراء</h3><span>{state.purchaseDrafts.length} مسودة قابلة للتعديل أو الحذف</span></div></div><div className="data-table"><table><thead><tr><th>المسودة</th><th>المورد</th><th>الصنف</th><th>الكمية</th><th>الإجمالي</th><th>الإجراءات</th></tr></thead><tbody>{draftsPage.pageItems.map((draft) => { const item = state.items.find(entry => entry.id === draft.itemId); return <tr key={draft.id}><td className="name-cell"><b>{draft.number}</b></td><td>{state.suppliers.find(entry => entry.id === draft.supplierId)?.name || "مورد غير متاح"}</td><td>{item?.name || "صنف غير متاح"}</td><td>{quantity(draft.quantity,item?.baseUnit)}</td><td>{money(draft.quantity*draft.unitPrice+draft.extraCosts)}</td><td className="table-actions-cell"><button className="secondary" onClick={() => onLoad(draft)}><Clock3 size={14}/> استكمال</button><button className="danger" onClick={() => onDelete(draft)} aria-label={"حذف " + draft.number}><Trash2 size={14}/></button></td></tr>; })}</tbody></table></div><PaginationBar state={draftsPage.pagination}/></section>}
  </>;
}

export function PurchaseActions({ editing, busy, onSaveDraft, onConfirm }: { editing: boolean; busy: boolean; onSaveDraft: () => void; onConfirm: () => void }) {
  return <div className="section-header"><div><h2>{editing ? "استكمال مسودة شراء" : "فاتورة شراء جديدة"}</h2><p>المسودات لا تؤثر على المخزون أو رصيد المورد حتى الاعتماد</p></div><div className="toolbar"><button className="secondary" onClick={onSaveDraft} disabled={busy}><Clock3 size={15} /> حفظ كمسودة</button><button className="primary" onClick={onConfirm} disabled={busy}><ArchiveRestore size={15} /> اعتماد + إضافة للمخزون</button></div></div>;
}

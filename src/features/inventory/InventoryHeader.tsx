import { ClipboardList, Plus } from "lucide-react";

export default function InventoryHeader({ isOwner, onNewItem, onLedger, onAdjust }: { isOwner: boolean; onNewItem: () => void; onLedger: () => void; onAdjust: () => void }) {
  return <div className="section-header"><div><h2>المخزون والدفعات</h2><p>الأرصدة الفعلية، كتالوج الأصناف، تسويات الجرد، والصلاحية</p></div>
    <div className="toolbar">{isOwner && <button className="primary" onClick={onNewItem}><Plus size={15} /> صنف جديد</button>}
      <button className="secondary" onClick={onLedger}><ClipboardList size={15} /> سجل الحركات</button>
      <button className="secondary" onClick={onAdjust}><Plus size={15} /> تسوية جرد</button>
    </div>
  </div>;
}

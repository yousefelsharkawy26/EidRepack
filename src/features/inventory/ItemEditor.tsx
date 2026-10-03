import type { Dispatch, SetStateAction } from "react";
import type { Item, ItemType, RecipeLine } from "../../lib/domain";
import { UNIT_FACTORS } from "../../lib/types";
import Modal from "../../components/Modal";
import RecipeEditor from "./RecipeEditor";
import OpeningStockForm from "./OpeningStockForm";

interface Props {
  open: boolean; item: Item | null; onClose: () => void; onSave: () => void;
  name: string; setName: Dispatch<SetStateAction<string>>; sku: string; setSku: Dispatch<SetStateAction<string>>;
  type: ItemType; setType: Dispatch<SetStateAction<ItemType>>; unit: string; setUnit: Dispatch<SetStateAction<string>>;
  minStock: number; setMinStock: Dispatch<SetStateAction<number>>; cost: number; setCost: Dispatch<SetStateAction<number>>;
  salePrice: number; setSalePrice: Dispatch<SetStateAction<number>>; initialStock: number; setInitialStock: Dispatch<SetStateAction<number>>;
  rawItems: Item[]; packagingItems: Item[]; recipeLines: RecipeLine[]; setRecipeLines: Dispatch<SetStateAction<RecipeLine[]>>;
}

export default function ItemEditor(props: Props) {
  const { open, item, onClose, onSave, name, setName, sku, setSku, type, setType, unit, setUnit, minStock, setMinStock, cost, setCost, salePrice, setSalePrice, initialStock, setInitialStock, rawItems, packagingItems, recipeLines, setRecipeLines } = props;
  if (!open) return null;
  return <Modal wide title={item ? "تعديل بيانات الصنف" : "إضافة صنف جديد"} onClose={onClose}>
    <div className="item-form-grid">
      <div className="field"><label>اسم الصنف</label><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: أرز بسمتي" /></div>
      <div className="field"><label>كود الصنف SKU</label><input value={sku} onChange={(event) => setSku(event.target.value)} placeholder="SKU-RICE-001" /></div>
      <div className="field"><label>نوع الصنف</label><select value={type} disabled={Boolean(item?.hasStockMovements)} onChange={(event) => setType(event.target.value as ItemType)}><option value="raw">مادة خام</option><option value="packaging">مادة تغليف</option><option value="finished">منتج جاهز</option></select></div>
      <div className="field"><label>وحدة القياس الأساسية</label><select value={unit} disabled={Boolean(item?.hasStockMovements)} onChange={(event) => setUnit(event.target.value)}>{Object.keys(UNIT_FACTORS).map((entry) => <option key={entry}>{entry}</option>)}</select></div>
      <div className="field"><label>الحد الأدنى للمخزون</label><input type="number" min="0" value={minStock} onChange={(event) => setMinStock(Number(event.target.value))} /></div>
      <div className="field"><label>تكلفة الوحدة</label><input type="number" min="0" step="0.01" value={cost} onChange={(event) => setCost(Number(event.target.value))} /></div>
      {type === "finished" && <div className="field"><label>سعر البيع</label><input type="number" min="0" step="0.01" value={salePrice} onChange={(event) => setSalePrice(Number(event.target.value))} /></div>}
      {!item && <OpeningStockForm value={initialStock} onChange={setInitialStock} />}
    </div>
    {item?.hasStockMovements && <p className="field-hint">لا يمكن تغيير النوع أو وحدة القياس بعد تسجيل حركات مخزون؛ أنشئ صنفًا جديدًا إذا لزم تغييرهما.</p>}
    {type === "finished" && <RecipeEditor rawItems={rawItems} packagingItems={packagingItems} lines={recipeLines} setLines={setRecipeLines} />}
    <div className="modal-actions"><button className="primary" onClick={onSave}>حفظ الصنف</button><button className="secondary" onClick={onClose}>إلغاء</button></div>
  </Modal>;
}

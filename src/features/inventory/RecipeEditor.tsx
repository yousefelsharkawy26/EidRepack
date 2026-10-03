import type { Dispatch, SetStateAction } from "react";
import type { Item } from "../../lib/domain";

interface Props {
  rawItems: Item[]; packagingItems: Item[];
  rawId: string; setRawId: Dispatch<SetStateAction<string>>;
  rawQty: number; setRawQty: Dispatch<SetStateAction<number>>;
  packagingId: string; setPackagingId: Dispatch<SetStateAction<string>>;
  packagingQty: number; setPackagingQty: Dispatch<SetStateAction<number>>;
}

export default function RecipeEditor({ rawItems, packagingItems, rawId, setRawId, rawQty, setRawQty, packagingId, setPackagingId, packagingQty, setPackagingQty }: Props) {
  return <section className="recipe-editor"><h4>وصفة العبوة</h4><p>المقادير المستهلكة لإنتاج عبوة واحدة</p>
    <div className="item-form-grid">
      <div className="field"><label>المادة الخام</label><select value={rawId} onChange={(event) => setRawId(event.target.value)}>{rawItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="field"><label>كمية الخام لكل عبوة</label><input type="number" min="0.001" step="0.001" value={rawQty} onChange={(event) => setRawQty(Number(event.target.value))} /></div>
      <div className="field"><label>مادة التغليف</label><select value={packagingId} onChange={(event) => setPackagingId(event.target.value)}>{packagingItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="field"><label>كمية التغليف لكل عبوة</label><input type="number" min="0.001" step="0.001" value={packagingQty} onChange={(event) => setPackagingQty(Number(event.target.value))} /></div>
    </div>
  </section>;
}

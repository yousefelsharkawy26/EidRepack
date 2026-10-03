import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Item, RecipeLine } from "../../lib/domain";

interface Props {
  rawItems: Item[];
  packagingItems: Item[];
  lines: RecipeLine[];
  setLines: Dispatch<SetStateAction<RecipeLine[]>>;
}

export default function RecipeEditor({ rawItems, packagingItems, lines, setLines }: Props) {
  const updateLine = (index: number, patch: Partial<RecipeLine>) => {
    setLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };
  const removeLine = (index: number) => setLines(current => current.filter((_, lineIndex) => lineIndex !== index));
  const addLine = (kind: RecipeLine["kind"]) => {
    const candidates = kind === "raw" ? rawItems : packagingItems;
    const used = new Set(lines.filter(line => line.kind === kind).map(line => line.itemId));
    const item = candidates.find(candidate => !used.has(candidate.id));
    if (item) setLines(current => [...current, { itemId: item.id, qty: kind === "raw" ? 0.5 : 1, kind }]);
  };
  const renderLines = (kind: RecipeLine["kind"], candidates: Item[], heading: string, addLabel: string) => {
    const indexed = lines.map((line, index) => ({ line, index })).filter(entry => entry.line.kind === kind);
    return <section className="recipe-component-group">
      <header><div><h5>{heading}</h5><span>{indexed.length} مكونات</span></div><button type="button" className="secondary" disabled={indexed.length >= candidates.length} onClick={() => addLine(kind)}><Plus size={14}/>{addLabel}</button></header>
      {indexed.map(({ line, index }, rowIndex) => <div className="recipe-component-row" key={kind + "-" + line.itemId}>
        <div className="field"><label>{heading} {rowIndex + 1}</label><select value={line.itemId} onChange={event => updateLine(index, { itemId: event.target.value })}>
          {candidates.filter(item => item.id === line.itemId || !lines.some((other, otherIndex) => otherIndex !== index && other.kind === kind && other.itemId === item.id)).map(item => <option key={item.id} value={item.id}>{item.name} · {item.baseUnit}</option>)}
        </select></div>
        <div className="field"><label>الكمية لكل عبوة</label><input type="number" min="0.001" step="0.001" value={line.qty} onChange={event => updateLine(index, { qty: Number(event.target.value) })}/></div>
        <button type="button" className="icon-button recipe-remove" aria-label={`حذف ${heading} ${rowIndex + 1}`} onClick={() => removeLine(index)}><Trash2 size={15}/></button>
      </div>)}
      {candidates.length === 0 && <p className="empty-state">أضف أصناف {heading} إلى المخزون أولًا.</p>}
    </section>;
  };

  return <section className="recipe-editor"><div className="recipe-editor-heading"><div><h4>وصفة العبوة</h4><p>حدد كل المواد التي تدخل في إنتاج عبوة واحدة وكميتها.</p></div></div>
    <div className="recipe-components-grid">
      {renderLines("raw", rawItems, "المادة الخام", "إضافة مادة خام")}
      {renderLines("packaging", packagingItems, "مادة التغليف", "إضافة مادة تغليف")}
    </div>
  </section>;
}

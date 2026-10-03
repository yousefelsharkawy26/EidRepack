import type { Dispatch, SetStateAction } from "react";

export default function OpeningStockForm({ value, onChange }: { value: number; onChange: Dispatch<SetStateAction<number>> }) {
  return <div className="field"><label>رصيد افتتاحي</label><input type="number" min="0" value={value} onChange={(event) => onChange(Number(event.target.value))} /></div>;
}

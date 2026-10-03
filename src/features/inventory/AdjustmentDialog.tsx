import type { Dispatch, SetStateAction } from "react";
import { PinPrompt } from "../../shared/ui/PinPrompt";

export default function AdjustmentDialog({ open, counted, setCounted, pin, setPin, busy, onClose, onConfirm }: {
  open: boolean; counted: number; setCounted: Dispatch<SetStateAction<number>>;
  pin: string; setPin: Dispatch<SetStateAction<string>>; busy: boolean;
  onClose: () => void; onConfirm: () => void;
}) {
  if (!open) return null;
  return <PinPrompt title="تسوية جرد حساسة" pin={pin} setPin={setPin} busy={busy}
    submitLabel="اعتماد التسوية" cancelVariant="danger" onSubmit={onConfirm} onCancel={onClose}>
    <p>ستُسجَّل الفروقات في سجل التدقيق ولا يمكن حذف السجل.</p>
    <div className="field"><label>الكمية الفعلية</label><input autoFocus type="number" min="0" value={counted} onChange={(event) => setCounted(Number(event.target.value))} /></div>
  </PinPrompt>;
}

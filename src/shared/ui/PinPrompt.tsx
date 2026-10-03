import type { ReactNode } from "react";
import { FormModal } from "./FormModal";

export function PinPrompt({ title, pin, setPin, reason, setReason, reasonLabel = "سبب العملية", submitLabel = "اعتماد", busyLabel = "جارٍ التنفيذ…", cancelLabel = "إلغاء", cancelVariant = "secondary", busy = false, submitDisabled = false, children, onSubmit, onCancel }: {
  title: string; pin: string; setPin: (value: string) => void;
  reason?: string; setReason?: (value: string) => void; reasonLabel?: string;
  submitLabel?: string; busyLabel?: string; cancelLabel?: string; cancelVariant?: "secondary" | "danger"; busy?: boolean; submitDisabled?: boolean;
  children?: ReactNode; onSubmit: () => void; onCancel: () => void;
}) {
  return <FormModal title={title} onClose={onCancel} actions={<>
    <button className="primary" disabled={busy || submitDisabled || pin.length < 4} onClick={onSubmit}>{busy ? busyLabel : submitLabel}</button>
    <button className={cancelVariant} disabled={busy} onClick={onCancel}>{cancelLabel}</button>
  </>}>
    {children}
    <div className="field"><label>PIN المالك</label><input autoFocus type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} /></div>
    {reason !== undefined && setReason && <div className="field field-spaced"><label>{reasonLabel}</label><input value={reason} onChange={(event) => setReason(event.target.value)} /></div>}
  </FormModal>;
}

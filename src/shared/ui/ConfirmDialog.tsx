import { FormModal } from "./FormModal";

export function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = "تأكيد", destructive = false, busy = false }: {
  title: string; message: string; onConfirm: () => void; onCancel: () => void;
  confirmLabel?: string; destructive?: boolean; busy?: boolean;
}) {
  return <FormModal title={title} onClose={onCancel} actions={<>
    <button className={destructive ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    <button className="secondary" disabled={busy} onClick={onCancel}>إلغاء</button>
  </>}>
    <p>{message}</p>
  </FormModal>;
}

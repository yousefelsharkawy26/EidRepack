import type { ReactNode } from "react";
import { Modal } from "./Modal";

export function FormModal({ title, children, actions, onClose, wide = false }: {
  title: string; children: ReactNode; actions?: ReactNode; onClose: () => void; wide?: boolean;
}) {
  return <Modal title={title} onClose={onClose} wide={wide}>
    <div className="form-modal-content">{children}</div>
    {actions && <div className="modal-actions">{actions}</div>}
  </Modal>;
}

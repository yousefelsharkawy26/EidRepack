import type { ReactNode } from "react";

export function Modal({ title, children, onClose, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  return <div className="modal-cover" onMouseDown={onClose}>
    <div className={`modal ${wide ? "wide" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
      <h3>{title}</h3>{children}
    </div>
  </div>;
}

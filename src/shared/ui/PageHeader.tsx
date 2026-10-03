import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: {
  title: string; description?: string; actions?: ReactNode;
}) {
  return <div className="section-header">
    <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
    {actions && <div className="section-header-actions">{actions}</div>}
  </div>;
}

import type { ReactNode } from "react";

export function Field({ label, children, error, hint, className = "" }: {
  label: string; children: ReactNode; error?: string; hint?: string; className?: string;
}) {
  return <div className={`field ${className}`.trim()}>
    <label>{label}</label>
    {children}
    {hint && <small className="field-hint">{hint}</small>}
    {error && <small className="field-error" role="alert">{error}</small>}
  </div>;
}

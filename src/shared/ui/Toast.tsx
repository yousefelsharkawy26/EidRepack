import { CheckCircle2 } from "lucide-react";

export function Toast({ message }: { message: string }) {
  if (!message) return null;
  return <div className="toast" role="status"><CheckCircle2 size={15} aria-hidden="true" />{message}</div>;
}

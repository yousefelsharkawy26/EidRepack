import { money } from "../../lib/domain";

export function Money({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={className}>{money(amount)}</span>;
}

import { useEffect, useState } from "react";
import type { Item } from "../../lib/domain";

export function useSaleDraft(finished: Item[]) {
  const [customerId, setCustomerId] = useState("");
  const [payment, setPayment] = useState<"credit" | "cash" | "mixed">("credit");
  const [paid, setPaid] = useState(0);
  const firstFinishedLine = () => {
    const first = finished[0];
    return first ? [{ itemId: first.id, qty: 1, price: first.salePrice || 0 }] : [];
  };
  const [lines, setLines] = useState(firstFinishedLine);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overridePin, setOverridePin] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideGranted, setOverrideGranted] = useState<{ reason: string } | null>(null);
  useEffect(() => { setOverrideGranted(null); }, [customerId, lines, payment, paid]);

  return {
    customerId, setCustomerId, payment, setPayment, paid, setPaid,
    lines, setLines, firstFinishedLine, overrideOpen, setOverrideOpen,
    overridePin, setOverridePin, overrideReason, setOverrideReason,
    overrideGranted, setOverrideGranted,
  };
}

import { money } from "../../lib/domain";
import { PinPrompt } from "../../shared/ui/PinPrompt";

interface CreditOverrideModalProps {
  customerName: string;
  credit: number;
  available: number;
  verifying: boolean;
  pin: string;
  setPin: (pin: string) => void;
  reason: string;
  setReason: (reason: string) => void;
  onVerify: () => void;
  onClose: () => void;
}

export default function CreditOverrideModal({ customerName, credit, available, verifying, pin, setPin, reason, setReason, onVerify, onClose }: CreditOverrideModalProps) {
  return <PinPrompt
    title="تجاوز حد الائتمان — PIN المالك"
    pin={pin} setPin={setPin} reason={reason} setReason={setReason}
    reasonLabel="سبب التجاوز" submitLabel="التحقق من PIN" busyLabel="جارٍ التحقق…"
    busy={verifying} onSubmit={onVerify} onCancel={onClose}
  >
    <p>العميل <b>{customerName}</b> سيتجاوز حد الائتمان بهذه الفاتورة. يلزم PIN المالك وتسجيل سبب واضح لإتمام العملية.</p>
    <div className="mini-stat"><span>الجزء الآجل المطلوب</span><strong>{money(credit)}</strong></div>
    <div className="mini-stat"><span>المتاح بعد الفاتورة</span><strong className="negative-value">{money(available - credit)}</strong></div>
  </PinPrompt>;
}

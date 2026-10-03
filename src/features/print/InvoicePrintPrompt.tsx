import { Printer } from 'lucide-react'
import Modal from '../../components/Modal'

export type PendingInvoicePrint = { kind: 'sale' | 'purchase'; id: string; number: string; deviceName: string }

export default function InvoicePrintPrompt({ invoice, printing, onPrint, onSkip }: {
  invoice: PendingInvoicePrint
  printing: boolean
  onPrint: () => void
  onSkip: () => void
}) {
  return <Modal title="طباعة الفاتورة؟" onClose={onSkip}>
    <div className="notice">
      <Printer size={18} />
      <span>تم حفظ الفاتورة <b>{invoice.number}</b> بنجاح. هل تريد طباعة نسخة الآن؟</span>
    </div>
    <div className="modal-actions">
      <button className="primary" onClick={onPrint} disabled={printing}>
        {printing ? 'جارٍ تجهيز الطباعة…' : 'طباعة الفاتورة'}
      </button>
      <button className="secondary" onClick={onSkip} disabled={printing}>تخطي — تم الحفظ</button>
    </div>
  </Modal>
}

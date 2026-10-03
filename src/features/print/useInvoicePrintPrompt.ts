import { useState } from 'react'
import { useApp } from '../../app/AppProvider'
import { bridge, loadSnapshot } from '../../lib/api'
import { printPurchaseInvoiceOnPrinter, printSaleInvoiceOnPrinter } from './documents'
import type { PendingInvoicePrint } from './InvoicePrintPrompt'

type Printer = Awaited<ReturnType<ReturnType<typeof bridge>['getPrinters']>>[number]

function candidates(printers: Printer[]) {
  return printers.filter(printer => printer.available && !/(pdf|xps|fax|onenote|print to file|virtual printer)/i.test(`${printer.name} ${printer.displayName}`))
}

export function useInvoicePrintPrompt() {
  const { notify } = useApp()
  const [pending, setPending] = useState<PendingInvoicePrint | null>(null)
  const [printing, setPrinting] = useState(false)

  const offerPrint = async (invoice: Omit<PendingInvoicePrint, 'deviceName'>) => {
    try {
      const available = candidates(await bridge().getPrinters())
      if (!available.length) return
      const preferredName = localStorage.getItem('repack.defaultPrinter')
      const printer = available.find(candidate => candidate.name === preferredName) || available[0]
      if (printer) setPending({ ...invoice, deviceName: printer.name })
    } catch {
      notify('تم حفظ الفاتورة، لكن تعذر التحقق من الطابعة؛ لم يتم عرض سؤال الطباعة.')
    }
  }

  const skip = () => { if (!printing) setPending(null) }
  const print = async () => {
    const invoice = pending
    if (!invoice || printing) return
    setPrinting(true)
    try {
      const state = await loadSnapshot()
      let printed = false
      if (invoice.kind === 'sale') {
        const sale = state.sales.find(row => row.id === invoice.id)
        printed = sale ? await printSaleInvoiceOnPrinter(state, sale, invoice.deviceName) : false
      } else {
        const purchase = state.purchases.find(row => row.id === invoice.id)
        printed = purchase ? await printPurchaseInvoiceOnPrinter(state, purchase, invoice.deviceName) : false
      }
      if (!printed) notify(`تم حفظ الفاتورة ${invoice.number}، لكن تعذرت طباعتها؛ الفاتورة لم تتأثر.`)
    } catch {
      notify(`تم حفظ الفاتورة ${invoice.number}، لكن حدث خطأ أثناء الطباعة؛ الفاتورة لم تتأثر.`)
    } finally {
      setPrinting(false)
      setPending(null)
    }
  }

  return { pending, printing, offerPrint, skip, print }
}

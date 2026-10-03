import { useEffect, useMemo, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useApp } from '../../app/AppProvider'
import { bridge, ipcErrorMessage } from '../../lib/api'
import { today } from '../../lib/domain'
import { printHtmlDocument } from '../print'
import ReportDocument from './ReportDocument'
import { getReportData } from './report-data'
import type { ReportData } from './report-data'
import reportCss from './styles.css?inline'
import cairoArabicFont from '../../fonts/cairo-arabic.woff2?inline'
import './styles.css'

type ReportQuery = Parameters<typeof getReportData>[0] & { earliestDate: string }

function localDate(value: string) {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function dateString(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function monthStart(value: Date) { return new Date(value.getFullYear(), value.getMonth(), 1) }

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function exportReportCsv(data: ReportData) {
  const sections: Array<[string, Array<Array<string | number>>]> = [
    ['الملخص التنفيذي', [['المؤشر', 'القيمة'], ['إجمالي المبيعات قبل المرتجعات', data.summary.grossSales.toFixed(2)], ['المرتجعات', data.summary.returns.toFixed(2)], ['صافي المبيعات', data.summary.netSales.toFixed(2)], ['تكلفة المبيعات', data.summary.cogs.toFixed(2)], ['إجمالي الربح', data.summary.profit.toFixed(2)], ['هامش الربح %', data.summary.margin.toFixed(2)], ['المشتريات خلال الفترة', data.summary.purchases.toFixed(2)], ['التحصيلات خلال الفترة', data.summary.collections.toFixed(2)], ['أرصدة العملاء الحالية', data.summary.receivables.toFixed(2)], ['الذمم المتأخرة الحالية', data.summary.overdue.toFixed(2)], ['قيمة المخزون الحالية', data.summary.inventory.toFixed(2)]]],
    ['ربحية المنتجات', [['الصنف', 'SKU', 'الكمية الصافية', 'الوحدة', 'صافي المبيعات', 'التكلفة', 'الربح', 'الهامش %'], ...data.products.map(row => [row.name, row.sku, row.quantity, row.unit, row.revenue.toFixed(2), row.cost.toFixed(2), row.profit.toFixed(2), row.margin.toFixed(2)])]],
    ['المبيعات حسب اليوم', [['التاريخ', 'المبيعات', 'المرتجعات', 'الصافي', 'عدد الفواتير'], ...data.daily.map(row => [row.date, row.sales.toFixed(2), row.returns.toFixed(2), row.net.toFixed(2), row.invoices])]],
    ['المشتريات حسب المورد', [['المورد', 'عدد الفواتير', 'الإجمالي', 'المدفوع', 'المتبقي'], ...data.purchases.map(row => [row.supplier_name, row.invoice_count, row.total.toFixed(2), row.paid.toFixed(2), row.remaining.toFixed(2)])]],
    ['وضع المخزون الحالي', [['الصنف', 'SKU', 'الرصيد', 'الوحدة', 'متوسط تكلفة الوحدة', 'القيمة', 'الحالة'], ...data.inventory.map(row => [row.name, row.sku, row.quantity, row.unit, row.unitCost.toFixed(2), row.value.toFixed(2), row.status])]],
    ['أرصدة العملاء الحالية', [['العميل', 'الرصيد', 'المتأخر', 'آخر دفعة'], ...data.customers.map(row => [row.name, row.balance.toFixed(2), row.overdue.toFixed(2), row.last_payment_date || ''])]],
    ['أوامر التعبئة', [['رقم الأمر', 'التاريخ', 'المنتج', 'الوحدات المنتجة', 'الفاقد حسب الخامة'], ...data.packings.map(row => [row.number, row.date, row.item_name, row.produced_units, row.wasteDetails])]],
    ['التحصيلات حسب العميل', [['العميل', 'عدد الدفعات', 'قيمة التحصيل'], ...data.collections.map(row => [row.customer_name, row.payment_count, row.amount.toFixed(2)])]]
  ]
  const content = sections.flatMap(([title, rows]) => [[csvCell(title)], ...rows.map(row => row.map(csvCell))]).map(row => row.join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `تقرير_${data.from}_إلى_${data.to}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

function Reports() {
  const { state, currentUser, notify } = useApp()
  const currentDate = today()
  const initialFrom = dateString(monthStart(localDate(currentDate)))
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(currentDate)
  const [loaded, setLoaded] = useState<ReportQuery | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const validationError = !from || !to ? 'يرجى اختيار تاريخ البداية والنهاية.' : from > to ? 'تاريخ البداية يجب ألا يأتي بعد تاريخ النهاية.' : to > currentDate ? 'لا يمكن اختيار تاريخ مستقبلي.' : from > currentDate ? 'لا يمكن اختيار تاريخ مستقبلي.' : ''

  useEffect(() => {
    if (!state || !currentUser || validationError) { setLoaded(null); setLoading(false); return }
    let active = true
    setLoading(true)
    setError('')
    bridge().query<ReportQuery>('reports:period', { from, to }).then(result => {
      if (active) setLoaded(result)
    }).catch(reason => {
      if (active) { setLoaded(null); setError(ipcErrorMessage(reason) || 'تعذر تحميل بيانات التقرير.') }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [from, to, state, currentUser, validationError])

  const data = useMemo(() => state && loaded ? getReportData(loaded, state) : null, [loaded, state])
  const applyRange = (start: Date, end = localDate(currentDate)) => {
    setFrom(dateString(start))
    setTo(dateString(end))
  }
  const shortcuts = [
    { label: 'اليوم', run: () => applyRange(localDate(currentDate)) },
    { label: 'هذا الأسبوع', run: () => { const start = localDate(currentDate); start.setDate(start.getDate() - ((start.getDay() + 1) % 7)); applyRange(start) } },
    { label: 'هذا الشهر', run: () => applyRange(monthStart(localDate(currentDate))) },
    { label: 'الشهر الماضي', run: () => { const end = new Date(localDate(currentDate).getFullYear(), localDate(currentDate).getMonth(), 0); applyRange(monthStart(end), end) } },
    { label: 'هذه السنة', run: () => applyRange(new Date(localDate(currentDate).getFullYear(), 0, 1)) },
    { label: 'منذ بداية النظام', run: () => { const start = loaded?.earliestDate || dateString(monthStart(localDate(currentDate))); applyRange(localDate(start)) } }
  ]

  const makePrintHtml = (report: ReportData) => {
    const documentHtml = renderToStaticMarkup(<ReportDocument data={report} preparedBy={currentUser?.displayName || 'مدير النظام'} />)
    const fontCss = `@font-face{font-family:Cairo;src:url('${cairoArabicFont}') format('woff2');font-style:normal;font-weight:100 900;font-display:block}`
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تقرير ${report.from} إلى ${report.to}</title><style>${fontCss}\n${reportCss}</style></head><body>${documentHtml}</body></html>`
  }

  const printReport = async (destination: 'printer' | 'pdf') => {
    if (!data) return
    try {
      const ok = await printHtmlDocument(makePrintHtml(data), { destination, suggestedName: `تقرير_${data.from}_إلى_${data.to}.pdf`, footerText: `RPT-${data.today.replace(/-/g, '')} · ${data.from} إلى ${data.to}` })
      if (!ok) notify(destination === 'pdf' ? 'تعذر حفظ التقرير بصيغة PDF؛ تحقق من صلاحية المجلد وحاول مرة أخرى.' : 'تعذرت الطباعة أو أُلغيت؛ تحقق من الطابعة وإعداداتها.')
    } catch {
      notify(destination === 'pdf' ? 'حدث خطأ أثناء حفظ ملف PDF.' : 'حدث خطأ أثناء تجهيز التقرير للطباعة.')
    }
  }

  const exportCsv = () => { if (data) exportReportCsv(data) }
  if (!state || !currentUser) return null
  return <section className="reports-page">
    <div className="section-header no-print"><div><h2>التقارير والتحليلات</h2><p>اختر الفترة وراجع التقرير قبل الطباعة أو التصدير</p></div></div>
    <div className="report-toolbar no-print">
      <div>
        <div className="report-range">
          <label>من<input aria-label="من تاريخ" type="date" value={from} max={currentDate} onChange={event => setFrom(event.target.value)} /></label>
          <label>إلى<input aria-label="إلى تاريخ" type="date" value={to} max={currentDate} onChange={event => setTo(event.target.value)} /></label>
        </div>
        {validationError && <p className="report-error" role="alert">{validationError}</p>}
        {error && <p className="report-error" role="alert">{error}</p>}
      </div>
      <div className="report-shortcuts" aria-label="اختصارات الفترة">{shortcuts.map(button => <button className="secondary" key={button.label} type="button" onClick={button.run}>{button.label}</button>)}</div>
      <div className="report-actions">
        <button className="secondary" disabled={!data || loading} onClick={exportCsv}>تصدير CSV</button>
        <button className="secondary" disabled={!data || loading} onClick={() => void printReport('pdf')}>حفظ PDF</button>
        <button className="primary" disabled={!data || loading} onClick={() => void printReport('printer')}>طباعة التقرير</button>
      </div>
    </div>
    {loading && <div className="report-loading" role="status">جارٍ تحميل بيانات التقرير…</div>}
    {!loading && data && <div className="report-preview-scroll"><ReportDocument data={data} preparedBy={currentUser.displayName || 'مدير النظام'} /></div>}
  </section>
}

export default Reports

import type { ReactNode } from 'react'
import type { ReportData } from './report-data'
import BrandMark from '../../components/BrandMark'

const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const count = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const money = (value: number) => number.format(value) + ' ج.م'
const qty = (value: number, unit: string) => count.format(value) + (unit ? ` ${unit}` : '')

function Table({ headers, children, empty, totals }: { headers: string[]; children: ReactNode; empty: boolean; totals?: ReactNode }) {
  return <table className="report-table"><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
    <tbody>{empty ? <tr><td className="report-empty" colSpan={headers.length}>لا توجد بيانات خلال الفترة المحددة</td></tr> : children}{totals && !empty ? <tr className="report-total">{totals}</tr> : null}</tbody></table>
}

export default function ReportDocument({ data, preparedBy }: { data: ReportData; preparedBy: string }) {
  const { summary, from, to, today, companyName, products, daily, purchases, inventory, customers, operational, packings, collections } = data
  const dateLabel = (value: string | null) => value || '—'
  return <article className="report-sheet" dir="rtl" lang="ar">
    <header className="report-header">
      <div className="report-brand"><BrandMark size={44} /><div><h1>{companyName}</h1><p>نظام إدارة التجزئة والتعبئة</p></div></div>
      <div className="report-title"><strong>تقرير الأداء التشغيلي والمالي</strong><span>رقم التقرير: RPT-{today.replace(/-/g, '')}</span></div>
    </header>
    <dl className="report-meta">
      <div><dt>تاريخ الإصدار</dt><dd>{today}</dd></div>
      <div><dt>الفترة</dt><dd>من {from} إلى {to}</dd></div>
      <div><dt>العملة</dt><dd>الجنيه المصري (EGP)</dd></div>
    </dl>
    <div className="report-rule" />

    <section className="report-section">
      <h2>1. الملخص التنفيذي</h2>
      <Table headers={['البند', 'القيمة']} empty={false}>
        {[
          ['إجمالي المبيعات قبل المرتجعات', money(summary.grossSales)], ['المرتجعات', money(summary.returns)], ['صافي المبيعات', money(summary.netSales)],
          ['تكلفة المبيعات', money(summary.cogs)], ['إجمالي الربح', money(summary.profit)], ['هامش الربح', `${number.format(summary.margin)}%`],
          ['المشتريات خلال الفترة', money(summary.purchases)], ['التحصيلات خلال الفترة', money(summary.collections)],
          ['أرصدة العملاء الحالية', money(summary.receivables)], ['الذمم المتأخرة الحالية', money(summary.overdue)], ['قيمة المخزون الحالية', money(summary.inventory)]
        ].map(([label, value]) => <tr key={label}><td>{label}</td><td className="report-number">{value}</td></tr>)}
      </Table>
    </section>

    <section className="report-section">
      <h2>2. ربحية المنتجات</h2>
      <Table headers={['المنتج / SKU', 'الكمية الصافية', 'صافي المبيعات', 'التكلفة', 'الربح', 'الهامش']} empty={!products.length}
        totals={<><td>الإجمالي</td><td>—</td><td>{money(products.reduce((sum, row) => sum + row.revenue, 0))}</td><td>{money(products.reduce((sum, row) => sum + row.cost, 0))}</td><td>{money(products.reduce((sum, row) => sum + row.profit, 0))}</td><td>—</td></>}>
        {products.map(row => <tr key={row.id}><td>{row.name}<small>{row.sku}</small></td><td>{qty(row.quantity, row.unit)}</td><td className="report-number">{money(row.revenue)}</td><td className="report-number">{money(row.cost)}</td><td className="report-number">{money(row.profit)}</td><td>{number.format(row.margin)}%</td></tr>)}
      </Table>
    </section>

    <section className="report-section">
      <h2>3. المبيعات حسب اليوم</h2>
      <Table headers={['التاريخ', 'إجمالي المبيعات', 'المرتجعات', 'الصافي', 'عدد الفواتير']} empty={!daily.length}
        totals={<><td>الإجمالي</td><td>{money(daily.reduce((sum, row) => sum + row.sales, 0))}</td><td>{money(daily.reduce((sum, row) => sum + row.returns, 0))}</td><td>{money(daily.reduce((sum, row) => sum + row.net, 0))}</td><td>{count.format(daily.reduce((sum, row) => sum + row.invoices, 0))}</td></>}>
        {daily.map(row => <tr key={row.date}><td>{row.date}</td><td className="report-number">{money(row.sales)}</td><td className="report-number">{money(row.returns)}</td><td className="report-number">{money(row.net)}</td><td>{count.format(row.invoices)}</td></tr>)}
      </Table>
    </section>

    <section className="report-section">
      <h2>4. المشتريات خلال الفترة</h2>
      <Table headers={['المورد', 'عدد الفواتير', 'الإجمالي', 'المدفوع', 'المتبقي']} empty={!purchases.length}
        totals={<><td>الإجمالي</td><td>{count.format(purchases.reduce((sum, row) => sum + row.invoice_count, 0))}</td><td>{money(purchases.reduce((sum, row) => sum + row.total, 0))}</td><td>{money(purchases.reduce((sum, row) => sum + row.paid, 0))}</td><td>{money(purchases.reduce((sum, row) => sum + row.remaining, 0))}</td></>}>
        {purchases.map(row => <tr key={row.supplier_id}><td>{row.supplier_name}</td><td>{count.format(row.invoice_count)}</td><td className="report-number">{money(row.total)}</td><td className="report-number">{money(row.paid)}</td><td className="report-number">{money(row.remaining)}</td></tr>)}
      </Table>
    </section>

    <section className="report-section">
      <h2>5. وضع المخزون</h2>
      <Table headers={['الصنف / SKU', 'الرصيد', 'متوسط تكلفة الوحدة', 'القيمة', 'الحالة']} empty={!inventory.length}
        totals={<><td>الإجمالي</td><td>—</td><td>—</td><td>{money(inventory.reduce((sum, row) => sum + row.value, 0))}</td><td>—</td></>}>
        {inventory.map(row => <tr key={row.id}><td>{row.name}<small>{row.sku}</small></td><td>{qty(row.quantity, row.unit)}</td><td className="report-number">{money(row.unitCost)}</td><td className="report-number">{money(row.value)}</td><td>{row.status}</td></tr>)}
      </Table>
      <p className="report-note">الأرصدة وقيمة المخزون رصيد حالي كما في {today}، وليست لقطة تاريخية في نهاية الفترة.</p>
    </section>

    <section className="report-section">
      <h2>6. أرصدة العملاء والذمم</h2>
      <Table headers={['العميل', 'الرصيد الحالي', 'المتأخر الحالي', 'آخر دفعة']} empty={!customers.length}
        totals={<><td>الإجمالي</td><td>{money(customers.reduce((sum, row) => sum + row.balance, 0))}</td><td>{money(customers.reduce((sum, row) => sum + row.overdue, 0))}</td><td>—</td></>}>
        {customers.map(row => <tr key={row.id}><td>{row.name}</td><td className="report-number">{money(row.balance)}</td><td className="report-number">{money(row.overdue)}</td><td>{dateLabel(row.last_payment_date)}</td></tr>)}
      </Table>
      <p className="report-note">أرصدة العملاء والذمم أرصدة حالية كما في {today}، وليست لقطة تاريخية في نهاية الفترة.</p>
    </section>

    <section className="report-section">
      <h2>7. المؤشرات التشغيلية والتحصيلات</h2>
      <Table headers={['المؤشر', 'القيمة']} empty={false}>
        {[
          ['أوامر التعبئة المعتمدة', count.format(operational.packingCount)], ['الوحدات المنتجة', count.format(operational.producedUnits)],
          ['الفاقد حسب الوحدة', operational.wasteByUnit.length ? operational.wasteByUnit.map(([unit, value]) => qty(value, unit)).join(' + ') : qty(0, '')],
          ['مرتجعات المبيعات', money(summary.returns)]
        ].map(([label, value]) => <tr key={label}><td>{label}</td><td>{value}</td></tr>)}
      </Table>
      <p className="report-note">عدد أوامر التعبئة وقيم التدفقات تخص الفترة من {from} إلى {to}.</p>
    </section>

    <section className="report-section">
      <h2>8. أوامر التعبئة المعتمدة</h2>
      <Table headers={['رقم الأمر', 'التاريخ', 'المنتج', 'الوحدات المنتجة', 'الفاقد حسب الخامة']} empty={!packings.length}>
        {packings.map(row => <tr key={row.id}><td>{row.number}</td><td>{row.date}</td><td>{row.item_name}</td><td>{qty(row.produced_units, row.producedUnit)}</td><td>{row.wasteDetails}</td></tr>)}
      </Table>
    </section>

    <section className="report-section">
      <h2>9. التحصيلات خلال الفترة</h2>
      <Table headers={['العميل', 'عدد الدفعات', 'إجمالي التحصيل']} empty={!collections.length}
        totals={<><td>الإجمالي</td><td>{count.format(collections.reduce((sum, row) => sum + row.payment_count, 0))}</td><td>{money(collections.reduce((sum, row) => sum + row.amount, 0))}</td></>}>
        {collections.map(row => <tr key={row.customer_id}><td>{row.customer_name}</td><td>{count.format(row.payment_count)}</td><td className="report-number">{money(row.amount)}</td></tr>)}
      </Table>
    </section>

    <footer className="report-footer">
      <div><span>أُعد التقرير بواسطة</span><strong>{preparedBy || 'مدير النظام'}</strong></div>
      <div><span>اعتماد الإدارة</span><strong>________________________</strong></div>
      <div><span>المسؤول المالي</span><strong>________________________</strong></div>
    </footer>
    <p className="report-disclaimer">مستخرج من سجلات النظام المحلية بتاريخ {today} · للاستخدام الداخلي</p>
  </article>
}

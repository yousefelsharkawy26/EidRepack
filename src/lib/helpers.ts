import { AppState, money, quantity, Sale, today, UserRole } from "./domain"
import { nav, Screen } from "./types"

const roleScreens: Record<UserRole, Screen[]> = {
  owner: nav.map(item => item.key),
  sales: ['dashboard', 'sales', 'customers', 'collections', 'reminders'],
  warehouse: ['dashboard', 'packing', 'inventory'],
  purchasing: ['dashboard', 'purchases', 'suppliers']
}

const statusClass = (status: string) => status === 'paid' || status === 'confirmed' || status === 'sent' ? 'green' : status === 'overdue' ? 'red' : 'yellow'
const statusLabel = (status: string) => ({ draft: 'مسودة', confirmed: 'غير مدفوعة', partial: 'مدفوعة جزئيًا', paid: 'مدفوعة', overdue: 'متأخرة', pending: 'بانتظار الإرسال', sent: 'تم الإرسال', skipped: 'تم التخطي', cancelled: 'أُلغي' }[status] || status)
const roleLabel = (role: UserRole) => ({ owner: 'المالك / مدير النظام', sales: 'موظف مبيعات', warehouse: 'موظف مخزن وتعبئة', purchasing: 'موظف مشتريات' }[role])

const canAccess = (role: UserRole, screen: Screen) => roleScreens[role].includes(screen)

const escapeHtml = (value: string | number) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] || character))

// Prints through the main process in the packaged app (window.open is denied
// there), and falls back to a popup window when running in a plain browser.
async function printHtmlDocument(html: string): Promise<boolean> {
  if (window.repack?.printHtml) {
    try { return await window.repack.printHtml(html) } catch { return false }
  }
  const popup = window.open('', '_blank', 'width=980,height=720')
  if (!popup) return false
  popup.document.write(html)
  popup.document.close()
  popup.setTimeout(() => { popup.focus(); popup.print() }, 250)
  return true
}

async function printSaleInvoice(state: AppState, sale: Sale) {
  const customer = state.customers.find(candidate => candidate.id === sale.customerId)
  const rows = sale.lines.map(line => {
    const item = state.items.find(candidate => candidate.id === line.itemId)
    return `<tr><td>${escapeHtml(item?.name || line.itemId)}</td><td>${escapeHtml(quantity(line.qty, item?.baseUnit || ''))}</td><td>${escapeHtml(money(line.price))}</td><td>${escapeHtml(money(line.qty * line.price))}</td></tr>`
  }).join('')
  return printHtmlDocument(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${escapeHtml(sale.number)}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{color:#17342a;font-family:Tahoma,Arial,sans-serif;font-size:13px;margin:0}.head{align-items:flex-start;border-bottom:3px solid #12382f;display:flex;justify-content:space-between;padding-bottom:17px}.brand{display:flex;gap:10px;align-items:center}.mark{background:#12382f;border-radius:9px;color:white;font-size:24px;font-weight:700;padding:9px 14px}.brand h1{font-size:19px;margin:0 0 4px}.brand p,.meta{color:#5e7168;font-size:11px;margin:0}.meta{text-align:left;line-height:1.9}.customer{background:#f3f8f5;border:1px solid #d9e8df;border-radius:8px;display:flex;gap:36px;margin:20px 0;padding:14px}.customer div{min-width:160px}.customer span{color:#667a70;display:block;font-size:10px;margin-bottom:4px}table{border-collapse:collapse;width:100%}th{background:#edf5f0;color:#315749;font-size:11px;padding:10px;text-align:right}td{border-bottom:1px solid #e4ece7;padding:11px 10px}.totals{margin-right:auto;margin-top:22px;width:285px}.total{display:flex;justify-content:space-between;padding:7px 0}.final{border-top:2px solid #12382f;font-size:16px;font-weight:700;margin-top:5px;padding-top:11px}.footer{border-top:1px solid #dce6e1;color:#65776e;display:flex;font-size:10px;justify-content:space-between;margin-top:55px;padding-top:14px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header class="head"><div class="brand"><div class="mark">م</div><div><h1>${escapeHtml(state.settings.companyName)}</h1><p>فاتورة بيع / تسليم</p></div></div><div class="meta"><b>فاتورة رقم: ${escapeHtml(sale.number)}</b><br>تاريخ الفاتورة: ${escapeHtml(sale.date)}<br>الحالة: ${escapeHtml(statusLabel(sale.status))}</div></header><section class="customer"><div><span>اسم العميل</span><b>${escapeHtml(customer?.name || 'عميل نقدي')}</b></div><div><span>الهاتف</span><b>${escapeHtml(customer?.phone || '—')}</b></div><div><span>تاريخ الاستحقاق</span><b>${escapeHtml(sale.dueDate || '—')}</b></div></section><table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table><section class="totals"><div class="total"><span>إجمالي الفاتورة</span><b>${escapeHtml(money(sale.total))}</b></div><div class="total"><span>المسدد</span><b>${escapeHtml(money(sale.paid))}</b></div><div class="total final"><span>المتبقي</span><b>${escapeHtml(money(sale.total - sale.paid))}</b></div></section><footer class="footer"><span>هذا المستند مُنشأ من نظام مدير التعبئة</span><span>توقيع المستلم: __________________</span></footer></body></html>`)
}

export function customerStatementEntries(state: AppState, customerId: string) {
  const returnedBySale = state.salesReturns.filter(item => item.customerId === customerId).reduce<Record<string, number>>((totals, item) => ({ ...totals, [item.saleId]: (totals[item.saleId] || 0) + item.value }), {})
  const entries = [
    ...state.customerOpenings.filter(entry => entry.partyId === customerId && entry.amount !== 0).map(entry => ({ date: entry.date, order: -1, type: entry.amount > 0 ? 'رصيد افتتاحي' : 'تسوية رصيد', reference: 'OPENING', detail: entry.notes || '', debit: Math.max(0, entry.amount), credit: Math.max(0, -entry.amount) })),
    ...state.sales.filter(sale => sale.customerId === customerId && sale.status !== 'cancelled').map(sale => ({ date: sale.date, order: 0, type: 'فاتورة بيع', reference: sale.number, detail: 'إثبات قيمة الفاتورة', debit: sale.total + (returnedBySale[sale.id] || 0), credit: 0 })),
    ...state.customerPayments.filter(payment => payment.customerId === customerId).map(payment => ({ date: payment.date, order: 1, type: 'تحصيل', reference: state.sales.find(sale => sale.id === payment.saleId)?.number || '—', detail: payment.note, debit: 0, credit: payment.amount })),
    ...state.refunds.filter(refund => refund.customerId === customerId).map(refund => ({ date: refund.date, order: 1, type: 'رد مبلغ للعميل', reference: state.sales.find(sale => sale.id === refund.saleId)?.number || '—', detail: refund.notes || '', debit: refund.amount, credit: 0 })),
    ...state.salesReturns.filter(item => item.customerId === customerId).map(item => ({ date: item.date, order: 2, type: 'مرتجع مبيعات', reference: item.number, detail: item.reason, debit: 0, credit: item.value }))
  ].sort((first, second) => first.date.localeCompare(second.date) || first.order - second.order)
  let balance = 0
  return entries.map(entry => ({ ...entry, balance: (balance += entry.debit - entry.credit) }))
}

async function printCustomerStatement(state: AppState, customerId: string) {
  const customer = state.customers.find(item => item.id === customerId)
  if (!customer) return false
  const entries = customerStatementEntries(state, customerId)
  const rows = entries.map(entry => `<tr><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.type)}</td><td>${escapeHtml(entry.reference)}</td><td>${escapeHtml(entry.detail)}</td><td>${entry.debit ? escapeHtml(money(entry.debit)) : '—'}</td><td>${entry.credit ? escapeHtml(money(entry.credit)) : '—'}</td><td>${escapeHtml(money(entry.balance))}</td></tr>`).join('')
  return printHtmlDocument(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف حساب ${escapeHtml(customer.name)}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{color:#17342a;font-family:Tahoma,Arial,sans-serif;font-size:12px;margin:0}.head{align-items:flex-start;border-bottom:3px solid #12382f;display:flex;justify-content:space-between;padding-bottom:17px}.brand{display:flex;gap:10px;align-items:center}.mark{background:#12382f;border-radius:9px;color:white;font-size:24px;font-weight:700;padding:9px 14px}.brand h1{font-size:19px;margin:0 0 4px}.brand p,.meta{color:#5e7168;font-size:11px;margin:0}.meta{text-align:left;line-height:1.9}.info{background:#f3f8f5;border:1px solid #d9e8df;border-radius:8px;display:flex;gap:45px;margin:20px 0;padding:14px}.info span{color:#667a70;display:block;font-size:10px;margin-bottom:4px}table{border-collapse:collapse;width:100%}th{background:#edf5f0;color:#315749;font-size:10px;padding:9px;text-align:right}td{border-bottom:1px solid #e4ece7;padding:9px}.summary{background:#12382f;border-radius:8px;color:white;display:flex;justify-content:space-between;margin-top:22px;padding:14px}.summary span{color:#d9eadf;font-size:11px}.footer{border-top:1px solid #dce6e1;color:#65776e;display:flex;font-size:10px;justify-content:space-between;margin-top:45px;padding-top:14px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header class="head"><div class="brand"><div class="mark">م</div><div><h1>${escapeHtml(state.settings.companyName)}</h1><p>كشف حساب عميل</p></div></div><div class="meta"><b>رقم المرجع: CST-${escapeHtml(today().replace(/-/g, ''))}</b><br>تاريخ الإصدار: ${escapeHtml(today())}</div></header><section class="info"><div><span>العميل</span><b>${escapeHtml(customer.name)}</b></div><div><span>الهاتف</span><b>${escapeHtml(customer.phone || '—')}</b></div><div><span>حد الائتمان</span><b>${escapeHtml(money(customer.creditLimit))}</b></div></section><table><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${rows || '<tr><td colspan="7">لا توجد حركات مالية.</td></tr>'}</tbody></table><section class="summary"><div><span>إجمالي الفواتير</span><b>${escapeHtml(money(entries.reduce((sum, entry) => sum + entry.debit, 0)))}</b></div><div><span>إجمالي المسدد والمرتجع</span><b>${escapeHtml(money(entries.reduce((sum, entry) => sum + entry.credit, 0)))}</b></div><div><span>الرصيد المستحق</span><b>${escapeHtml(money(customer.balance))}</b></div></section><footer class="footer"><span>كشف حساب صادر من نظام مدير التعبئة</span><span>اعتماد الحسابات: __________________</span></footer></body></html>`)
}

function exportCustomerStatement(state: AppState, customerId: string) {
  const customer = state.customers.find(item => item.id === customerId)
  if (!customer) return
  const rows = customerStatementEntries(state, customerId).map(entry => [entry.date, entry.type, entry.reference, entry.detail, entry.debit, entry.credit, entry.balance].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
  const blob = new Blob(["\ufeffالتاريخ,نوع الحركة,المرجع,البيان,مدين,دائن,الرصيد\n" + rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = 'customer-statement-' + customer.name.replace(/\s+/g, '-') + '-' + today() + '.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

async function printSupplierStatement(state: AppState, supplierId: string) {
  const supplier = state.suppliers.find(item => item.id === supplierId)
  if (!supplier) return false
  const entries: { date: string; order: number; type: string; reference: string; detail: string; debit: number; credit: number }[] = state.purchases.filter(purchase => purchase.supplierId === supplierId).flatMap(purchase => [
    { date: purchase.date, order: 0, type: 'فاتورة شراء', reference: purchase.number, detail: 'قيمة التوريد شاملاً المصاريف', debit: purchase.total, credit: 0 },
    ...(purchase.paid > 0 ? [{ date: purchase.date, order: 1, type: 'دفعة للمورد', reference: purchase.number, detail: 'مدفوع عند اعتماد الفاتورة', debit: 0, credit: purchase.paid }] : [])
  ])
  entries.push(...state.supplierPayments.filter(payment => payment.supplierId === supplierId).map(payment => ({ date: payment.date, order: 2, type: 'سداد مورد', reference: payment.reference || '—', detail: payment.note || payment.method, debit: 0, credit: payment.amount })))
  entries.push(...state.purchaseReturns.filter(item => item.supplierId === supplierId).map(item => ({ date: item.date, order: 3, type: 'مرتجع مشتريات', reference: item.number, detail: item.reason, debit: 0, credit: item.value })))
  entries.push(...state.supplierOpenings.filter(entry => entry.partyId === supplierId && entry.amount !== 0).map(entry => ({ date: entry.date, order: -1, type: 'رصيد افتتاحي', reference: 'OPENING', detail: entry.notes || 'رصيد مرحّل قبل إنشاء سجل الدفعات', debit: Math.max(0, entry.amount), credit: Math.max(0, -entry.amount) })))
  entries.sort((first, second) => first.date.localeCompare(second.date) || first.order - second.order)
  let balance = 0
  const rows = entries.map(entry => { balance += entry.debit - entry.credit; return `<tr><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.type)}</td><td>${escapeHtml(entry.reference)}</td><td>${escapeHtml(entry.detail)}</td><td>${entry.debit ? escapeHtml(money(entry.debit)) : '—'}</td><td>${entry.credit ? escapeHtml(money(entry.credit)) : '—'}</td><td>${escapeHtml(money(balance))}</td></tr>` }).join('')
  return printHtmlDocument(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>كشف حساب ${escapeHtml(supplier.name)}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{color:#17342a;font-family:Tahoma,Arial,sans-serif;font-size:12px;margin:0}.head{align-items:flex-start;border-bottom:3px solid #12382f;display:flex;justify-content:space-between;padding-bottom:17px}.brand{display:flex;gap:10px;align-items:center}.mark{background:#12382f;border-radius:9px;color:white;font-size:24px;font-weight:700;padding:9px 14px}.brand h1{font-size:19px;margin:0 0 4px}.brand p,.meta{color:#5e7168;font-size:11px;margin:0}.meta{text-align:left;line-height:1.9}.info{background:#f3f8f5;border:1px solid #d9e8df;border-radius:8px;display:flex;gap:45px;margin:20px 0;padding:14px}.info span{color:#667a70;display:block;font-size:10px;margin-bottom:4px}table{border-collapse:collapse;width:100%}th{background:#edf5f0;color:#315749;font-size:10px;padding:9px;text-align:right}td{border-bottom:1px solid #e4ece7;padding:9px}.summary{background:#12382f;border-radius:8px;color:white;display:flex;justify-content:space-between;margin-top:22px;padding:14px}.summary span{color:#d9eadf;font-size:11px}.footer{border-top:1px solid #dce6e1;color:#65776e;display:flex;font-size:10px;justify-content:space-between;margin-top:45px;padding-top:14px}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header class="head"><div class="brand"><div class="mark">م</div><div><h1>${escapeHtml(state.settings.companyName)}</h1><p>كشف حساب مورد</p></div></div><div class="meta"><b>رقم المرجع: SUP-${escapeHtml(today().replace(/-/g, ''))}</b><br>تاريخ الإصدار: ${escapeHtml(today())}</div></header><section class="info"><div><span>المورد</span><b>${escapeHtml(supplier.name)}</b></div><div><span>الهاتف</span><b>${escapeHtml(supplier.phone || '—')}</b></div></section><table><thead><tr><th>التاريخ</th><th>نوع الحركة</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد المستحق</th></tr></thead><tbody>${rows || '<tr><td colspan="7">لا توجد حركات مالية.</td></tr>'}</tbody></table><section class="summary"><div><span>إجمالي التوريدات</span><b>${escapeHtml(money(entries.reduce((sum, entry) => sum + entry.debit, 0)))}</b></div><div><span>إجمالي المدفوع</span><b>${escapeHtml(money(entries.reduce((sum, entry) => sum + entry.credit, 0)))}</b></div><div><span>الرصيد المستحق للمورد</span><b>${escapeHtml(money(supplier.balance))}</b></div></section><footer class="footer"><span>كشف حساب صادر من نظام مدير التعبئة</span><span>اعتماد الحسابات: __________________</span></footer></body></html>`)
}

export { roleScreens, printCustomerStatement, exportCustomerStatement, printSaleInvoice, printSupplierStatement, canAccess, statusClass, statusLabel, roleLabel }
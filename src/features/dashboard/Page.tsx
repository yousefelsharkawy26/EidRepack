import { AlertTriangle, ArrowUpRight, CreditCard, PackageCheck, PackagePlus, Plus, WalletCards } from "lucide-react";
import Activity from "../../shared/ui/Activity";
import Metric from "../../shared/ui/Metric";
import { daysFromNow, money, quantity, saleStatus, today } from "../../lib/domain";
import { useApp } from "../../app/AppProvider";

function Dashboard() {
  const { state, currentUser, setScreen: onNavigate } = useApp();
  if (!state || !currentUser) return null;
  const canSeeProfit = currentUser.role === "owner";
  const activeSales = state.sales.filter(sale => sale.status !== 'cancelled')
  const overdue = activeSales.filter(s => saleStatus(s) === 'overdue').reduce((sum, sale) => sum + sale.total - sale.paid, 0)
  const overdueCount = activeSales.filter(sale => saleStatus(sale) === 'overdue').length
  const monthKey = today().slice(0, 7)
  const monthSalesList = activeSales.filter(sale => sale.date.slice(0, 7) === monthKey)
  const monthSales = monthSalesList.reduce((sum, sale) => sum + sale.total, 0)
  // Profit and margin are month-scoped as well, matching the "this month"
  // revenue figure instead of silently accumulating all historical periods.
  const grossProfit = monthSalesList.reduce((sum, sale) => sum + sale.lines.reduce((lineSum, line) => lineSum + (line.price - line.cost) * line.qty, 0), 0)
  const margin = monthSales > 0 ? (grossProfit / monthSales) * 100 : 0
  const treasury = state.customerPayments.reduce((sum, payment) => sum + payment.amount, 0)
    - state.refunds.reduce((sum, refund) => sum + refund.amount, 0)
    - state.purchases.reduce((sum, purchase) => sum + purchase.paid, 0)
    - state.supplierPayments.reduce((sum, payment) => sum + payment.amount, 0)
  const lowStock = state.items.filter(i => i.active !== false && i.stock <= i.minStock)
  const dueReminders = state.reminders.filter(reminder => reminder.status === 'pending' && reminder.scheduledFor <= today())
  const daySales = Array.from({ length: 7 }, (_, index) => {
    const date = daysFromNow(index - 6)
    return { date, total: activeSales.filter(sale => sale.date === date).reduce((sum, sale) => sum + sale.total, 0) }
  })
  const maxDay = Math.max(...daySales.map(day => day.total), 1)
  const dayLabels = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
  return <>
    <div className="metrics">
      <Metric title="مبيعات هذا الشهر" value={money(monthSales)} note={'عدد الفواتير: ' + quantity(monthSalesList.length, 'فاتورة')} icon={<ArrowUpRight size={18}/>} />
      {canSeeProfit && <Metric title="ربح هذا الشهر" value={money(grossProfit)} note={'هامش إجمالي ' + margin.toFixed(1) + '٪'} icon={<WalletCards size={18}/>} tone="orange"/>}
      <Metric title="متأخرات العملاء" value={money(overdue)} note={quantity(overdueCount, 'فاتورة متأخرة')} icon={<CreditCard size={18}/>} tone="red"/>
      <Metric title="تنبيهات المخزون" value={quantity(lowStock.length, 'أصناف')} note="تحتاج إلى إعادة طلب" icon={<AlertTriangle size={18}/>} tone="orange"/>
    </div>
    <div className="dashboard-grid">
      <section className="card"><div className="card-title"><div><h3>{canSeeProfit ? 'أداء المبيعات والربحية' : 'أداء المبيعات'}</h3><span className="dashboard-chart-note">آخر ٧ أيام · بالجنيه المصري</span></div>{canSeeProfit && <button className="link" onClick={() => onNavigate('reports')}>عرض التقرير ←</button>}</div>
        {/* Dynamic bar height encodes each day's relative sales. */}
        <div className="chart-wrap">{daySales.map((day, index) => { const height = Math.round((day.total / maxDay) * 100); return <div className="bar-group" key={day.date}><div className="bar" style={{ height: Math.max(4, height) + '%' }} title={money(day.total)}/><span className="bar-label">{index === 6 ? 'اليوم' : dayLabels[new Date(day.date + 'T12:00:00').getDay()]}</span></div> })}</div>
      </section>
      <section className="card"><div className="card-title"><h3>إجراءات سريعة</h3></div>
        <div className="dashboard-quick-actions">
          <button className="primary" onClick={() => onNavigate('sales')}><Plus size={16}/> فاتورة بيع جديدة <span className="dashboard-shortcut">F2</span></button>
          <button className="secondary" onClick={() => onNavigate('purchases')}><PackagePlus size={16}/> تسجيل فاتورة شراء <span className="dashboard-shortcut">F3</span></button>
          <button className="secondary" onClick={() => onNavigate('packing')}><PackageCheck size={16}/> أمر تعبئة جديد <span className="dashboard-shortcut">F4</span></button>
        </div>
        <div className="dashboard-cash-summary"><span>صافي حركة الخزينة</span><strong>{money(treasury)}</strong></div>
      </section>
    </div>
    <div className="split">
      <section className="card"><div className="card-title"><h3>آخر النشاطات</h3></div><div className="activity">{state.activity.slice(0, 5).map(activity => <Activity key={activity.id} {...activity}/>)}</div></section>
      <section className="card"><div className="card-title"><h3>تحتاج إلى انتباهك</h3><button className="link" onClick={() => onNavigate('reminders')}>عرض الكل</button></div>
        {dueReminders.length > 0 && <div className="notice"><b>{quantity(dueReminders.length, 'تذكيرات مستحقة')}</b><span>{[...new Set(dueReminders.map(reminder => state.customers.find(customer => customer.id === reminder.customerId)?.name).filter(Boolean))].join('، ')}</span></div>}
        {lowStock.map(item => <div className="notice" key={item.id}><b>مخزون {item.name} {item.stock <= 0 ? 'نفد' : 'يقترب من الحد'}</b><span>المتبقي {quantity(item.stock, item.baseUnit)} · الحد الأدنى {quantity(item.minStock, item.baseUnit)}</span></div>)}
        {overdue > 0 && <div className="notice"><b>فواتير متأخرة تحتاج متابعة</b><span>{money(overdue)}</span></div>}
        {!dueReminders.length && !lowStock.length && overdue <= 0 && <p className="muted-empty">لا توجد تنبيهات حاليًا؛ كل شيء تحت السيطرة.</p>}
      </section>
    </div>
  </>
}

export default Dashboard

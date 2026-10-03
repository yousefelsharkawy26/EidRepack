import { useEffect, useState } from "react";
import CreditOverrideModal from "./CreditOverrideModal";
import { useSaleDraft } from "./useSaleDraft";
import { bridge, ipcErrorMessage, toBase, toMinor } from "../../lib/api";
import { creditCheck, daysFromNow, money, quantity, today } from "../../lib/domain";
import { useApp } from "../../app/AppProvider";
import { ArrowDownLeft, CheckCircle2, CreditCard, Plus, Trash2, WalletCards } from "lucide-react";
import InvoicePrintPrompt from "../print/InvoicePrintPrompt";
import { useInvoicePrintPrompt } from "../print/useInvoicePrintPrompt";

function SalesWorkspace() {
  const { state: snapshot, run, busy, notify } = useApp();
  const invoicePrint = useInvoicePrintPrompt();
  const finished = snapshot?.items.filter(item => item.type === 'finished' && item.active !== false) || []
  const draft = useSaleDraft(finished);
  const { customerId, setCustomerId, payment, setPayment, paid, setPaid, lines, setLines,
    firstFinishedLine, overrideOpen, setOverrideOpen, overridePin, setOverridePin,
    overrideReason, setOverrideReason, overrideGranted, setOverrideGranted } = draft;
  const [verifying, setVerifying] = useState(false)
  useEffect(() => {
    const pendingId = localStorage.getItem("repack.pendingSaleCopyId");
    if (!pendingId || !snapshot) return;
    localStorage.removeItem("repack.pendingSaleCopyId");
    const source = snapshot.sales.find(sale => sale.id === pendingId);
    if (!source || source.status === "cancelled" || !source.lines.length) return notify("تعذر نسخ الفاتورة المحددة.");
    setCustomerId(source.customerId);
    setLines(source.lines.map(line => ({ itemId:line.itemId, qty:line.qty, price:line.price })));
    setPayment("credit");
    setPaid(0);
    setOverrideGranted(null);
    notify(`تم نسخ ${source.number} كفاتورة جديدة غير معتمدة؛ راجعها قبل الاعتماد.`);
  }, [snapshot, setCustomerId, setLines, setPayment, setPaid, setOverrideGranted, notify]);
  if (!snapshot) return null;
  const state = snapshot;
  // Any change to the customer or the invoice invalidates a previously granted
  // credit override, so one approval can never cover another customer or amount.
  const customer = state.customers.find(c => c.id === customerId) || state.customers[0]
  if (!customer) return <p>لا يوجد عملاء بعد؛ أضف عميلًا من شاشة العملاء أولًا.</p>
  const total = lines.reduce((sum, line) => sum + line.qty * line.price, 0)
  const credit = Math.max(total - (payment === 'cash' ? total : payment === 'credit' ? 0 : paid), 0)
  const check = creditCheck(customer, credit)
  const addLine = () => setLines(current => [...current, { itemId: finished[0]?.id || '', qty: 1, price: finished[0]?.salePrice || 0 }])
  const updateLine = (index: number, field: string, value: string) => setLines(current => current.map((line, at) => {
    if (at !== index) return line
    if (field === 'itemId') { const item = finished.find(candidate => candidate.id === value); return { ...line, itemId: value, price: item?.salePrice || 0 } }
    return { ...line, [field]: Number(value) }
  }))
  const factorOf = (itemId: string) => state.items.find(item => item.id === itemId)?.unitFactor || 1
  // UX hint — backend is authoritative.
  const confirm = () => {
    if (!lines.length || lines.some(line => !Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.price) || line.price < 0)) return notify('راجع بنود الفاتورة؛ يجب أن تكون الكميات موجبة والأسعار غير سالبة.')
    if (payment === 'mixed' && (paid <= 0 || paid >= total)) return notify('قيمة الدفعة الجزئية يجب أن تكون أكبر من صفر وأقل من إجمالي الفاتورة.')
    const soldByItem = lines.reduce<Record<string, number>>((totals, line) => ({ ...totals, [line.itemId]: (totals[line.itemId] || 0) + line.qty }), {})
    const unavailable = Object.entries(soldByItem).find(([id, requested]) => {
      const item = state.items.find(candidate => candidate.id === id)
      return !item || item.active === false || item.type !== 'finished' || item.stock < requested
    })
    if (unavailable) {
      const item = state.items.find(candidate => candidate.id === unavailable[0])
      return notify(item ? `الرصيد غير كافٍ من ${item.name}: المتاح ${quantity(item.stock, item.baseUnit)} والمطلوب ${quantity(unavailable[1], item.baseUnit)}.` : 'أحد أصناف الفاتورة غير متاح.')
    }
    if (credit && customer.blocked) return notify('هذا العميل محظور من البيع الآجل؛ لا يمكن تجاوز الحظر بـ PIN المالك.')
    if (credit && !check.allowed) {
      if (!overrideGranted) { setOverrideOpen(true); return }
    }
    const paidAmount = payment === 'cash' ? total : payment === 'credit' ? 0 : paid
    void run("sale:confirm", {
      number: state.nextNumbers.INV,
      customerId: customer.id,
      date: state.today,
      dueDate: credit > 0 ? daysFromNow(customer.creditDays || state.settings.defaultCreditDays) : undefined,
      paidMinor: toMinor(paidAmount),
      method: 'cash',
      notes: undefined,
      lines: lines.map(line => ({ itemId: line.itemId, quantity: toBase(line.qty, factorOf(line.itemId)), lineTotalMinor: toMinor(line.qty * line.price) })),
      overrideReason: overrideGranted?.reason
    }, 'تم اعتماد الفاتورة وتحديث المخزون والمديونية.').then(result => {
      if (result) {
        setOverrideGranted(null); setLines(firstFinishedLine()); setPaid(0)
        void invoicePrint.offerPrint({ kind: 'sale', id: result.data.id, number: state.nextNumbers.INV })
      }
    })
  }
  const verifyOverride = async () => {
    if (!overrideReason.trim()) return notify('سجّل سبب التجاوز ليظهر في سجل التدقيق.')
    setVerifying(true)
    try {
      await bridge().elevate({ pin: overridePin, scope: 'customer-credit' })
      setOverrideGranted({ reason: overrideReason.trim() })
      setOverrideOpen(false); setOverridePin(''); setOverrideReason('')
      notify('تم التحقق من PIN المالك؛ اضغط "اعتماد الفاتورة" مرة أخرى لإتمام البيع المتجاوز.')
    } catch (error) {
      notify(ipcErrorMessage(error))
    } finally {
      setVerifying(false)
    }
  }
  return <><div className="section-header"><div><h2>مساحة عمل المبيعات</h2><p>إدخال سريع بالكيبورد · F2 لفتح فاتورة جديدة</p></div><div className="toolbar"><button className="primary" onClick={confirm} disabled={busy}><CheckCircle2 size={15}/> اعتماد الفاتورة</button></div></div>
    <div className="workspace"><section className="form-card">
      <div className="form-top"><div className="field"><label>العميل</label><select value={customer.id} onChange={e => setCustomerId(e.target.value)}>{state.customers.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div><div className="field"><label>التاريخ</label><input value={today()} readOnly/></div><div className="field"><label>رقم الفاتورة</label><input value={state.nextNumbers.INV} readOnly/></div></div>
      <div className="lines"><div className="line-grid header"><span>الصنف / الباركود</span><span>الكمية</span><span>سعر الوحدة</span><span>الإجمالي</span><span/></div>{lines.map((line, index) => <div className="line-grid" key={index}><div className="field"><select value={line.itemId} onChange={e => updateLine(index, 'itemId', e.target.value)}>{finished.map(item => <option value={item.id} key={item.id}>{item.name} · متاح {quantity(item.stock, 'عبوة')}</option>)}</select></div><div className="field"><input type="number" min="1" value={line.qty} onChange={e => updateLine(index, 'qty', e.target.value)}/></div><div className="field"><input type="number" min="0" value={line.price} onChange={e => updateLine(index, 'price', e.target.value)}/></div><div className="line-total">{money(line.qty * line.price)}</div><button className="remove" aria-label="حذف البند" onClick={() => setLines(current => current.filter((_, at) => at !== index))}><Trash2 size={15}/></button></div>)}<button className="add-line" onClick={addLine}><Plus size={14}/> إضافة بند جديد</button></div>
      <div className="totals"><div className="total-row"><span>الإجمالي قبل الخصم</span><span>{money(total)}</span></div><div className="total-row"><span>الخصم</span><span>{money(0)}</span></div><div className="total-row final"><span>إجمالي الفاتورة</span><span>{money(total)}</span></div></div>
      <div className="payment-selector"><button className={payment === 'cash' ? 'primary' : 'secondary'} onClick={() => setPayment('cash')}><WalletCards size={15}/> نقدي كامل</button><button className={payment === 'credit' ? 'primary' : 'secondary'} onClick={() => setPayment('credit')}><CreditCard size={15}/> آجل كامل</button><button className={payment === 'mixed' ? 'primary' : 'secondary'} onClick={() => setPayment('mixed')}><ArrowDownLeft size={15}/> دفع جزئي</button>{payment === 'mixed' && <input className="payment-amount" type="number" placeholder="المدفوع" value={paid} onChange={e => setPaid(Number(e.target.value))}/>}</div>
    </section>
    <aside className="customer-panel"><h3>{customer.name}</h3><p>{customer.phone || 'عميل بيع نقدي'} · فترة السداد {customer.creditDays} يوم</p><span className="credit-usage-label">استخدام حد الائتمان</span>
      {/* Dynamic width visualizes credit utilization. */}
      <div className="credit-bar"><i title="نسبة استخدام حد الائتمان" style={{ width: Math.min((check.projected / Math.max(customer.creditLimit, 1)) * 100, 100) + '%' }}/></div><div className="credit-meta"><span>المستخدم {money(check.projected)}</span><span>الحد {money(customer.creditLimit)}</span></div>
      <div className="mini-stat"><span>المتاح بعد الفاتورة</span><strong className={check.allowed || !credit ? "positive-value" : "negative-value"}>{money(check.available - credit)}</strong></div><div className="mini-stat"><span>الجزء الآجل</span><strong>{money(credit)}</strong></div><div className="mini-stat"><span>تاريخ الاستحقاق</span><strong>{credit ? daysFromNow(customer.creditDays) : '—'}</strong></div>
      {credit > 0 && !check.allowed && <div className="notice credit-warning"><b>تجاوز حد الائتمان</b><span>يتطلب دفع الفرق أو PIN المالك.</span></div>}</aside></div>
    {overrideOpen && <CreditOverrideModal customerName={customer.name} credit={credit} available={check.available}
      verifying={verifying} pin={overridePin} setPin={setOverridePin} reason={overrideReason} setReason={setOverrideReason}
      onVerify={() => { void verifyOverride() }} onClose={() => setOverrideOpen(false)} />}
    {invoicePrint.pending && <InvoicePrintPrompt invoice={invoicePrint.pending} printing={invoicePrint.printing} onPrint={() => { void invoicePrint.print() }} onSkip={invoicePrint.skip} />}</>
}

export default SalesWorkspace

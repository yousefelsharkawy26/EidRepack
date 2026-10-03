import { useState } from "react"
import { bridge, ipcErrorMessage, SessionUser } from "../lib/api"

function BootstrapScreen({ onDone }: { onDone: (user: SessionUser, companyName: string) => Promise<void> | void }) {
  const [companyName, setCompanyName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!displayName.trim() || !username.trim()) return setError('أدخل الاسم المعروض واسم المستخدم.')
    if (password.length < 10) return setError('كلمة المرور يجب ألا تقل عن ١٠ أحرف.')
    if (!/^\d{4,8}$/.test(pin)) return setError('PIN المالك يجب أن يكون من ٤ إلى ٨ أرقام.')
    setSubmitting(true)
    setError('')
    try {
      await bridge().auth.bootstrap({ username: username.trim(), displayName: displayName.trim(), password, pin })
      const user = await bridge().auth.login({ username: username.trim(), password })
      await onDone(user, companyName.trim())
    } catch (cause) {
      setError(ipcErrorMessage(cause))
      setSubmitting(false)
    }
  }
  return <main className="login-page" dir="rtl"><section className="login-card"><div className="login-brand"><div className="brand-mark">م</div><div><h1>مدير التعبئة</h1><p>نظام إدارة التجزئة والتعبئة</p></div></div><div className="login-copy"><h2>الإعداد الأولي</h2><p>لا توجد حسابات بعد. أنشئ حساب المالك واسم المنشأة لبدء استخدام النظام ببيانات فارغة.</p></div><form onSubmit={event => { void submit(event) }}><div className="field"><label>اسم المنشأة</label><input value={companyName} onChange={event => setCompanyName(event.target.value)} placeholder="مثال: مدير التعبئة للتجارة"/></div><div className="field"><label>اسمك (يظهر في التقارير)</label><input autoFocus value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="مثال: محمد أحمد"/></div><div className="field"><label>اسم المستخدم</label><input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="مثال: owner"/></div><div className="field"><label>كلمة المرور</label><input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="١٠ أحرف على الأقل"/></div><div className="field"><label>PIN المالك (للعمليات الحساسة)</label><input type="password" inputMode="numeric" value={pin} onChange={event => setPin(event.target.value)} placeholder="من ٤ إلى ٨ أرقام"/></div>{error && <div className="login-error">{error}</div>}<button className="primary login-submit" type="submit" disabled={submitting}>{submitting ? 'جارٍ إنشاء الحساب…' : 'إنشاء الحساب وبدء العمل'}</button></form><p className="login-security">احتفظ بكلمة المرور وPIN المالك في مكان آمن؛ لا يمكن استرجاعهما بدون نسخة احتياطية.</p></section></main>
}

export default BootstrapScreen
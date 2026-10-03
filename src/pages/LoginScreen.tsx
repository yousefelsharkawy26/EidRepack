import { useState } from "react"
import { bridge, ipcErrorMessage, SessionUser } from "../lib/api"

function LoginScreen({ onLogin }: { onLogin: (user: SessionUser) => Promise<void> | void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const user = await bridge().auth.login({ username: username.trim(), password })
      await onLogin(user)
    } catch (cause) {
      setError(ipcErrorMessage(cause))
      setSubmitting(false)
    }
  }
  return <main className="login-page" dir="rtl"><section className="login-card"><div className="login-brand"><div className="brand-mark">م</div><div><h1>مدير التعبئة</h1><p>نظام إدارة التجزئة والتعبئة</p></div></div><div className="login-copy"><h2>تسجيل الدخول</h2><p>أدخل بيانات حسابك للوصول إلى مساحة العمل المصرح بها لك.</p></div><form onSubmit={event => { void submit(event) }}><div className="field"><label>اسم المستخدم</label><input autoFocus autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="مثال: owner"/></div><div className="field"><label>كلمة المرور</label><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••"/></div>{error && <div className="login-error">{error}</div>}<button className="primary login-submit" type="submit" disabled={submitting}>{submitting ? 'جارٍ التحقق…' : 'دخول إلى النظام'}</button></form><p className="login-security">يتحقق النظام من بيانات الدخول داخل قاعدة البيانات المحلية، وتُسجَّل بداية الجلسة في سجل التدقيق.</p></section></main>
}

export default LoginScreen
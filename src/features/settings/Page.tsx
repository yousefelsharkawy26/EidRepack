import { useEffect, useState } from 'react'
import { useApp } from '../../app/AppProvider'
import { User, UserRole } from '../../lib/domain'
import { ArchiveRestore, DatabaseBackup } from 'lucide-react'
import { roleLabel } from '../../lib/helpers'
import { PaginationBar, usePagination } from '../../shared/ui/Pagination'

function SettingsPage() {
  const { state, currentUser } = useApp()
  if (!state || !currentUser) return null
  return <SettingsContent />
}

function SettingsContent() {
  const {
    state: snapshot,
    run,
    busy,
    currentUser: session,
    notify,
    createBackup: onBackup
  } = useApp()
  const state = snapshot!
  const currentUser = session!
  const userPage = usePagination(state.users);
  const auditPage = usePagination(state.auditLog);
  const [tab, setTab] = useState<'general' | 'users' | 'audit' | 'printing'>(
    'general'
  )
  const [printers, setPrinters] = useState<
    Array<{ name: string; displayName: string; available: boolean }>
  >([])
  const [selectedPrinter, setSelectedPrinter] = useState(
    () => localStorage.getItem('repack.defaultPrinter') || ''
  )
  const [printDestination, setPrintDestination] = useState<'printer' | 'pdf'>(
    () => localStorage.getItem('repack.printDestination') === 'pdf' ? 'pdf' : 'printer'
  )
  const [printColor, setPrintColor] = useState(
    () => localStorage.getItem('repack.printColor') !== 'false'
  )
  const [printCopies, setPrintCopies] = useState(() =>
    Number(localStorage.getItem('repack.printCopies') || 1)
  )
  const [companyName, setCompanyName] = useState(state.settings.companyName)
  const [companyPhone, setCompanyPhone] = useState(state.settings.companyPhone)
  const [defaultCreditDays, setDefaultCreditDays] = useState(
    state.settings.defaultCreditDays
  )
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [userName, setUserName] = useState('')
  const [userDisplayName, setUserDisplayName] = useState('')
  const [userRole, setUserRole] = useState<UserRole>('sales')
  const [userPassword, setUserPassword] = useState('')
  const [userPin, setUserPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  useEffect(() => {
    if (tab !== 'printing') return
    void window.repack
      ?.getPrinters()
      .then(setPrinters)
      .catch(() => notify('تعذر قراءة الطابعات المتاحة من النظام.'))
  }, [tab, notify])
  const savePrinting = () => {
    if (!Number.isInteger(printCopies) || printCopies < 1 || printCopies > 20)
      return notify('عدد النسخ يجب أن يكون من 1 إلى 20.')
    localStorage.setItem('repack.defaultPrinter', selectedPrinter)
    localStorage.setItem('repack.printDestination', printDestination)
    localStorage.setItem('repack.printColor', String(printColor))
    localStorage.setItem('repack.printCopies', String(printCopies))
    notify('تم حفظ تفضيلات الطباعة على هذا الجهاز.')
  }
  // UX hint — backend is authoritative.
  const saveCompany = async () => {
    if (!companyName.trim()) return notify('اسم المنشأة مطلوب.')
    if (!Number.isFinite(defaultCreditDays) || defaultCreditDays < 0)
      return notify('فترة السداد الافتراضية غير صالحة.')
    const nameSaved = await run('settings:save', {
      key: 'company_name',
      value: companyName.trim()
    })
    if (!nameSaved) return
    const phoneSaved = await run('settings:save', {
      key: 'company_phone',
      value: companyPhone.trim()
    })
    if (!phoneSaved) return
    await run(
      'settings:save',
      {
        key: 'default_credit_days',
        value: Math.round(defaultCreditDays)
      },
      'تم حفظ بيانات المنشأة وستظهر في الفواتير والتقارير.'
    )
  }
  const restoreBackup = async () => {
    if (!window.repack?.restoreBackup)
      return notify('الاستعادة متاحة داخل نسخة سطح المكتب فقط.')
    if (
      !window.confirm(
        'سيتم استبدال كل البيانات الحالية بمحتوى النسخة الاحتياطية. هل تريد المتابعة؟'
      )
    )
      return
    const restored = await window.repack.restoreBackup()
    if (restored) {
      notify('تمت الاستعادة بنجاح؛ سيعاد تحميل التطبيق الآن.')
      window.setTimeout(() => window.location.reload(), 900)
    }
  }
  const toggleUser = (user: User) => {
    if (currentUser.role !== 'owner')
      return notify('إدارة الحسابات متاحة للمالك فقط.')
    // The backend hashes credentials, blocks self-deactivation, and protects
    // the last active owner; the renderer only sends plain account fields.
    void run(
      'user:save',
      {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        isActive: !user.active
      },
      user.active
        ? 'تم إيقاف الحساب وتسجيل الإجراء.'
        : 'تم تفعيل الحساب وتسجيل الإجراء.'
    )
  }
  const resetUserForm = () => {
    setEditingUser(null)
    setUserName('')
    setUserDisplayName('')
    setUserRole('sales')
    setUserPassword('')
    setUserPin('')
    setCurrentPin('')
  }
  const editUser = (user: User) => {
    setEditingUser(user)
    setUserName(user.username)
    setUserDisplayName(user.displayName)
    setUserRole(user.role)
    setUserPassword('')
    setUserPin('')
    setCurrentPin('')
  }
  const saveUser = async () => {
    if (currentUser.role !== 'owner')
      return notify('إدارة الحسابات متاحة للمالك فقط.')
    if (!userName.trim() || !userDisplayName.trim())
      return notify('اسم المستخدم والاسم الظاهر مطلوبان.')
    if ((!editingUser || userPassword) && userPassword.length < 10)
      return notify('كلمة المرور يجب ألا تقل عن 10 أحرف.')
    if ((!editingUser && userRole === 'owner') || userPin) {
      if (!/^\d{4,8}$/.test(userPin))
        return notify('PIN المستخدم يجب أن يتكون من 4 إلى 8 أرقام.')
      if (editingUser && !/^\d{4,8}$/.test(currentPin))
        return notify('أدخل PIN المالك الحالي لتغيير PIN المستخدم.')
    }
    const result = await run(
      'user:save',
      {
        ...(editingUser ? { id: editingUser.id } : {}),
        username: userName.trim(),
        displayName: userDisplayName.trim(),
        role: userRole,
        ...(userPassword ? { password: userPassword } : {}),
        ...(userPin ? { pin: userPin } : {}),
        ...(editingUser && userPin ? { currentPin } : {}),
        ...(editingUser ? { isActive: editingUser.active } : {})
      },
      editingUser ? 'تم تحديث بيانات المستخدم.' : 'تم إنشاء المستخدم.'
    )
    if (result) resetUserForm()
  }
  return (
    <>
      <div className="section-header">
        <div>
          <h2>الإعدادات والإدارة</h2>
          <p>إعدادات المنشأة، المستخدمون، سجل التدقيق</p>
        </div>
      </div>
      <div className="toolbar toolbar-spaced">
        <button
          className={tab === 'general' ? 'primary' : 'secondary'}
          onClick={() => setTab('general')}
        >
          عام
        </button>
        <button
          className={tab === 'users' ? 'primary' : 'secondary'}
          onClick={() => setTab('users')}
        >
          المستخدمون والصلاحيات
        </button>
        <button
          className={tab === 'audit' ? 'primary' : 'secondary'}
          onClick={() => setTab('audit')}
        >
          سجل التدقيق
        </button>
        <button
          className={tab === 'printing' ? 'primary' : 'secondary'}
          onClick={() => setTab('printing')}
        >
          إدارة الطباعة
        </button>
      </div>
      {tab === 'printing' && (
        <section className="card">
          <div className="card-title">
            <h3>تفضيلات الطباعة</h3>
            <button className="primary" onClick={savePrinting}>
              حفظ الإعدادات
            </button>
          </div>
          <div className="settings-form-grid">
            <div className="field">
              <label htmlFor="print-destination">طريقة إخراج التقارير</label>
              <select id="print-destination" value={printDestination} onChange={event => setPrintDestination(event.target.value as 'printer' | 'pdf')}>
                <option value="printer">الطابعة المحددة</option>
                <option value="pdf">حفظ إلى PDF</option>
              </select>
              <small className="field-hint">عند اختيار PDF سيظهر مربع حفظ لتحديد اسم الملف ومكانه.</small>
            </div>
            <div className="field">
              <label htmlFor="default-printer">
                الطابعة الافتراضية للمستندات
              </label>
              <select
                id="default-printer"
                value={selectedPrinter}
                disabled={printDestination === 'pdf'}
                onChange={(event) => setSelectedPrinter(event.target.value)}
              >
                <option value="">استخدام طابعة النظام الافتراضية</option>
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName || printer.name}
                  </option>
                ))}
              </select>
              <small className="field-hint">
                تطبق على الفواتير وكشوف الحساب المطبوعة من النظام.
              </small>
            </div>
            <div className="field">
              <label htmlFor="print-copies">عدد النسخ الافتراضي</label>
              <input
                id="print-copies"
                type="number"
                min="1"
                max="20"
                value={printCopies}
                onChange={(event) => setPrintCopies(Number(event.target.value))}
              />
            </div>
            <label className="mini-stat">
              <span>طباعة الألوان والخلفيات</span>
              <input
                type="checkbox"
                checked={printColor}
                onChange={(event) => setPrintColor(event.target.checked)}
              />
            </label>
          </div>
          <div className="notice notice-spaced">
            <b>الطابعات المتاحة</b>
            <span>
              {printers.length
                ? printers
                    .map((printer) => printer.displayName || printer.name)
                    .join(' · ')
                : 'لم يعثر النظام على طابعات؛ تحقق من إعدادات الطباعة في نظام التشغيل.'}
            </span>
          </div>
        </section>
      )}
      {tab === 'general' && (
        <div className="dashboard-grid">
          <section className="card">
            <div className="card-title">
              <h3>بيانات المنشأة</h3>
              <button className="link" onClick={saveCompany}>
                حفظ التغييرات
              </button>
            </div>
            <div className="settings-form-grid">
              <div className="field">
                <label>اسم المنشأة</label>
                <input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                />
              </div>
              <div className="field">
                <label>العملة</label>
                <select defaultValue="EGP">
                  <option value="EGP">الجنيه المصري (EGP)</option>
                </select>
              </div>
              <div className="field">
                <label>رقم الهاتف</label>
                <input
                  value={companyPhone}
                  onChange={(event) => setCompanyPhone(event.target.value)}
                />
              </div>
              <div className="field">
                <label>فترة السداد الافتراضية (أيام)</label>
                <input
                  type="number"
                  min="0"
                  value={defaultCreditDays}
                  onChange={(event) =>
                    setDefaultCreditDays(Number(event.target.value))
                  }
                />
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-title">
              <h3>سياسات العمل</h3>
            </div>
            <div className="mini-stat">
              <span>طريقة احتساب التكلفة</span>
              <strong>متوسط مرجّح متحرك</strong>
            </div>
            <div className="mini-stat">
              <span>منع الرصيد السالب</span>
              <button className="status green">مفعل</button>
            </div>
            <div className="mini-stat">
              <span>التسويات الحساسة</span>
              <strong>PIN المالك مطلوب</strong>
            </div>
            <div className="mini-stat">
              <span>خيار واتساب</span>
              <strong>رابط مباشر wa.me</strong>
            </div>
          </section>
        </div>
      )}
      {tab === 'users' && (
        <section className="card card-flush">
          {currentUser.role === 'owner' && (
            <div className="panel-inset">
              <div className="card-title">
                <h3>{editingUser ? 'تعديل المستخدم' : 'إضافة مستخدم'}</h3>
                {editingUser && (
                  <button className="link" onClick={resetUserForm}>
                    إلغاء التعديل
                  </button>
                )}
              </div>
              <div className="settings-form-grid">
                <div className="field">
                  <label htmlFor="managed-user-display-name">
                    الاسم الظاهر
                  </label>
                  <input
                    id="managed-user-display-name"
                    value={userDisplayName}
                    onChange={(event) => setUserDisplayName(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="managed-user-username">اسم المستخدم</label>
                  <input
                    id="managed-user-username"
                    autoComplete="off"
                    value={userName}
                    onChange={(event) => setUserName(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="managed-user-role">الدور</label>
                  <select
                    id="managed-user-role"
                    value={userRole}
                    onChange={(event) =>
                      setUserRole(event.target.value as UserRole)
                    }
                  >
                    <option value="sales">مبيعات</option>
                    <option value="purchasing">مشتريات</option>
                    <option value="warehouse">مخزون وتعبئة</option>
                    <option value="owner">مالك</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="managed-user-password">
                    {editingUser ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}
                  </label>
                  <input
                    id="managed-user-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    value={userPassword}
                    onChange={(event) => setUserPassword(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="managed-user-pin">
                    {editingUser
                      ? 'PIN جديد (اختياري)'
                      : userRole === 'owner'
                        ? 'PIN المالك'
                        : 'PIN (اختياري)'}
                  </label>
                  <input
                    id="managed-user-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    minLength={4}
                    maxLength={8}
                    value={userPin}
                    onChange={(event) =>
                      setUserPin(
                        event.target.value.replace(/\D/g, '').slice(0, 8)
                      )
                    }
                  />
                </div>
                {editingUser && userPin && (
                  <div className="field">
                    <label htmlFor="managed-user-current-pin">
                      PIN المالك الحالي للتحقق
                    </label>
                    <input
                      id="managed-user-current-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="current-password"
                      minLength={4}
                      maxLength={8}
                      value={currentPin}
                      onChange={(event) =>
                        setCurrentPin(
                          event.target.value.replace(/\D/g, '').slice(0, 8)
                        )
                      }
                    />
                  </div>
                )}
              </div>
              <div className="settings-actions notice-spaced">
                <button className="primary" disabled={busy} onClick={saveUser}>
                  {editingUser ? 'حفظ المستخدم' : 'إنشاء المستخدم'}
                </button>
              </div>
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>المستخدم</th>
                <th>الدور</th>
                <th>الصلاحيات الأساسية</th>
                <th>الحالة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {userPage.pageItems.map((user) => (
                <tr key={user.id}>
                  <td className="name-cell">
                    <b>{user.displayName}</b>
                    <small>@{user.username}</small>
                  </td>
                  <td>{roleLabel(user.role)}</td>
                  <td>
                    {user.role === 'owner'
                      ? 'كل الصلاحيات وPIN'
                      : user.role === 'sales'
                        ? 'بيع، تحصيل، عملاء'
                        : user.role === 'purchasing'
                          ? 'شراء، موردون'
                          : 'مخزون وتعبئة وجرد'}
                  </td>
                  <td>
                    <span
                      className={'status ' + (user.active ? 'green' : 'gray')}
                    >
                      {user.active ? 'نشط' : 'موقوف'}
                    </span>
                  </td>
                  <td>
                    {currentUser.role === 'owner' && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => editUser(user)}
                      >
                        تعديل
                      </button>
                    )}
                    {currentUser.role === 'owner' && user.role !== 'owner' && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => toggleUser(user)}
                      >
                        {user.active ? 'إيقاف' : 'تفعيل'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
          </table>
          <PaginationBar state={userPage.pagination}/>
          <div className="notice notice-inset">
            <b>حماية الوصول</b>
            <span>
              يتم الدخول الآن باسم المستخدم وكلمة المرور؛ لا يمكن تبديل الحساب
              من هذه الشاشة.
            </span>
          </div>
        </section>
      )}
      {tab === 'audit' && (
        <section className="card card-flush">
          <table>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>المستخدم</th>
                <th>الإجراء</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {auditPage.pageItems.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.at.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    {state.users.find((user) => user.id === entry.userId)
                      ?.displayName || '—'}
                  </td>
                  <td>
                    <span className="status yellow">{entry.action}</span>
                  </td>
                  <td>{entry.detail}</td>
                </tr>
              ))}
          </tbody>
          </table>
          <PaginationBar state={auditPage.pagination}/>
        </section>
      )}
    </>
  )
}

export default SettingsPage

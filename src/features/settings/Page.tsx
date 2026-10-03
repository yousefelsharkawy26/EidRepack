import { useState } from "react";
import { useApp } from "../../app/AppProvider";
import { User } from "../../lib/domain";
import { ArchiveRestore, DatabaseBackup } from "lucide-react";
import { roleLabel } from "../../lib/helpers";

function SettingsPage() {
  const { state, currentUser } = useApp();
  if (!state || !currentUser) return null;
  return <SettingsContent />;
}

function SettingsContent() {
  const { state: snapshot, run, busy, currentUser: session, notify, createBackup: onBackup } = useApp();
  const state = snapshot!;
  const currentUser = session!;
  const [tab, setTab] = useState<"general" | "users" | "audit">("general");
  const [companyName, setCompanyName] = useState(state.settings.companyName);
  const [companyPhone, setCompanyPhone] = useState(state.settings.companyPhone);
  const [defaultCreditDays, setDefaultCreditDays] = useState(
    state.settings.defaultCreditDays,
  );
  // UX hint — backend is authoritative.
  const saveCompany = async () => {
    if (!companyName.trim()) return notify("اسم المنشأة مطلوب.");
    if (!Number.isFinite(defaultCreditDays) || defaultCreditDays < 0)
      return notify("فترة السداد الافتراضية غير صالحة.");
    const nameSaved = await run("settings:save", {
        key: "company_name",
        value: companyName.trim(),
      });
    if (!nameSaved) return;
    const phoneSaved = await run("settings:save", {
        key: "company_phone",
        value: companyPhone.trim(),
      });
    if (!phoneSaved) return;
    await run("settings:save", {
        key: "default_credit_days",
        value: Math.round(defaultCreditDays),
      }, "تم حفظ بيانات المنشأة وستظهر في الفواتير والتقارير.");
  };
  const restoreBackup = async () => {
    if (!window.repack?.restoreBackup)
      return notify("الاستعادة متاحة داخل نسخة سطح المكتب فقط.");
    if (
      !window.confirm(
        "سيتم استبدال كل البيانات الحالية بمحتوى النسخة الاحتياطية. هل تريد المتابعة؟",
      )
    )
      return;
    const restored = await window.repack.restoreBackup();
    if (restored) {
      notify("تمت الاستعادة بنجاح؛ سيعاد تحميل التطبيق الآن.");
      window.setTimeout(() => window.location.reload(), 900);
    }
  };
  const toggleUser = (user: User) => {
    if (currentUser.role !== "owner")
      return notify("إدارة الحسابات متاحة للمالك فقط.");
    // The backend hashes credentials, blocks self-deactivation, and protects
    // the last active owner; the renderer only sends plain account fields.
    void run(
      "user:save",
      {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          isActive: !user.active,
      },
      user.active
        ? "تم إيقاف الحساب وتسجيل الإجراء."
        : "تم تفعيل الحساب وتسجيل الإجراء.",
    );
  };
  return (
    <>
      <div className="section-header">
        <div>
          <h2>الإعدادات والإدارة</h2>
          <p>إعدادات المنشأة، المستخدمون، سجل التدقيق والنسخ الاحتياطي</p>
        </div>
        <button className="primary" onClick={onBackup}>
          <DatabaseBackup size={15} /> إنشاء نسخة احتياطية
        </button>
      </div>
      <div className="toolbar toolbar-spaced">
        <button
          className={tab === "general" ? "primary" : "secondary"}
          onClick={() => setTab("general")}
        >
          عام
        </button>
        <button
          className={tab === "users" ? "primary" : "secondary"}
          onClick={() => setTab("users")}
        >
          المستخدمون والصلاحيات
        </button>
        <button
          className={tab === "audit" ? "primary" : "secondary"}
          onClick={() => setTab("audit")}
        >
          سجل التدقيق
        </button>
      </div>
      {tab === "general" && (
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
          <section className="card">
            <div className="card-title">
              <h3>النسخ الاحتياطي</h3>
              <ArchiveRestore size={18} color="#197b62" />
            </div>
      <p className="settings-help">
              تُخزَّن البيانات محليًا في ملف SQLite واحد مع وضع WAL، ويمكن أخذ
              نسخة احتياطية سليمة واستعادتها من تطبيق سطح المكتب.
            </p>
      <div className="settings-actions">
              <button className="secondary" onClick={onBackup}>
                <DatabaseBackup size={15} /> نسخ احتياطي الآن
              </button>
              <button className="secondary" onClick={restoreBackup}>
                <ArchiveRestore size={15} /> استعادة نسخة احتياطية
              </button>
            </div>
          </section>
        </div>
      )}
      {tab === "users" && (
      <section className="card card-flush">
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
              {state.users.map((user) => (
                <tr key={user.id}>
                  <td className="name-cell">
                    <b>{user.displayName}</b>
                    <small>@{user.username}</small>
                  </td>
                  <td>{roleLabel(user.role)}</td>
                  <td>
                    {user.role === "owner"
                      ? "كل الصلاحيات وPIN"
                      : user.role === "sales"
                        ? "بيع، تحصيل، عملاء"
                        : user.role === "purchasing"
                          ? "شراء، موردون"
                          : "مخزون وتعبئة وجرد"}
                  </td>
                  <td>
                    <span
                      className={"status " + (user.active ? "green" : "gray")}
                    >
                      {user.active ? "نشط" : "موقوف"}
                    </span>
                  </td>
                  <td>
                    {currentUser.role === "owner" && user.role !== "owner" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => toggleUser(user)}
                      >
                        {user.active ? "إيقاف" : "تفعيل"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      <div className="notice notice-inset">
            <b>حماية الوصول</b>
            <span>
              يتم الدخول الآن باسم المستخدم وكلمة المرور؛ لا يمكن تبديل الحساب
              من هذه الشاشة.
            </span>
          </div>
        </section>
      )}
      {tab === "audit" && (
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
              {state.auditLog.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.at.slice(0, 16).replace("T", " ")}</td>
                  <td>
                    {state.users.find((user) => user.id === entry.userId)
                      ?.displayName || "—"}
                  </td>
                  <td>
                    <span className="status yellow">{entry.action}</span>
                  </td>
                  <td>{entry.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

export default SettingsPage;

import { useState } from "react";
import { daysFromNow, money, quantity, Reminder, renderTemplate, saleStatus, today } from "../../lib/domain";
import { useApp } from "../../app/AppProvider";
import { AlertTriangle, CheckCircle2, MessageCircle, Settings } from "lucide-react";
import Metric from "../../components/Metric";
import { statusClass, statusLabel } from "../../lib/helpers";
import StatusBadge from "../../shared/ui/StatusBadge";
import ReminderConfig from "./ReminderConfig";

function Reminders() {
  const { state } = useApp();
  if (!state) return null;
  return <RemindersContent />;
}

function RemindersContent() {
  const { state: snapshot, run, busy, notify } = useApp();
  const state = snapshot!;
  const [showConfig, setShowConfig] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<{
    reminderId: string;
    customerId: string;
    phone: string;
    body: string;
  } | null>(null);
  const due = state.reminders.filter(
    (reminder) =>
      reminder.status === "pending" && reminder.scheduledFor <= today(),
  );
  // UX hint — backend is authoritative.
  const send = async (reminder: Reminder) => {
    const sale = state.sales.find((item) => item.id === reminder.saleId);
    const customer = state.customers.find(
      (item) => item.id === reminder.customerId,
    );
    const template =
      state.messageTemplates.find((item) => item.id === reminder.templateId) ||
      state.messageTemplates[0];
    if (!sale || !customer || !template || sale.total <= sale.paid)
      return notify("لا يمكن إرسال تذكير لفاتورة مسددة أو بيانات غير مكتملة.");
    const message = renderTemplate(
      template.body,
      customer,
      sale,
      state.settings.companyName,
    );
    if (!customer.whatsapp)
      return notify("لا يوجد رقم واتساب صالح لهذا العميل.");
    const digits = customer.whatsapp.replace(/[^0-9]/g, "");
    if (digits.length < 8)
      return notify("رقم واتساب العميل غير صالح؛ راجع بياناته.");
    if (window.repack) await window.repack.openWhatsApp(digits, message);
    else
      window.open(
        "https://wa.me/" + digits + "?text=" + encodeURIComponent(message),
        "_blank",
        "noopener",
      );
    setAwaitingConfirmation({
      reminderId: reminder.id,
      customerId: customer.id,
      phone: digits,
      body: message,
    });
    notify("فُتح واتساب. يظل التذكير قيد الانتظار حتى تؤكد الإرسال هنا.");
  };
  const confirmSent = () => {
    if (!awaitingConfirmation) return;
    const pending = awaitingConfirmation;
    // Confirming records both the reminder status and the message log entry
    // atomically in the backend.
    void run(
      "reminder:update",
      {
          id: pending.reminderId,
          action: "sent",
          renderedBody: pending.body,
          toPhone: pending.phone,
          date: state.today,
      },
      "تم تأكيد الإرسال وإضافته إلى سجل الرسائل.",
    ).then((ok) => {
      if (ok) setAwaitingConfirmation(null);
    });
  };
  const postpone = (reminder: Reminder) => {
    void run(
      "reminder:update",
      {
          id: reminder.id,
          action: "postponed",
          scheduledFor: daysFromNow(1),
      },
      "تم تأجيل التذكير إلى الغد.",
    );
  };
  const skip = (reminder: Reminder) => {
    void run(
      "reminder:update", { id: reminder.id, action: "skipped" },
      "تم تخطي التذكير مع الاحتفاظ به في السجل.",
    );
  };
  const toggleRule = (rule: (typeof state.reminderRules)[number]) => {
    void run(
      "reminder-rule:save",
      {
          id: rule.id,
          name: rule.name,
          offsetDays: rule.offsetDays,
          templateId: rule.templateId || undefined,
          isActive: !rule.active,
      },
      rule.active ? "تم إيقاف القاعدة." : "تم تفعيل القاعدة.",
    );
  };
  return (
    <>
      <div className="section-header">
        <div>
          <h2>مركز التذكيرات</h2>
          <p>
            {due.length
              ? "لديك " +
                due.length +
                " تذكيرات مستحقة أو فائتة تحتاج المعالجة."
              : "لا توجد تذكيرات مستحقة الآن."}
          </p>
        </div>
        <button className="secondary" onClick={() => setShowConfig(true)}>
          <Settings size={15} /> قواعد وقوالب الرسائل
        </button>
      </div>
      <div className="metrics metrics-three">
        <Metric
          title="مستحق للإرسال اليوم"
          value={quantity(due.length, "رسائل")}
          note="يشمل التذكيرات الفائتة أثناء إغلاق التطبيق"
          icon={<MessageCircle size={18} />}
        />
        <Metric
          title="سجل الإرسال"
          value={quantity(
            state.messageLog.filter((log) => log.status === "sent").length,
            "رسائل",
          )}
          note="تُمنع إعادة المرحلة نفسها تلقائيًا"
          icon={<CheckCircle2 size={18} />}
          tone="orange"
        />
        <Metric
          title="فواتير متأخرة"
          value={quantity(
            state.sales.filter((sale) => saleStatus(sale) === "overdue").length,
            "فواتير",
          )}
          note="تحتاج متابعة المالك"
          icon={<AlertTriangle size={18} />}
          tone="red"
        />
      </div>
      <section className="card card-flush">
        <table>
          <thead>
            <tr>
              <th>العميل / الفاتورة</th>
              <th>المرحلة</th>
              <th>مجدول في</th>
              <th>المبلغ المتبقي</th>
              <th>الحالة</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.reminders.map((reminder) => {
              const sale = state.sales.find(
                (sale) => sale.id === reminder.saleId,
              );
              const customer = state.customers.find(
                (customer) => customer.id === reminder.customerId,
              );
              const actionable =
                reminder.status === "pending" &&
                reminder.scheduledFor <= today();
              return (
                <tr key={reminder.id}>
                  <td className="name-cell">
                    <b>{customer?.name}</b>
                    <small>{sale?.number}</small>
                  </td>
                  <td>{reminder.stage}</td>
                  <td>{reminder.scheduledFor}</td>
                  <td>{sale ? money(sale.total - sale.paid) : "—"}</td>
                  <td>
                    <StatusBadge status={reminder.status} />
                  </td>
                  <td className="table-actions-cell-tight">
                    {actionable && (
                      <>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => send(reminder)}
                        >
                          <MessageCircle size={14} /> إرسال
                        </button>
                        {awaitingConfirmation?.reminderId === reminder.id && (
                          <button className="primary" onClick={confirmSent}>
                            <CheckCircle2 size={14} /> تم الإرسال
                          </button>
                        )}
                        <button
                          className="secondary"
                          onClick={() => postpone(reminder)}
                        >
                          تأجيل
                        </button>
                        <button
                          className="danger"
                          onClick={() => skip(reminder)}
                        >
                          تخطي
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="split panel-spaced">
        <section className="card">
          <div className="card-title">
            <h3>ملخص المالك اليومي</h3>
          </div>
          <div className="mini-stat">
            <span>ذمم تستحق خلال 7 أيام</span>
            <strong>
              {money(
                state.sales
                  .filter(
                    (sale) =>
                      sale.dueDate &&
                      sale.dueDate >= today() &&
                      sale.dueDate <= daysFromNow(7),
                  )
                  .reduce((sum, sale) => sum + sale.total - sale.paid, 0),
              )}
            </strong>
          </div>
          <div className="mini-stat">
            <span>ذمم متأخرة</span>
        <strong className="negative-text">
              {money(
                state.sales
                  .filter((sale) => saleStatus(sale) === "overdue")
                  .reduce((sum, sale) => sum + sale.total - sale.paid, 0),
              )}
            </strong>
          </div>
        </section>
        <section className="card">
          <div className="card-title">
            <h3>آخر سجل رسائل</h3>
          </div>
          {state.messageLog.length ? (
            state.messageLog.slice(0, 3).map((log) => (
              <div className="mini-stat" key={log.id}>
                <span>
                  {
                    state.customers.find(
                      (customer) => customer.id === log.customerId,
                    )?.name
                  }{" "}
                  · {log.createdAt.slice(0, 10)}
                </span>
                <span className={"status " + statusClass(log.status)}>
                  {log.status === "sent" ? "أُرسل" : "فشل"}
                </span>
              </div>
            ))
          ) : (
        <p className="muted-empty">
              سيظهر سجل الإرسال هنا بعد أول رسالة.
            </p>
          )}
        </section>
      </div>
      <ReminderConfig state={state} open={showConfig} busy={busy} onClose={() => setShowConfig(false)} onToggleRule={toggleRule} />
    </>
  );
}

export default Reminders;

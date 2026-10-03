import type { AppState } from "../../lib/domain";
import Modal from "../../components/Modal";

export default function ReminderConfig({ state, open, busy, onClose, onToggleRule }: { state: AppState; open: boolean; busy: boolean; onClose: () => void; onToggleRule: (rule: AppState["reminderRules"][number]) => void }) {
  if (!open) return null;
  return <Modal title="قواعد وقوالب التذكير" onClose={onClose}><p>تُستخدم هذه القواعد لكل فاتورة آجلة جديدة. لا تُرسل المرحلة نفسها مرتين لنفس الفاتورة.</p>
    <div className="reminder-rule-list">{state.reminderRules.map((rule) => <div className="mini-stat" key={rule.id}><span><b>{rule.name}</b><br />{rule.stage} · {rule.offsetDays > 0 ? "+" : ""}{rule.offsetDays} يوم</span>
      <button className={"status " + (rule.active ? "green" : "gray")} disabled={busy} onClick={() => onToggleRule(rule)}>{rule.active ? "مفعل" : "متوقف"}</button>
    </div>)}</div>
    <div className="reminder-template-list"><b className="reminder-template-heading">قوالب الرسائل</b>{state.messageTemplates.map((template) => <div className="notice notice-spaced" key={template.id}><b>{template.name}</b><span>{template.body}</span></div>)}</div>
    <div className="modal-actions"><button className="primary" onClick={onClose}>تم</button></div>
  </Modal>;
}

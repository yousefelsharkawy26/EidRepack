import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore, DatabaseBackup, FileText, RotateCcw, X } from "lucide-react";
import { useApp } from "../app/AppProvider";
import { bridge, ipcErrorMessage } from "../lib/api";
import { PaginationBar, usePagination } from "../shared/ui/Pagination";

type Panel = "backups" | "reset" | "logs" | "tools" | "demo";
type Backup = { name:string; size:number; status:string; createdAt:string };
type LogEntry = { at:string; level:string; message:string };

export default function DeveloperTools({ onClose }: { onClose: () => void }) {
  const { currentUser, refresh, notify, createBackup } = useApp();
  const [panel, setPanel] = useState<Panel>("backups");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dataMode, setDataMode] = useState<"production" | "demo">("production");
  const backupPage = usePagination(backups);
  const load = useCallback(async () => {
    setError("");
    try {
      if (panel === "backups") setBackups(await bridge().developerTools.backups());
      if (panel === "logs") setLogs(await bridge().developerTools.logs());
    } catch (reason) { setError(ipcErrorMessage(reason)); }
  }, [panel]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void bridge().developerTools.dataMode().then(setDataMode).catch(reason => setError(ipcErrorMessage(reason)));
  }, []);
  if (currentUser?.role !== "owner") return null;
  const makeBackup = async () => {
    setBusy(true);
    try { await createBackup(); await load(); } finally { setBusy(false); }
  };
  const restore = async () => {
    if (!window.confirm("سيتم استبدال كل البيانات الحالية بمحتوى النسخة الاحتياطية. هل تريد المتابعة؟")) return;
    setBusy(true);
    try {
      if (await bridge().restoreBackup()) { notify("تمت الاستعادة؛ سيعاد تحميل التطبيق الآن."); window.setTimeout(() => window.location.reload(), 700); }
    } catch (reason) { setError(ipcErrorMessage(reason)); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (confirmation !== "RESET") return;
    setBusy(true);
    setError("");
    try {
      const result = await bridge().developerTools.factoryReset({ confirmation: "RESET" });
      setConfirmation("");
      await refresh();
      await load();
      notify(`تمت إعادة ضبط بيانات المنشأة. النسخة الآمنة: ${result.backupName}`);
    } catch (reason) { setError(ipcErrorMessage(reason)); } finally { setBusy(false); }
  };
  const openTools = async () => {
    try { if (!await bridge().developerTools.openTools()) setError("تعذر فتح أدوات المطور."); }
    catch (reason) { setError(ipcErrorMessage(reason)); }
  };
  const changeDataMode = async () => {
    const nextMode = dataMode === "demo" ? "production" : "demo";
    const explanation = nextMode === "demo"
      ? "سيتم فتح ملف بيانات تجريبية منفصل بعملاء وأصناف وهمية. لن تتغير بيانات المنشأة الأساسية. ستحتاج لتسجيل دخول المالك مرة أخرى. هل تريد المتابعة؟"
      : "سيتم الرجوع إلى ملف البيانات الأساسية. ستحتاج لتسجيل دخول المالك مرة أخرى. بيانات الاختبار ستظل محفوظة في ملفها المنفصل. هل تريد المتابعة؟";
    if (!window.confirm(explanation)) return;
    setBusy(true);
    setError("");
    try {
      const result = await bridge().developerTools.setDataMode(nextMode);
      setDataMode(result.mode);
      notify(nextMode === "demo" ? "تم فتح البيانات التجريبية. سجّل الدخول بحساب المالك." : "تم الرجوع للبيانات الأساسية. سجّل الدخول بحساب المالك.");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (reason) { setError(ipcErrorMessage(reason)); setBusy(false); }
  };
  return <div className="developer-tools-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="developer-tools-panel" role="dialog" aria-modal="true" aria-labelledby="developer-tools-title" dir="rtl">
      <header><div><small>وضع المطور · Ctrl+Shift+D للإغلاق</small><h2 id="developer-tools-title">أدوات المطور</h2></div><button className="icon-button" aria-label="إغلاق" onClick={onClose}><X size={17}/></button></header>
      <nav className="developer-tools-tabs"><button className={panel === "backups" ? "primary" : "secondary"} onClick={() => setPanel("backups")}>النسخ الاحتياطية</button><button className={panel === "reset" ? "primary" : "secondary"} onClick={() => setPanel("reset")}>إعادة ضبط المصنع</button><button className={panel === "logs" ? "primary" : "secondary"} onClick={() => setPanel("logs")}>سجلات النظام</button><button className={panel === "tools" ? "primary" : "secondary"} onClick={() => setPanel("tools")}>أدوات التطوير</button><button className={panel === "demo" ? "primary" : "secondary"} onClick={() => setPanel("demo")}>بيانات تجريبية</button></nav>
      {error && <div role="alert" className="notice error-notice">{error}</div>}
      {panel === "backups" && <div className="developer-tools-body"><div className="toolbar"><button className="primary" disabled={busy} onClick={() => void makeBackup()}><DatabaseBackup size={15}/> إنشاء نسخة خارجية</button><button className="secondary" disabled={busy} onClick={() => void restore()}><ArchiveRestore size={15}/> استعادة نسخة</button><button className="secondary" onClick={() => void load()}>تحديث القائمة</button></div><p className="settings-help">النسخة التلقائية قبل إعادة ضبط المصنع تحفظ في مجلد بيانات التطبيق، ولا تُحذف هنا.</p><div className="data-table"><table><thead><tr><th>الملف</th><th>التاريخ</th><th>الحجم</th><th>الحالة</th></tr></thead><tbody>{backupPage.pageItems.map((backup, index) => <tr key={backup.name + index}><td>{backup.name}</td><td>{backup.createdAt.slice(0,16).replace("T"," ")}</td><td>{(backup.size / 1024 / 1024).toFixed(2)} MB</td><td>{backup.status}</td></tr>)}</tbody></table>{backups.length === 0 && <p className="empty-state">لا توجد نسخ مسجلة.</p>}<PaginationBar state={backupPage.pagination}/></div></div>}
      {panel === "reset" && <div className="developer-tools-body"><div className="notice error-notice"><b>عملية مدمرة للبيانات</b><span>سيتم إنشاء نسخة تلقائية أولًا، ثم حذف بيانات المنشأة وسجلات التدقيق. سيبقى حساب المالك الحالي والإعدادات الأساسية. لا يمكن التراجع دون استعادة النسخة.</span></div><div className="field notice-spaced"><label htmlFor="factory-reset-confirm">اكتب RESET للتأكيد</label><input id="factory-reset-confirm" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div><button className="danger notice-spaced" disabled={busy || confirmation !== "RESET"} onClick={() => void reset()}><RotateCcw size={15}/> أخذ نسخة ثم إعادة الضبط</button></div>}
      {panel === "logs" && <div className="developer-tools-body"><div className="toolbar"><button className="secondary" onClick={() => void load()}><FileText size={15}/> تحديث السجلات</button><span className="text-secondary">آخر 500 حدث من سجل العملية الرئيسية</span></div><div className="developer-log-list">{logs.map((entry,index) => <article key={entry.at + index}><time>{entry.at.replace("T"," ").slice(0,19)}</time><b className={"log-level " + entry.level}>{entry.level}</b><pre>{entry.message}</pre></article>)}{logs.length === 0 && <p className="empty-state">لا توجد أحداث مسجلة بعد.</p>}</div></div>}
      {panel === "tools" && <div className="developer-tools-body"><p>أدوات Chromium متاحة للجلسة الحالية فقط.</p><button className="secondary" onClick={() => void openTools()}>فتح أدوات المطور (Detached)</button></div>}
      {panel === "demo" && <div className="developer-tools-body"><div className={"notice " + (dataMode === "demo" ? "" : "error-notice")}><b>الوضع الحالي: {dataMode === "demo" ? "بيانات تجريبية" : "البيانات الأساسية"}</b><span>ملف الاختبار مستقل عن قاعدة البيانات الأساسية ويحتوي سجلات اصطناعية. التبديل لا ينقل سجلات بين الملفين، وسيطلب منك تسجيل الدخول مجددًا.</span></div><p className="settings-help">حساب المالك وكلمة مروره نفس الحساب، بينما باقي المستخدمين والبيانات منفصلة. بيانات الاختبار تحفظ بين مرات التشغيل ويمكن الرجوع إليها لاحقًا.</p><button className={dataMode === "demo" ? "secondary notice-spaced" : "primary notice-spaced"} disabled={busy} onClick={() => void changeDataMode()}>{busy ? "جارٍ تجهيز قاعدة الاختبار…" : dataMode === "demo" ? "الرجوع إلى البيانات الأساسية" : "الدخول إلى البيانات التجريبية"}</button></div>}
    </section>
  </div>;
}

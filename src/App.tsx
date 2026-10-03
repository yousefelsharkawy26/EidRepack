import { useEffect, useState } from "react";
import {
  AuthStatus,
  bridge,
  callOperation,
  ipcErrorMessage,
  loadSnapshot,
  SessionUser,
} from "./lib/api";
import { nav, type Screen } from "./lib/types";
import { AppState } from "./lib/domain";
import { canAccess, roleLabel } from "./lib/helpers";
import Dashboard from "./pages/Dashboard";
import SalesWorkspace from "./pages/SalesWorkspace";
import Purchases from "./pages/Purchases";
import PackingWorkspace from "./pages/PackingWorkspace";
import Customers from "./pages/Customers";
import Suppliers from "./pages/Suppliers";
import Inventory from "./pages/Inventory";
import Collections from "./pages/Collections";
import Reminders from "./pages/Reminders";
import Reports from "./pages/Reports";
import SettingsPage from "./pages/SettingsPage";
import BootstrapScreen from "./pages/BootstrapScreen";
import LoginScreen from "./pages/LoginScreen";
import { Bell, CheckCircle2, LogOut, Search } from "lucide-react";
import SearchResults from "./components/SearchResult";

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [phase, setPhase] = useState<
    "loading" | "bootstrap" | "login" | "ready" | "import-failed"
  >("loading");
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");

  const notify = (message: string) => setToast(message);

  const refresh = async () => {
    setState(await loadSnapshot());
  };

  // Every mutation goes through a backend operation, then the whole UI state
  // is reloaded from SQLite — the database is the single source of truth.
  const run = async (
    action: () => Promise<unknown>,
    successMessage?: string,
  ) => {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      await refresh();
      if (successMessage) notify(successMessage);
      return true;
    } catch (error) {
      notify(ipcErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const boot = async () => {
      let authStatus: AuthStatus;
      try {
        authStatus = await bridge().auth.status();
      } catch {
        setPhase("import-failed");
        setStatus({
          needsBootstrap: false,
          legacyImport: {
            status: "failed",
            message:
              "واجهة النظام غير متاحة؛ هذا الإصدار يعمل فقط داخل تطبيق سطح المكتب.",
          },
        });
        return;
      }
      setStatus(authStatus);
      if (authStatus.legacyImport.status === "failed") {
        setPhase("import-failed");
        return;
      }
      if (authStatus.needsBootstrap) {
        setPhase("bootstrap");
        return;
      }
      try {
        const session = await bridge().auth.session();
        setCurrentUser(session);
        await refresh();
        setPhase("ready");
        if (authStatus.legacyImport.status === "matched")
          notify(
            "تم ترحيل بيانات الإصدار السابق إلى النظام الجديد بنجاح، مع نسخة احتياطية تلقائية.",
          );
      } catch {
        setPhase("login");
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!currentUser) return;
      if (event.key === "F2" && canAccess(currentUser.permissions.screens, "sales")) {
        event.preventDefault();
        setScreen("sales");
      }
      if (event.key === "F3" && canAccess(currentUser.permissions.screens, "purchases")) {
        event.preventDefault();
        setScreen("purchases");
      }
      if (event.key === "F4" && canAccess(currentUser.permissions.screens, "packing")) {
        event.preventDefault();
        setScreen("packing");
      }
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentUser]);
  useEffect(() => {
    if (currentUser && !canAccess(currentUser.permissions.screens, screen))
      setScreen("dashboard");
  }, [currentUser, screen]);

  const openBackup = async () => {
    try {
      const result = await bridge().createBackup();
      notify(
        result ? "تم إنشاء نسخة احتياطية بنجاح." : "تم إلغاء النسخ الاحتياطي.",
      );
    } catch (error) {
      notify(ipcErrorMessage(error));
    }
  };
  const logout = async () => {
    try {
      await bridge().auth.logout();
    } catch {
      /* session may already be gone */
    }
    setCurrentUser(null);
    setState(null);
    setPhase("login");
  };
  const renderScreen = () => {
    if (!state || !currentUser || !canAccess(currentUser.permissions.screens, screen))
      return null;
    switch (screen) {
      case "dashboard":
        return (
          <Dashboard
            state={state}
            onNavigate={setScreen}
            canSeeProfit={currentUser.role === "owner"}
          />
        );
      case "sales":
        return (
          <SalesWorkspace state={state} run={run} busy={busy} notify={notify} />
        );
      case "purchases":
        return (
          <Purchases state={state} run={run} busy={busy} notify={notify} />
        );
      case "packing":
        return (
          <PackingWorkspace
            state={state}
            run={run}
            busy={busy}
            currentUser={currentUser}
            notify={notify}
          />
        );
      case "customers":
        return (
          <Customers
            state={state}
            run={run}
            busy={busy}
            currentUser={currentUser}
            notify={notify}
          />
        );
      case "suppliers":
        return (
          <Suppliers
            state={state}
            run={run}
            busy={busy}
            currentUser={currentUser}
            notify={notify}
          />
        );
      case "inventory":
        return (
          <Inventory
            state={state}
            run={run}
            busy={busy}
            currentUser={currentUser}
            notify={notify}
          />
        );
      case "collections":
        return (
          <Collections
            state={state}
            run={run}
            busy={busy}
            currentUser={currentUser}
            notify={notify}
          />
        );
      case "reminders":
        return (
          <Reminders state={state} run={run} busy={busy} notify={notify} />
        );
      case "reports":
        return <Reports state={state} currentUser={currentUser} />;
      case "settings":
        return (
          <SettingsPage
            state={state}
            run={run}
            busy={busy}
            currentUser={currentUser}
            onBackup={openBackup}
            notify={notify}
          />
        );
    }
  };
  if (phase === "loading")
    return <div className="app-loader">جارٍ فتح بيانات المنشأة…</div>;
  if (phase === "import-failed")
    return (
      <main className="login-page" dir="rtl">
        <section className="login-card">
          <div className="login-brand">
            <div className="brand-mark">م</div>
            <div>
              <h1>مدير التعبئة</h1>
              <p>تعذر فتح البيانات</p>
            </div>
          </div>
          <div className="login-copy">
            <h2>مشكلة في ترحيل البيانات القديمة</h2>
            <p>
              {status?.legacyImport.message ||
                "حدث خطأ غير متوقع أثناء تجهيز قاعدة البيانات."}
            </p>
            {status?.legacyImport.backupPath && (
              <p style={{ fontSize: 11, color: "#788982" }}>
                نسخة احتياطية قبل الترحيل: {status.legacyImport.backupPath}
              </p>
            )}
          </div>
          <p className="login-security">
            لم تُفقد أي بيانات؛ أعد تشغيل التطبيق أو راجع الدعم الفني مع رسالة
            الخطأ أعلاه.
          </p>
        </section>
      </main>
    );
  if (phase === "bootstrap")
    return (
      <BootstrapScreen
        onDone={async (user, companyName) => {
          setCurrentUser(user);
          if (companyName.trim())
            await run(() =>
              callOperation("saveSetting", {
                key: "company_name",
                value: companyName.trim(),
              }),
            );
          await refresh();
          setPhase("ready");
        }}
      />
    );
  if (phase === "login" || !currentUser || !state)
    return (
      <LoginScreen
        onLogin={async (user) => {
          setCurrentUser(user);
          await refresh();
          setPhase("ready");
          if (status?.legacyImport.status === "matched")
            notify(
              "تم ترحيل بيانات الإصدار السابق إلى النظام الجديد بنجاح، مع نسخة احتياطية تلقائية.",
            );
        }}
      />
    );
  const visibleNav = nav.filter((item) =>
    canAccess(currentUser.permissions.screens, item.key),
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">م</div>
          <div>
            <h1>مدير التعبئة</h1>
            <small>Repack Manager · إصدار ١.٠</small>
          </div>
        </div>
        {["نظرة عامة", "العمليات", "العلاقات المالية", "الإدارة"].map(
          (group) =>
            visibleNav.some((item) => item.group === group) && (
              <div key={group}>
                <div className="nav-group">{group}</div>
                <nav className="nav">
                  {visibleNav
                    .filter((item) => item.group === group)
                    .map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.key}
                          className={screen === item.key ? "active" : ""}
                          onClick={() => setScreen(item.key)}
                        >
                          <Icon size={17} />
                          {item.label}
                          {item.key === "reminders" &&
                            state.reminders.filter(
                              (r) => r.status === "pending",
                            ).length > 0 && (
                              <span className="badge">
                                {
                                  state.reminders.filter(
                                    (r) => r.status === "pending",
                                  ).length
                                }
                              </span>
                            )}
                        </button>
                      );
                    })}
                </nav>
              </div>
            ),
        )}
        <div className="profile">
          <div className="avatar">{currentUser.displayName.slice(0, 2)}</div>
          <div>
            <b>{currentUser.displayName}</b>
            <span>{roleLabel(currentUser.role)}</span>
          </div>
          <button
            className="profile-logout"
            onClick={() => {
              void logout();
            }}
            aria-label="تسجيل الخروج"
            title="تسجيل الخروج"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <div className="breadcrumb">
              مدير التعبئة / {nav.find((item) => item.key === screen)?.label}
            </div>
            <h1 className="page-title">
              {nav.find((item) => item.key === screen)?.label}
            </h1>
          </div>
          <div className="top-actions">
            <div className="search">
              <Search size={17} />
              <input
                id="global-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث عن صنف أو عميل أو فاتورة…"
              />
              <kbd>Ctrl K</kbd>
            </div>
            {canAccess(currentUser.permissions.screens, "reminders") && (
              <button
                className="icon-button"
                aria-label="الإشعارات"
                onClick={() => setScreen("reminders")}
              >
                <Bell size={18} />
                <i />
              </button>
            )}
          </div>
        </header>
        {search && (
          <SearchResults
            state={state}
            query={search}
            onPick={(next) => {
              setSearch("");
              if (canAccess(currentUser.permissions.screens, next)) setScreen(next);
            }}
          />
        )}
        {renderScreen()}
      </main>
      {toast && (
        <div className="toast">
          <CheckCircle2
            size={15}
            style={{ verticalAlign: "middle", marginLeft: 7 }}
          />
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;

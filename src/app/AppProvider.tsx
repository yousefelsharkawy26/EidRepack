import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { bridge, ipcErrorMessage, loadSnapshot, type AuthStatus, type SessionUser } from "../lib/api";
import type { AppState } from "../lib/domain";
import { run as runCommand, type CommandMap, type CommandName } from "../shared/api/commands";
import { clearQuery, invalidate, useQuery } from "../shared/api/queryCache";
import type { Screen } from "./screens";

export type AppPhase = "loading" | "bootstrap" | "login" | "ready" | "import-failed";
export interface RunOptions { invalidates?: readonly string[]; message?: string }
type RunFeedback = string | RunOptions;

interface AppContextValue {
  state: AppState | null;
  refresh: () => Promise<void>;
  run: <K extends CommandName>(channel: K, input: CommandMap[K]["input"], feedback?: RunFeedback) => Promise<{ ok: true; data: CommandMap[K]["output"] } | false>;
  busy: boolean;
  notify: (message: string) => void;
  toast: string;
  currentUser: SessionUser | null;
  permissions: SessionUser["permissions"] | null;
  phase: AppPhase;
  status: AuthStatus | null;
  setCurrentUser: (user: SessionUser | null) => void;
  setPhase: (phase: AppPhase) => void;
  login: (user: SessionUser) => Promise<void>;
  logout: () => Promise<void>;
  saveBootstrapCompany: (user: SessionUser, companyName: string) => Promise<void>;
  createBackup: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  screen: Screen;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [screen, setScreen] = useState<Screen>("dashboard");

  const { data: snapshot, refetch: refetchSnapshot } = useQuery("snapshot", loadSnapshot, phase === "ready");
  const state: AppState | null = snapshot ?? null;
  const notify = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(async () => {
    invalidate(["snapshot"]);
    await refetchSnapshot();
  }, [refetchSnapshot]);

  const run = useCallback(async <K extends CommandName>(
    channel: K,
    input: CommandMap[K]["input"],
    feedback?: RunFeedback,
  ): Promise<{ ok: true; data: CommandMap[K]["output"] } | false> => {
    if (busy) return false;
    setBusy(true);
    try {
      const data = await runCommand(channel, input);
      const invalidatedKeys = typeof feedback === "string" ? ["snapshot"] : feedback?.invalidates ?? ["snapshot"];
      invalidate(invalidatedKeys);
      if (invalidatedKeys.includes("snapshot")) await refetchSnapshot();
      const successMessage = typeof feedback === "string" ? feedback : feedback?.message;
      if (successMessage) notify(successMessage);
      return { ok: true, data };
    } catch (error) {
      notify(ipcErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, notify, refetchSnapshot]);

  const login = useCallback(async (user: SessionUser) => {
    setCurrentUser(user);
    await refresh();
    setPhase("ready");
    if (status?.legacyImport.status === "matched") notify("تم ترحيل بيانات الإصدار السابق إلى النظام الجديد بنجاح، مع نسخة احتياطية تلقائية.");
  }, [refresh, status, notify]);

  const logout = useCallback(async () => {
    try { await bridge().auth.logout(); } catch { /* session may already be gone */ }
    setCurrentUser(null);
    clearQuery("snapshot");
    setPhase("login");
  }, []);

  const saveBootstrapCompany = useCallback(async (user: SessionUser, companyName: string) => {
    setCurrentUser(user);
    if (companyName.trim()) {
      await run("settings:save", { key: "company_name", value: companyName.trim() });
    }
    await refresh();
    setPhase("ready");
  }, [refresh, run]);

  const createBackup = useCallback(async () => {
    try {
      const result = await bridge().createBackup();
      notify(result ? "تم إنشاء نسخة احتياطية بنجاح." : "تم إلغاء النسخ الاحتياطي.");
    } catch (error) {
      notify(ipcErrorMessage(error));
    }
  }, [notify]);

  useEffect(() => {
    const boot = async () => {
      let authStatus: AuthStatus;
      try {
        authStatus = await bridge().auth.status();
      } catch {
        setPhase("import-failed");
        setStatus({ needsBootstrap: false, legacyImport: { status: "failed", message: "واجهة النظام غير متاحة؛ هذا الإصدار يعمل فقط داخل تطبيق سطح المكتب." } });
        return;
      }
      setStatus(authStatus);
      if (authStatus.legacyImport.status === "failed") { setPhase("import-failed"); return; }
      if (authStatus.needsBootstrap) { setPhase("bootstrap"); return; }
      try {
        const user = await bridge().auth.session();
        if (!user) { setPhase("login"); return; }
        setCurrentUser(user);
        await refresh();
        setPhase("ready");
        if (authStatus.legacyImport.status === "matched") notify("تم ترحيل بيانات الإصدار السابق إلى النظام الجديد بنجاح، مع نسخة احتياطية تلقائية.");
      } catch { setPhase("login"); }
    };
    void boot();
  }, [notify, refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const value = useMemo<AppContextValue>(() => ({
    state, refresh, run, busy, notify, toast, currentUser,
    permissions: currentUser?.permissions ?? null, phase, status,
    setCurrentUser, setPhase, login, logout, saveBootstrapCompany,
    createBackup, setScreen, screen,
  }), [state, refresh, run, busy, notify, toast, currentUser, phase, status, login, logout, saveBootstrapCompany, createBackup, screen]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}

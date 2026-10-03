// Typed bridge between the renderer and the Electron main process.
// Phase B rule: the UI never stores business state; every mutation is an
// operation call, and every read is a fresh snapshot from SQLite.
import type { AppState, Item } from "./domain";
import type { Screen } from "../app/screens";
import type { SnapshotEnvelope } from "../shared/api/snapshot-types";
import { mapSnapshot } from "../shared/api/mapSnapshot";
import { toEgp, toMinor } from "../shared/lib/money";
import { toBase } from "../shared/lib/units";
export { toEgp, toMinor } from "../shared/lib/money";
export { toBase, toDisplay } from "../shared/lib/units";
export { mapSnapshot } from "../shared/api/mapSnapshot";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: AppState["users"][number]["role"];
  permissions: { commands: string[]; screens: Screen[] };
}

export interface AuthStatus {
  needsBootstrap: boolean;
  legacyImport: { status: string; code?: string; message?: string; backupPath?: string };
}

interface RepackBridge {
  auth: {
    bootstrap: (payload: { username: string; displayName: string; password: string; pin: string }) => Promise<SessionUser>;
    login: (payload: { username: string; password: string }) => Promise<SessionUser>;
    logout: () => Promise<boolean>;
    session: () => Promise<SessionUser | null>;
    status: () => Promise<AuthStatus>;
  };
  elevate: (payload: { pin: string; scope: "inventory-adjustment" | "customer-credit" }) => Promise<{ scope: string; expiresInSeconds: number }>;
  command: (name: string, payload: Record<string, unknown>) => Promise<{ ok: boolean; data: unknown }>;
  query: <T = unknown>(name: string, payload?: Record<string, unknown>) => Promise<T>;
  createBackup: () => Promise<string | false>;
  restoreBackup: () => Promise<boolean>;
  openWhatsApp: (phone: string, message: string) => Promise<void>;
  printHtml: (html: string) => Promise<boolean>;
}

declare global {
  interface Window { repack?: RepackBridge }
}

export function bridge(): RepackBridge {
  if (!window.repack) throw new Error("واجهة النظام غير متاحة؛ هذا الإصدار يعمل فقط داخل تطبيق سطح المكتب.");
  return window.repack;
}

// Electron wraps handler errors as "Error invoking remote method '…': Error: …".
export function ipcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const match = raw.match(/Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]+)$/);
  return (match?.[1] || raw).trim() || "حدث خطأ غير متوقع";
}

export async function loadSnapshot(): Promise<AppState> {
  const response = await bridge().query<SnapshotEnvelope>("query:snapshot");
  return mapSnapshot(response.snapshot);
}

// Display-unit prices may yield fractional piasters per base unit, so the
// authoritative line total—not a rounded unit price—is sent to the backend.
export function saleLinePayload(line: { itemId: string; qty: number; price: number }, items: Item[]) {
  const item = items.find((candidate) => candidate.id === line.itemId);
  const factor = item?.unitFactor || 1;
  return { itemId: line.itemId, quantity: toBase(line.qty, factor), lineTotalMinor: toMinor(line.qty * line.price) };
}

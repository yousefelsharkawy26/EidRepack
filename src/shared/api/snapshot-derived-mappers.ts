import type { AppState, AuditEntry, User } from "../../lib/domain";
import type { Snapshot } from "./snapshot-types";

export function mapAuditLog(rows: Snapshot["auditLog"]): AuditEntry[] {
  return rows.map((row) => ({
    id: row.id, at: row.at, userId: row.userId || "", userName: row.userName,
    action: row.action, entity: row.entity, entityId: row.entityId || "", detail: row.entityId || "",
  }));
}

export function mapUsers(rows: Snapshot["users"]): User[] {
  return rows.map((row) => ({
    id: row.id, username: row.username, displayName: row.display_name,
    role: row.role, active: Boolean(row.is_active),
  }));
}

export function activityFromAudit(audit: Snapshot["auditLog"]): AppState["activity"] {
  const titles: [RegExp, AppState["activity"][number]["type"]][] = [
    [/sale|بيع|فاتورة بيع/i, "sale"], [/packing|تعبئة/i, "packing"],
    [/purchase|شراء/i, "purchase"], [/payment|collect|دفع|تحصيل/i, "payment"],
  ];
  return audit.slice(0, 8).map((entry) => ({
    id: entry.id, title: entry.action,
    detail: `${entry.userName || "النظام"} · ${entry.entity} ${entry.entityId || ""}`.trim(),
    at: entry.at, type: titles.find(([pattern]) => pattern.test(entry.action))?.[1] || "payment",
  }));
}

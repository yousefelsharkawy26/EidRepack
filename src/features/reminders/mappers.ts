import type { MessageLog, MessageTemplate, Reminder, ReminderRule } from "../../lib/domain";
import type { Snapshot } from "../../shared/api/snapshot-types";

export function mapReminders(rows: Snapshot["reminders"]): Reminder[] {
  return rows.map((row) => ({
    id: row.id, saleId: row.saleId, customerId: row.customerId,
    ...(row.ruleId ? { ruleId: row.ruleId } : {}),
    ...(row.templateId ? { templateId: row.templateId } : {}),
    scheduledFor: row.scheduledFor, stage: row.stage, status: row.status as Reminder["status"],
    ...(row.sentAt ? { sentAt: row.sentAt } : {}),
  }));
}

export function mapReminderRules(rows: Snapshot["reminderRules"]): ReminderRule[] {
  return rows.map((row) => ({
    id: row.id, name: row.name, offsetDays: row.offsetDays, stage: row.stage,
    templateId: row.templateId || "", active: row.isActive,
  }));
}

export function mapMessageTemplates(rows: Snapshot["messageTemplates"]): MessageTemplate[] {
  return rows.map((row) => ({ id: row.id, name: row.name, stage: row.stage, body: row.body }));
}

export function mapMessageLog(rows: Snapshot["messageLog"]): MessageLog[] {
  return rows.map((row) => ({
    id: row.id, reminderId: row.reminderId || "", customerId: row.customerId || "",
    body: row.body, status: row.status === "failed" ? "failed" : "sent", createdAt: row.createdAt,
  }));
}

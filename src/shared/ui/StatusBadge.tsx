export const statusClass = (status: string) =>
  status === "paid" || status === "confirmed" || status === "sent"
    ? "green"
    : status === "overdue" ? "red" : "yellow";

export const statusLabel = (status: string) =>
  ({ draft: "مسودة", confirmed: "غير مدفوعة", partial: "مدفوعة جزئيًا", paid: "مدفوعة", overdue: "متأخرة", pending: "بانتظار الإرسال", sent: "تم الإرسال", skipped: "تم التخطي", cancelled: "أُلغي" }[status] || status);

export default function StatusBadge({ status }: { status: string }) {
  return <span className={"status " + statusClass(status)}>{statusLabel(status)}</span>;
}

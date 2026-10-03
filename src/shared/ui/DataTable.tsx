import type { ReactNode } from "react";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
}

export function DataTable<Row>({ rows, columns, rowKey, emptyMessage, className = "" }: {
  rows: Row[]; columns: DataTableColumn<Row>[]; rowKey: (row: Row) => string;
  emptyMessage: string; className?: string;
}) {
  return <div className={`data-table ${className}`.trim()}>
    {rows.length ? <table>
      <thead><tr>{columns.map((column) => <th key={column.key}>{column.header}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key}>{column.cell(row)}</td>)}</tr>)}</tbody>
    </table> : <EmptyState>{emptyMessage}</EmptyState>}
  </div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}

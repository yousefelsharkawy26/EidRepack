import { useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal";
import type { AppState, StockMovement } from "../../lib/domain";
import { quantity } from "../../lib/domain";
import { bridge, ipcErrorMessage } from "../../lib/api";
import { PaginationBar, type PageState } from "../../shared/ui/Pagination";

export default function MovementsLog({ state, open, onClose, movementLabel }: { state: AppState; open: boolean; onClose: () => void; movementLabel: (type: string) => string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Array<StockMovement & { itemName: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagination = useMemo<PageState>(() => ({ page: currentPage, pageCount, pageSize, total, setPage, setPageSize }), [currentPage, pageCount, pageSize, total]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    bridge().query<{ rows: Array<{ id:string; item_id:string; item_name:string; lot_id:string|null; movement_type:string; qty_base:number; balance_after_base:number; ref_type:string|null; ref_id:string|null; notes:string|null; created_at:string; cost_minor?:number }>; total:number }>("inventory:movements", { limit:pageSize, cursor:String((currentPage - 1) * pageSize) })
      .then(result => {
        if (!active) return;
        const itemById = new Map(state.items.map(item => [item.id, item]));
        setRows(result.rows.map(row => {
          const factor = itemById.get(row.item_id)?.unitFactor || 1;
          return {
            id:row.id, itemId:row.item_id, itemName:row.item_name, ...(row.lot_id ? { lotId:row.lot_id } : {}),
            type:row.movement_type as StockMovement["type"], quantityChange:row.qty_base / factor,
            balanceAfter:row.balance_after_base / factor,
            unitCost:row.cost_minor != null && row.qty_base ? row.cost_minor / 100 / Math.abs(row.qty_base / factor) : 0,
            reference:row.ref_id || row.ref_type || "", note:row.notes || "", userId:"", at:row.created_at,
          };
        }));
        setTotal(result.total);
      })
      .catch(reason => { if (active) setError(ipcErrorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, currentPage, pageSize, state.items]);
  useEffect(() => { if (page !== currentPage) setPage(currentPage); }, [page, currentPage]);
  if (!open) return null;
  return <Modal wide title="سجل حركات المخزون" onClose={onClose}><p>سجل تدقيقي للقراءة فقط؛ لا يمكن حذف حركة منه.</p>{error && <div className="notice error-notice" role="alert">{error}</div>}{loading && <p className="text-secondary" role="status">جارٍ تحميل الحركات…</p>}<div className="ledger-table"><table>
    <thead><tr><th>الوقت</th><th>الحركة</th><th>الصنف</th><th>التغير</th><th>الرصيد بعد الحركة</th><th>المرجع</th><th>البيان</th></tr></thead>
    <tbody>{rows.map((movement) => {
      const item = state.items.find((entry) => entry.id === movement.itemId);
      return <tr key={movement.id}><td>{new Date(movement.at).toLocaleString("ar-EG")}</td>
        <td><span className={"status " + (movement.quantityChange < 0 ? "red" : "green")}>{movementLabel(movement.type)}</span></td>
        <td>{movement.itemName || item?.name || "صنف محذوف"}</td><td className={movement.quantityChange < 0 ? "report-negative" : "report-positive"}>{movement.quantityChange > 0 ? "+" : ""}{quantity(movement.quantityChange, item?.baseUnit)}</td>
        <td>{quantity(movement.balanceAfter, item?.baseUnit)}</td><td>{movement.reference}</td><td>{movement.note}</td></tr>;
    })}</tbody>
  </table>{!loading && rows.length === 0 && <p className="empty-state">لا توجد حركات مسجلة.</p>}<PaginationBar state={pagination}/></div></Modal>;
}

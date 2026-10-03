import Modal from "../../components/Modal";
import type { AppState } from "../../lib/domain";
import { quantity } from "../../lib/domain";

export default function MovementsLog({ state, open, onClose, movementLabel }: { state: AppState; open: boolean; onClose: () => void; movementLabel: (type: string) => string }) {
  if (!open) return null;
  return <Modal wide title="سجل حركات المخزون" onClose={onClose}><p>سجل تدقيقي للقراءة فقط؛ لا يمكن حذف حركة منه.</p><div className="ledger-table"><table>
    <thead><tr><th>الوقت</th><th>الحركة</th><th>الصنف</th><th>التغير</th><th>الرصيد بعد الحركة</th><th>المرجع</th><th>البيان</th></tr></thead>
    <tbody>{state.stockLedger.slice(0, 60).map((movement) => {
      const item = state.items.find((entry) => entry.id === movement.itemId);
      return <tr key={movement.id}><td>{new Date(movement.at).toLocaleString("ar-EG")}</td>
        <td><span className={"status " + (movement.quantityChange < 0 ? "red" : "green")}>{movementLabel(movement.type)}</span></td>
        <td>{item?.name || "صنف محذوف"}</td><td className={movement.quantityChange < 0 ? "report-negative" : "report-positive"}>{movement.quantityChange > 0 ? "+" : ""}{quantity(movement.quantityChange, item?.baseUnit)}</td>
        <td>{quantity(movement.balanceAfter, item?.baseUnit)}</td><td>{movement.reference}</td><td>{movement.note}</td></tr>;
    })}</tbody>
  </table></div></Modal>;
}

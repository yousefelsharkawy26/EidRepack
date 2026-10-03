import ReportKpi from "../components/ReportKpi";
import ReportRow from "../components/ReportRow";
import { SessionUser } from "../lib/api";
import { AppState, money, quantity, saleStatus, today } from "../lib/domain";

function Reports({
  state,
  currentUser,
}: {
  state: AppState;
  currentUser: SessionUser;
}) {
  const stockValue = state.items.reduce(
    (sum, item) => sum + item.stock * item.unitCost,
    0,
  );
  const cogs =
    state.sales.reduce(
      (sum, sale) =>
        sum +
        sale.lines.reduce(
          (lineTotal, line) => lineTotal + line.cost * line.qty,
          0,
        ),
      0,
    ) - state.salesReturns.reduce((sum, item) => sum + item.cost, 0);
  const grossSales = state.sales.reduce((sum, sale) => sum + sale.total, 0);
  const returnsValue = state.salesReturns.reduce(
    (sum, item) => sum + item.value,
    0,
  );
  const netSales = grossSales - returnsValue;
  const grossProfit = netSales - cogs;
  const receivables = state.customers.reduce(
    (sum, customer) => sum + customer.balance,
    0,
  );
  const overdue = state.sales
    .filter((sale) => saleStatus(sale) === "overdue")
    .reduce((sum, sale) => sum + sale.total - sale.paid, 0);
  const wasteByUnit = new Map<string, number>();
  state.packings.forEach((packing) => {
    const product = state.items.find((item) => item.id === packing.itemId);
    const rawLine = product?.recipe?.find((line) => line.kind === "raw");
    const unit =
      state.items.find((item) => item.id === rawLine?.itemId)?.baseUnit ||
      "وحدة";
    wasteByUnit.set(unit, (wasteByUnit.get(unit) || 0) + packing.waste);
  });
  const wasteLabel = wasteByUnit.size
    ? Array.from(wasteByUnit.entries())
        .map(([unit, value]) => quantity(value, unit))
        .join(" + ")
    : quantity(0);
  const productRows = state.items
    .filter((item) => item.type === "finished")
    .map((item) => {
      const sold = state.sales.flatMap((sale) =>
        sale.lines.filter((line) => line.itemId === item.id),
      );
      const returned = state.salesReturns.filter(
        (entry) => entry.itemId === item.id,
      );
      const qtySold =
        sold.reduce((sum, line) => sum + line.qty, 0) -
        returned.reduce((sum, entry) => sum + entry.quantity, 0);
      const revenue =
        sold.reduce((sum, line) => sum + line.price * line.qty, 0) -
        returned.reduce((sum, entry) => sum + entry.value, 0);
      const cost =
        sold.reduce((sum, line) => sum + line.cost * line.qty, 0) -
        returned.reduce((sum, entry) => sum + entry.cost, 0);
      return { item, qtySold, revenue, cost, profit: revenue - cost };
    });
  const exportCsv = () => {
    const rows = [
      ["الصنف", "الكمية الصافية", "صافي المبيعات", "التكلفة", "الربح"],
      ...productRows.map((row) => [
        row.item.name,
        String(row.qtySold),
        String(row.revenue),
        String(row.cost),
        String(row.profit),
      ]),
    ];
    const blob = new Blob(
      [
        "\uFEFF" +
          rows
            .map((row) =>
              row
                .map((value) => '"' + value.replace(/"/g, '""') + '"')
                .join(","),
            )
            .join("\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "repack-company-report-" + today() + ".csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="reports-page">
      <div className="section-header no-print">
        <div>
          <h2>التقارير والتحليلات</h2>
          <p>تقرير مرجعي احترافي جاهز للطباعة على ورق A4</p>
        </div>
        <div className="toolbar">
          <button className="secondary" onClick={exportCsv}>
            تصدير CSV
          </button>
          <button className="primary" onClick={() => window.print()}>
            طباعة التقرير الرسمي
          </button>
        </div>
      </div>
      <article className="professional-report" dir="rtl">
        <header className="report-header">
          <div className="report-brand">
            <div className="report-mark">م</div>
            <div>
              <h1>{state.settings.companyName}</h1>
              <p>نظام إدارة التجزئة والتعبئة</p>
            </div>
          </div>
          <div className="report-meta">
            <b>تقرير الأداء التشغيلي والمالي</b>
            <span>رقم التقرير: RPT-{today().replace(/-/g, "")}</span>
            <span>تاريخ الإصدار: {today()}</span>
          </div>
        </header>
        <div className="report-rule" />
        <div className="report-period">
          <span>الفترة: من بداية استخدام النظام حتى {today()}</span>
          <span>العملة: الجنيه المصري (EGP)</span>
          <span>مُنشأ آليًا من سجلات النظام · للاستخدام الداخلي</span>
        </div>
        <section className="report-section">
          <h2>الملخص التنفيذي</h2>
          <div className="report-kpis">
            <ReportKpi
              label="صافي المبيعات"
              value={money(netSales)}
              detail={"إجمالي قبل المرتجعات " + money(grossSales)}
            />
            <ReportKpi
              label="إجمالي الربح"
              value={money(grossProfit)}
              detail={
                "هامش الربح " +
                (netSales ? ((grossProfit / netSales) * 100).toFixed(1) : "0") +
                "%"
              }
            />
            <ReportKpi
              label="ذمم العملاء"
              value={money(receivables)}
              detail={"متأخر منها " + money(overdue)}
            />
            <ReportKpi
              label="قيمة المخزون"
              value={money(stockValue)}
              detail={quantity(state.items.length, "أصناف") + " فعالة"}
            />
          </div>
        </section>
        <section className="report-section">
          <div className="report-section-title">
            <h2>ربحية المنتجات</h2>
            <span>تفصيل صافي الأداء بعد المرتجعات</span>
          </div>
          <table className="report-table">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>الكمية الصافية</th>
                <th>صافي المبيعات</th>
                <th>تكلفة المبيعات</th>
                <th>الربح</th>
                <th>الهامش</th>
              </tr>
            </thead>
            <tbody>
              {productRows.map((row) => (
                <tr key={row.item.id}>
                  <td>
                    <b>{row.item.name}</b>
                    <small>{row.item.sku}</small>
                  </td>
                  <td>{quantity(row.qtySold, "عبوة")}</td>
                  <td>{money(row.revenue)}</td>
                  <td>{money(row.cost)}</td>
                  <td
                    className={
                      row.profit >= 0 ? "report-positive" : "report-negative"
                    }
                  >
                    {money(row.profit)}
                  </td>
                  <td>
                    {row.revenue
                      ? ((row.profit / row.revenue) * 100).toFixed(1) + "%"
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="report-columns">
          <section className="report-section">
            <div className="report-section-title">
              <h2>وضع المخزون</h2>
              <span>التكلفة الحالية</span>
            </div>
            <table className="report-table compact">
              <thead>
                <tr>
                  <th>الصنف</th>
                  <th>الرصيد</th>
                  <th>قيمة التكلفة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{quantity(item.stock, item.baseUnit)}</td>
                    <td>{money(item.stock * item.unitCost)}</td>
                    <td>
                      <span
                        className={
                          item.stock <= item.minStock
                            ? "report-alert"
                            : "report-ok"
                        }
                      >
                        {item.stock <= item.minStock ? "إعادة طلب" : "سليم"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="report-section">
            <div className="report-section-title">
              <h2>المؤشرات التشغيلية</h2>
              <span>التعبئة والتحصيل</span>
            </div>
            <div className="report-list">
              <ReportRow
                label="أوامر التعبئة المعتمدة"
                value={quantity(state.packings.length, "أمر")}
              />
              <ReportRow label="إجمالي الفاقد المسجل" value={wasteLabel} />
              <ReportRow label="مبيعات مرتجعة" value={money(returnsValue)} />
              <ReportRow
                label="فواتير متأخرة"
                value={quantity(
                  state.sales.filter((sale) => saleStatus(sale) === "overdue")
                    .length,
                  "فواتير",
                )}
              />
              <ReportRow label="الذمم المتأخرة" value={money(overdue)} />
            </div>
          </section>
        </div>
        <footer className="report-footer">
          <div>
            <span>أُعد التقرير بواسطة</span>
            <b>{currentUser.displayName || "مدير النظام"}</b>
          </div>
          <div>
            <span>اعتماد الإدارة</span>
            <b>__________________</b>
          </div>
          <div>
            <span>توقيع المسؤول المالي</span>
            <b>__________________</b>
          </div>
        </footer>
        <div className="report-disclaimer">
          هذا التقرير مستخرج من سجلات النظام المحلية بتاريخ {today()}، وهو مرجع
          تشغيلي داخلي للمنشأة.
        </div>
      </article>
    </section>
  );
}

export default Reports;

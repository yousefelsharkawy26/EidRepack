import { useState } from "react";
import {
  bridge,
  callOperation,
  ipcErrorMessage,
  SessionUser,
  toBase,
  toMinor,
} from "../lib/api";
import {
  AppState,
  daysFromNow,
  Item,
  ItemType,
  money,
  quantity,
} from "../lib/domain";
import { UNIT_FACTORS } from "../lib/types";
import { ClipboardList, Plus } from "lucide-react";
import Modal from "../components/Modal";

function Inventory({
  state,
  run,
  busy,
  currentUser,
  notify,
}: {
  state: AppState;
  run: (
    action: () => Promise<unknown>,
    successMessage?: string,
  ) => Promise<boolean>;
  busy: boolean;
  currentUser: SessionUser;
  notify: (message: string) => void;
}) {
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [showItemForm, setShowItemForm] = useState(false);
  const [itemName, setItemName] = useState("");
  const [itemSku, setItemSku] = useState("");
  const [itemType, setItemType] = useState<ItemType>("raw");
  const [baseUnit, setBaseUnit] = useState("كجم");
  const [minStock, setMinStock] = useState(0);
  const [initialStock, setInitialStock] = useState(0);
  const [unitCost, setUnitCost] = useState(0);
  const [salePrice, setSalePrice] = useState(0);
  const [recipeRawId, setRecipeRawId] = useState("");
  const [recipeRawQty, setRecipeRawQty] = useState(0.5);
  const [recipePackagingId, setRecipePackagingId] = useState("");
  const [recipePackagingQty, setRecipePackagingQty] = useState(1);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [counted, setCounted] = useState(0);
  const [pin, setPin] = useState("");
  const [showLedger, setShowLedger] = useState(false);
  const activeRawItems = state.items.filter(
    (item) => item.type === "raw" && item.active !== false,
  );
  const activePackagingItems = state.items.filter(
    (item) => item.type === "packaging" && item.active !== false,
  );
  const openItemForm = (item?: Item) => {
    setEditingItem(item || null);
    setItemName(item?.name || "");
    setItemSku(item?.sku || "");
    setItemType(item?.type || "raw");
    setBaseUnit(item?.baseUnit || "كجم");
    setMinStock(item?.minStock || 0);
    setInitialStock(item?.stock || 0);
    setUnitCost(item?.unitCost || 0);
    setSalePrice(item?.salePrice || 0);
    setRecipeRawId(
      item?.recipe?.find((line) => line.kind === "raw")?.itemId ||
        activeRawItems[0]?.id ||
        "",
    );
    setRecipeRawQty(
      item?.recipe?.find((line) => line.kind === "raw")?.qty || 0.5,
    );
    setRecipePackagingId(
      item?.recipe?.find((line) => line.kind === "packaging")?.itemId ||
        activePackagingItems[0]?.id ||
        "",
    );
    setRecipePackagingQty(
      item?.recipe?.find((line) => line.kind === "packaging")?.qty || 1,
    );
    setShowItemForm(true);
  };
  const saveItem = () => {
    const normalizedSku = itemSku.trim().toUpperCase();
    const numericValues = [
      minStock,
      unitCost,
      salePrice,
      ...(editingItem ? [] : [initialStock]),
    ];
    if (
      !itemName.trim() ||
      !normalizedSku ||
      numericValues.some((value) => !Number.isFinite(value) || value < 0)
    )
      return notify("أكمل بيانات الصنف وتأكد من أن الأرقام غير سالبة.");
    if (
      state.items.some(
        (item) =>
          item.sku.toUpperCase() === normalizedSku &&
          item.id !== editingItem?.id,
      )
    )
      return notify("كود الصنف مستخدم بالفعل؛ اختر كودًا آخر.");
    const factor = UNIT_FACTORS[baseUnit] || 1;
    const factorOf = (itemId: string) =>
      state.items.find((candidate) => candidate.id === itemId)?.unitFactor || 1;
    if (
      itemType === "finished" &&
      (!recipeRawId ||
        !recipePackagingId ||
        !Number.isFinite(recipeRawQty) ||
        !Number.isFinite(recipePackagingQty) ||
        recipeRawQty <= 0 ||
        recipePackagingQty <= 0)
    )
      return notify("حدد المادة الخام والتغليف وكميتهما لكل عبوة.");
    void run(
      async () => {
        const result = await callOperation("saveItem", {
          id: editingItem?.id,
          sku: normalizedSku,
          name: itemName.trim(),
          type: itemType,
          unitLabel: baseUnit,
          minStockBase: toBase(minStock, factor),
          defaultSalePriceMinor:
            itemType === "finished"
              ? Math.round((salePrice * 100) / factor)
              : 0,
          isActive: editingItem ? editingItem.active !== false : true,
        });
        const savedItemId = (result?.id as string) || editingItem?.id || "";
        if (itemType === "finished" && savedItemId) {
          await callOperation("saveRecipe", {
            finishedItemId: savedItemId,
            lines: [
              {
                componentItemId: recipeRawId,
                quantityPerUnitBase: toBase(
                  recipeRawQty,
                  factorOf(recipeRawId),
                ),
              },
              {
                componentItemId: recipePackagingId,
                quantityPerUnitBase: toBase(
                  recipePackagingQty,
                  factorOf(recipePackagingId),
                ),
              },
            ],
          });
        }
        if (!editingItem && initialStock > 0 && savedItemId) {
          await callOperation("createOpeningStock", {
            itemId: savedItemId,
            quantity: toBase(initialStock, factor),
            costMinor: toMinor(initialStock * unitCost),
            lotCode: "OPEN-" + normalizedSku,
            date: state.today,
          });
        }
      },
      editingItem
        ? "تم حفظ بيانات الصنف."
        : "تمت إضافة الصنف ورصيد افتتاحي للمخزون.",
    ).then((ok) => {
      if (ok) setShowItemForm(false);
    });
  };
  const toggleItemActive = (item: Item) => {
    if (currentUser.role !== "owner")
      return notify("إدارة كتالوج الأصناف متاحة للمالك فقط.");
    const active = item.active === false;
    void run(
      () =>
        callOperation("saveItem", {
          id: item.id,
          sku: item.sku,
          name: item.name,
          type: item.type,
          unitLabel: item.baseUnit,
          minStockBase: toBase(item.minStock, item.unitFactor || 1),
          defaultSalePriceMinor: Math.round(
            (item.salePrice * 100) / (item.unitFactor || 1),
          ),
          isActive: active,
        }),
      active ? "تم تفعيل الصنف." : "تم تعطيل الصنف وإخفاؤه من قوائم الاختيار.",
    );
  };
  const adjust = async () => {
    const item = state.items.find((candidate) => candidate.id === adjusting);
    if (!item || !Number.isFinite(counted) || counted < 0)
      return notify("أدخل كمية فعلية صحيحة.");
    const deltaBase = Math.round(
      (counted - item.stock) * (item.unitFactor || 1),
    );
    if (!deltaBase)
      return notify("لا يوجد فرق قابل للتسجيل بين الجرد والرصيد الحالي.");
    try {
      await bridge().elevate({ pin, scope: "inventory-adjustment" });
    } catch (error) {
      notify(ipcErrorMessage(error));
      return;
    }
    void run(
      () =>
        callOperation("adjustStock", {
          itemId: item.id,
          quantityDelta: deltaBase,
          costMinor:
            deltaBase > 0
              ? toMinor((counted - item.stock) * item.unitCost)
              : undefined,
          lotCode: "ADJ-" + state.today,
          date: state.today,
        }),
      "تم اعتماد تسوية الجرد وتسجيلها في سجل التدقيق.",
    ).then((ok) => {
      if (ok) {
        setAdjusting(null);
        setPin("");
      }
    });
  };
  const nearExpiry = state.lots.filter(
    (lot) =>
      lot.quantity > 0 && lot.expiryDate && lot.expiryDate <= daysFromNow(90),
  );
  const movementLabel = (type: string) =>
    ({
      opening: "رصيد افتتاحي",
      purchase: "شراء",
      "purchase-return": "مرتجع مشتريات",
      "packing-consumption": "صرف تعبئة",
      "packing-production": "إنتاج تعبئة",
      sale: "بيع",
      "sales-return": "مرتجع مبيعات",
      adjustment: "تسوية جرد",
    })[type] || type;
  return (
    <>
      <div className="section-header">
        <div>
          <h2>المخزون والدفعات</h2>
          <p>الأرصدة الفعلية، كتالوج الأصناف، تسويات الجرد، والصلاحية</p>
        </div>
        <div className="toolbar">
          {currentUser.role === "owner" && (
            <button className="primary" onClick={() => openItemForm()}>
              <Plus size={15} /> صنف جديد
            </button>
          )}
          <button className="secondary" onClick={() => setShowLedger(true)}>
            <ClipboardList size={15} /> سجل الحركات
          </button>
          <button
            className="secondary"
            onClick={() => {
              const first = state.items[0];
              if (first) {
                setAdjusting(first.id);
                setCounted(first.stock);
              }
            }}
          >
            <Plus size={15} /> تسوية جرد
          </button>
        </div>
      </div>
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th>الصنف</th>
              <th>النوع</th>
              <th>الرصيد الحالي</th>
              <th>الحد الأدنى</th>
              <th>متوسط التكلفة</th>
              <th>قيمة المخزون</th>
              <th>الحالة</th>
              <th>إدارة</th>
            </tr>
          </thead>
          <tbody>
            {state.items.map((item) => (
              <tr
                key={item.id}
                className={item.active === false ? "inactive-item" : ""}
              >
                <td className="name-cell">
                  <b>{item.name}</b>
                  <small>
                    {item.sku} · {item.baseUnit}
                  </small>
                </td>
                <td>
                  {item.type === "raw"
                    ? "مادة خام"
                    : item.type === "packaging"
                      ? "تغليف"
                      : "منتج جاهز"}
                </td>
                <td>{quantity(item.stock, item.baseUnit)}</td>
                <td>{quantity(item.minStock, item.baseUnit)}</td>
                <td>{money(item.unitCost)}</td>
                <td>{money(item.stock * item.unitCost)}</td>
                <td>
                  <span
                    className={
                      "status " +
                      (item.active === false
                        ? "gray"
                        : item.stock <= item.minStock
                          ? "red"
                          : item.stock <= item.minStock * 1.5
                            ? "yellow"
                            : "green")
                    }
                  >
                    {item.active === false
                      ? "معطل"
                      : item.stock <= item.minStock
                        ? "أعد الطلب"
                        : "سليم"}
                  </span>
                </td>
                <td style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <button
                    className="secondary"
                    onClick={() => {
                      setAdjusting(item.id);
                      setCounted(item.stock);
                    }}
                  >
                    جرد
                  </button>
                  {currentUser.role === "owner" && (
                    <>
                      <button
                        className="secondary"
                        onClick={() => openItemForm(item)}
                      >
                        تعديل
                      </button>
                      <button
                        className="secondary"
                        onClick={() => toggleItemActive(item)}
                      >
                        {item.active === false ? "تفعيل" : "تعطيل"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="split">
        <section className="card">
          <div className="card-title">
            <h3>قيمة المخزون</h3>
          </div>
          <strong style={{ fontSize: 25 }}>
            {money(
              state.items.reduce(
                (sum, item) => sum + item.stock * item.unitCost,
                0,
              ),
            )}
          </strong>
          <p style={{ color: "#7b8c85", fontSize: 11 }}>
            بالتكلفة · طريقة الاحتساب: متوسط مرجح متحرك
          </p>
        </section>
        <section className="card">
          <div className="card-title">
            <h3>تنبيهات الدفعات والصلاحية</h3>
          </div>
          {nearExpiry.length ? (
            nearExpiry.map((lot) => (
              <div className="notice" key={lot.id}>
                <b>
                  {state.items.find((item) => item.id === lot.itemId)?.name} ·{" "}
                  {lot.code}
                </b>
                <span>
                  ينتهي في {lot.expiryDate} · المتبقي {quantity(lot.quantity)}
                </span>
              </div>
            ))
          ) : (
            <p style={{ color: "#7b8c85", fontSize: 11 }}>
              لا توجد دفعات تقترب من انتهاء الصلاحية.
            </p>
          )}
        </section>
      </div>
      {showItemForm && (
        <Modal
          wide
          title={editingItem ? "تعديل بيانات الصنف" : "إضافة صنف جديد"}
          onClose={() => setShowItemForm(false)}
        >
          <div className="item-form-grid">
            <div className="field">
              <label>اسم الصنف</label>
              <input
                autoFocus
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                placeholder="مثال: أرز بسمتي"
              />
            </div>
            <div className="field">
              <label>كود الصنف SKU</label>
              <input
                value={itemSku}
                onChange={(event) => setItemSku(event.target.value)}
                placeholder="SKU-RICE-001"
              />
            </div>
            <div className="field">
              <label>نوع الصنف</label>
              <select
                value={itemType}
                onChange={(event) =>
                  setItemType(event.target.value as ItemType)
                }
              >
                <option value="raw">مادة خام</option>
                <option value="packaging">مادة تغليف</option>
                <option value="finished">منتج جاهز</option>
              </select>
            </div>
            <div className="field">
              <label>وحدة القياس الأساسية</label>
              <select
                value={baseUnit}
                onChange={(event) => setBaseUnit(event.target.value)}
              >
                {Object.keys(UNIT_FACTORS).map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>الحد الأدنى للمخزون</label>
              <input
                type="number"
                min="0"
                value={minStock}
                onChange={(event) => setMinStock(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label>تكلفة الوحدة</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={unitCost}
                onChange={(event) => setUnitCost(Number(event.target.value))}
              />
            </div>
            {itemType === "finished" && (
              <div className="field">
                <label>سعر البيع</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={salePrice}
                  onChange={(event) => setSalePrice(Number(event.target.value))}
                />
              </div>
            )}
            {!editingItem && (
              <div className="field">
                <label>رصيد افتتاحي</label>
                <input
                  type="number"
                  min="0"
                  value={initialStock}
                  onChange={(event) =>
                    setInitialStock(Number(event.target.value))
                  }
                />
              </div>
            )}
          </div>
          {itemType === "finished" && (
            <section className="recipe-editor">
              <h4>وصفة العبوة</h4>
              <p>المقادير المستهلكة لإنتاج عبوة واحدة</p>
              <div className="item-form-grid">
                <div className="field">
                  <label>المادة الخام</label>
                  <select
                    value={recipeRawId}
                    onChange={(event) => setRecipeRawId(event.target.value)}
                  >
                    {activeRawItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>كمية الخام لكل عبوة</label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={recipeRawQty}
                    onChange={(event) =>
                      setRecipeRawQty(Number(event.target.value))
                    }
                  />
                </div>
                <div className="field">
                  <label>مادة التغليف</label>
                  <select
                    value={recipePackagingId}
                    onChange={(event) =>
                      setRecipePackagingId(event.target.value)
                    }
                  >
                    {activePackagingItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>كمية التغليف لكل عبوة</label>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={recipePackagingQty}
                    onChange={(event) =>
                      setRecipePackagingQty(Number(event.target.value))
                    }
                  />
                </div>
              </div>
            </section>
          )}
          <div className="modal-actions">
            <button className="primary" onClick={saveItem}>
              حفظ الصنف
            </button>
            <button
              className="secondary"
              onClick={() => setShowItemForm(false)}
            >
              إلغاء
            </button>
          </div>
        </Modal>
      )}
      {showLedger && (
        <Modal
          wide
          title="سجل حركات المخزون"
          onClose={() => setShowLedger(false)}
        >
          <p>سجل تدقيقي للقراءة فقط؛ لا يمكن حذف حركة منه.</p>
          <div className="ledger-table">
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>الحركة</th>
                  <th>الصنف</th>
                  <th>التغير</th>
                  <th>الرصيد بعد الحركة</th>
                  <th>المرجع</th>
                  <th>البيان</th>
                </tr>
              </thead>
              <tbody>
                {state.stockLedger.slice(0, 60).map((movement) => {
                  const ledgerItem = state.items.find(
                    (item) => item.id === movement.itemId,
                  );
                  return (
                    <tr key={movement.id}>
                      <td>{new Date(movement.at).toLocaleString("ar-EG")}</td>
                      <td>
                        <span
                          className={
                            "status " +
                            (movement.quantityChange < 0 ? "red" : "green")
                          }
                        >
                          {movementLabel(movement.type)}
                        </span>
                      </td>
                      <td>{ledgerItem?.name || "صنف محذوف"}</td>
                      <td
                        className={
                          movement.quantityChange < 0
                            ? "report-negative"
                            : "report-positive"
                        }
                      >
                        {movement.quantityChange > 0 ? "+" : ""}
                        {quantity(
                          movement.quantityChange,
                          ledgerItem?.baseUnit,
                        )}
                      </td>
                      <td>
                        {quantity(movement.balanceAfter, ledgerItem?.baseUnit)}
                      </td>
                      <td>{movement.reference}</td>
                      <td>{movement.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
      {adjusting && (
        <Modal title="تسوية جرد حساسة" onClose={() => setAdjusting(null)}>
          <p>ستُسجَّل الفروقات في سجل التدقيق ولا يمكن حذف السجل.</p>
          <div className="field">
            <label>الكمية الفعلية</label>
            <input
              autoFocus
              type="number"
              min="0"
              value={counted}
              onChange={(event) => setCounted(Number(event.target.value))}
            />
          </div>
          <div className="field" style={{ marginTop: 11 }}>
            <label>PIN المالك</label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="••••"
            />
          </div>
          <div className="modal-actions">
            <button
              className="primary"
              onClick={() => {
                void adjust();
              }}
              disabled={busy}
            >
              اعتماد التسوية
            </button>
            <button className="danger" onClick={() => setAdjusting(null)}>
              إلغاء
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default Inventory;

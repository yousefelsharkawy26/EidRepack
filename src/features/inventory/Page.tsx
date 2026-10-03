import { useState } from "react";
import {
  bridge,
  ipcErrorMessage,
  toBase,
  toMinor,
} from "../../lib/api";
import { useApp } from "../../app/AppProvider";
import {
  daysFromNow,
  Item,
  ItemType,
  money,
  quantity,
} from "../../lib/domain";
import { UNIT_FACTORS } from "../../lib/types";
import { Plus } from "lucide-react";
import StockTable from "./StockTable";
import ItemEditor from "./ItemEditor";
import LotsTable from "./LotsTable";
import MovementsLog from "./MovementsLog";
import AdjustmentDialog from "./AdjustmentDialog";
import InventoryHeader from "./InventoryHeader";
import { useInventoryDraft } from "./useInventoryDraft";
import InvoiceHistoryTable from "./InvoiceHistoryTable";
import PurchaseHistoryTable from "./PurchaseHistoryTable";

type InventoryTable = "items" | "sales" | "purchases";

function Inventory() {
  const { state: snapshot, run, busy, currentUser: session, notify } = useApp();
  const {
    editingItem, setEditingItem, showItemForm, setShowItemForm, itemName, setItemName, itemSku, setItemSku,
    itemType, setItemType, baseUnit, setBaseUnit, minStock, setMinStock, initialStock, setInitialStock,
    unitCost, setUnitCost, salePrice, setSalePrice, recipeLines, setRecipeLines,
    adjusting, setAdjusting, counted, setCounted, pin, setPin, showLedger, setShowLedger,
  } = useInventoryDraft();
  const state = snapshot;
  const [activeTable, setActiveTable] = useState<InventoryTable>("items");
  if (!state || !session) return null;
  const currentUser = session;
  const canViewSales = currentUser.role === "owner";
  const canViewPurchases = currentUser.role === "owner" || currentUser.role === "purchasing";
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
    setRecipeLines(item?.recipe?.length ? item.recipe.map(line => ({ ...line })) : [
      ...(activeRawItems[0] ? [{ itemId: activeRawItems[0].id, qty: 0.5, kind: "raw" as const }] : []),
      ...(activePackagingItems[0] ? [{ itemId: activePackagingItems[0].id, qty: 1, kind: "packaging" as const }] : []),
    ]);
    setShowItemForm(true);
  };
  // UX hint — backend is authoritative.
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
    if (itemType === "finished") {
      const itemIds = recipeLines.map(line => line.itemId);
      if (!recipeLines.some(line => line.kind === "raw") || !recipeLines.some(line => line.kind === "packaging"))
        return notify("أضف مادة خام واحدة ومادة تغليف واحدة على الأقل للوصفة.");
      if (recipeLines.some(line => !line.itemId || !Number.isFinite(line.qty) || line.qty <= 0) || new Set(itemIds).size !== itemIds.length)
        return notify("راجع مكونات الوصفة؛ الكمية يجب أن تكون موجبة وكل مكون فريدًا.");
    }
    void run("item:save", {
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
        })
      .then(async (result) => {
        if (!result || !result.ok) return;
        const savedItemId = ((result.data as { id?: string }).id) || editingItem?.id || "";
        if (itemType === "finished" && savedItemId) {
          const recipeResult = await run("recipe:save", {
            finishedItemId: savedItemId,
            lines: recipeLines.map(line => ({
              componentItemId: line.itemId,
              quantityPerUnitBase: toBase(line.qty, factorOf(line.itemId)),
              lineType: line.kind,
            })),
          });
          if (!recipeResult) return;
        }
        if (!editingItem && initialStock > 0 && savedItemId) {
          const stockResult = await run("inventory:opening", {
            itemId: savedItemId,
            quantity: toBase(initialStock, factor),
            costMinor: toMinor(initialStock * unitCost),
            lotCode: "OPEN-" + normalizedSku,
            date: state.today,
          });
          if (!stockResult) return;
        }
        notify(editingItem ? "تم حفظ بيانات الصنف." : initialStock > 0 ? "تمت إضافة الصنف ورصيد افتتاحي للمخزون." : "تمت إضافة الصنف بنجاح.");
        setShowItemForm(false);
    });
  };
  const toggleItemActive = (item: Item) => {
    if (currentUser.role !== "owner")
      return notify("إدارة كتالوج الأصناف متاحة للمالك فقط.");
    const active = item.active === false;
    void run(
      "item:save",
      {
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
      },
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
      "inventory:adjust",
      {
          itemId: item.id,
          quantityDelta: deltaBase,
          costMinor:
            deltaBase > 0
              ? toMinor((counted - item.stock) * item.unitCost)
              : undefined,
          lotCode: "ADJ-" + state.today,
          date: state.today,
      },
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
      <InventoryHeader
        isOwner={currentUser.role === "owner"}
        onNewItem={() => openItemForm()}
        onLedger={() => setShowLedger(true)}
        onAdjust={() => { const first = state.items[0]; if (first) { setAdjusting(first.id); setCounted(first.stock); } }}
      />
      <div className="inventory-table-switcher" role="tablist" aria-label="جداول المخزون">
        <button id="inventory-table-items" role="tab" aria-selected={activeTable === "items"} className={activeTable === "items" ? "active" : ""} onClick={() => setActiveTable("items")}>الأصناف والمخزون <span>{state.items.length}</span></button>
        {canViewSales && <button id="inventory-table-sales" role="tab" aria-selected={activeTable === "sales"} className={activeTable === "sales" ? "active" : ""} onClick={() => setActiveTable("sales")}>فواتير البيع <span>{state.sales.length}</span></button>}
        {canViewPurchases && <button id="inventory-table-purchases" role="tab" aria-selected={activeTable === "purchases"} className={activeTable === "purchases" ? "active" : ""} onClick={() => setActiveTable("purchases")}>فواتير الشراء <span>{state.purchases.length}</span></button>}
      </div>
      {activeTable === "items" && <div role="tabpanel" aria-labelledby="inventory-table-items"><StockTable
        items={state.items}
        role={currentUser.role}
        onAdjust={(item) => { setAdjusting(item.id); setCounted(item.stock); }}
        onEdit={openItemForm}
        onToggleActive={toggleItemActive}
      /></div>}
      {activeTable === "sales" && canViewSales && <InvoiceHistoryTable state={state} busy={busy} />}
      {activeTable === "purchases" && canViewPurchases && <PurchaseHistoryTable state={state} />}
      <div className="split">
        <section className="card">
          <div className="card-title">
            <h3>قيمة المخزون</h3>
          </div>
          <strong className="inventory-total">
            {money(
              state.items.reduce(
                (sum, item) => sum + item.stock * item.unitCost,
                0,
              ),
            )}
          </strong>
          <p className="muted-empty">
            بالتكلفة · طريقة الاحتساب: متوسط مرجح متحرك
          </p>
        </section>
        <LotsTable state={state} lots={nearExpiry} />
      </div>
      <ItemEditor
        open={showItemForm}
        item={editingItem}
        onClose={() => setShowItemForm(false)}
        onSave={saveItem}
        name={itemName} setName={setItemName}
        sku={itemSku} setSku={setItemSku}
        type={itemType} setType={setItemType}
        unit={baseUnit} setUnit={setBaseUnit}
        minStock={minStock} setMinStock={setMinStock}
        cost={unitCost} setCost={setUnitCost}
        salePrice={salePrice} setSalePrice={setSalePrice}
        initialStock={initialStock} setInitialStock={setInitialStock}
        rawItems={activeRawItems} packagingItems={activePackagingItems}
        recipeLines={recipeLines} setRecipeLines={setRecipeLines}
      />
      <MovementsLog state={state} open={showLedger} onClose={() => setShowLedger(false)} movementLabel={movementLabel} />
      <AdjustmentDialog
        open={!!adjusting}
        counted={counted} setCounted={setCounted}
        pin={pin} setPin={setPin}
        busy={busy}
        onClose={() => setAdjusting(null)}
        onConfirm={() => { void adjust(); }}
      />
    </>
  );
}

export default Inventory;

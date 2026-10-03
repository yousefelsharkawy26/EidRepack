import { useState } from "react";
import type { Item, ItemType } from "../../lib/domain";

export function useInventoryDraft() {
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
  return {
    editingItem, setEditingItem, showItemForm, setShowItemForm, itemName, setItemName,
    itemSku, setItemSku, itemType, setItemType, baseUnit, setBaseUnit, minStock, setMinStock,
    initialStock, setInitialStock, unitCost, setUnitCost, salePrice, setSalePrice,
    recipeRawId, setRecipeRawId, recipeRawQty, setRecipeRawQty,
    recipePackagingId, setRecipePackagingId, recipePackagingQty, setRecipePackagingQty,
    adjusting, setAdjusting, counted, setCounted, pin, setPin, showLedger, setShowLedger,
  };
}

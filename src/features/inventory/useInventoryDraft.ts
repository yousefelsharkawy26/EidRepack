import { useState } from "react";
import type { Item, ItemType, RecipeLine } from "../../lib/domain";

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
  const [recipeLines, setRecipeLines] = useState<RecipeLine[]>([]);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [counted, setCounted] = useState(0);
  const [pin, setPin] = useState("");
  const [showLedger, setShowLedger] = useState(false);
  return {
    editingItem, setEditingItem, showItemForm, setShowItemForm, itemName, setItemName,
    itemSku, setItemSku, itemType, setItemType, baseUnit, setBaseUnit, minStock, setMinStock,
    initialStock, setInitialStock, unitCost, setUnitCost, salePrice, setSalePrice,
    recipeLines, setRecipeLines,
    adjusting, setAdjusting, counted, setCounted, pin, setPin, showLedger, setShowLedger,
  };
}

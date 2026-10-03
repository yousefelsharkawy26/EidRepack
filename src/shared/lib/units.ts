export const UNIT_FACTORS: Record<string, number> = {
  "كجم": 1000, "جرام": 1, "لتر": 1000, "مل": 1, "قطعة": 1, "عبوة": 1,
};

export const toBase = (displayQty: number, factor: number) => Math.round(displayQty * factor);
export const toDisplay = (baseQty: number, factor: number) => baseQty / factor;

export const quantity = (amount: number, unit = "") =>
  new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(amount) + (unit ? " " + unit : "");

import { lazy } from "react";
import { Bell, Boxes, FileBarChart, HandCoins, LayoutDashboard, PackageCheck, Settings, ShoppingBag, ShoppingCart, Users, Warehouse } from "lucide-react";

export const screens = {
  dashboard: { label: "الرئيسية", icon: LayoutDashboard, group: "نظرة عامة", component: lazy(() => import("../features/dashboard/Page")), shortcut: undefined },
  purchases: { label: "المشتريات", icon: ShoppingCart, group: "العمليات", component: lazy(() => import("../features/purchases/Page")), shortcut: "F3" },
  packing: { label: "التعبئة والتجزئة", icon: PackageCheck, group: "العمليات", component: lazy(() => import("../features/packing/Page")), shortcut: "F4" },
  inventory: { label: "المخزون والدفعات", icon: Warehouse, group: "العمليات", component: lazy(() => import("../features/inventory/Page")), shortcut: undefined },
  sales: { label: "المبيعات", icon: ShoppingBag, group: "العمليات", component: lazy(() => import("../features/sales/Page")), shortcut: "F2" },
  customers: { label: "العملاء", icon: Users, group: "العلاقات المالية", component: lazy(() => import("../features/customers/Page")), shortcut: undefined },
  suppliers: { label: "الموردون", icon: Boxes, group: "العلاقات المالية", component: lazy(() => import("../features/suppliers/Page")), shortcut: undefined },
  collections: { label: "التحصيل والمديونية", icon: HandCoins, group: "العلاقات المالية", component: lazy(() => import("../features/collections/Page")), shortcut: undefined },
  reminders: { label: "مركز التذكيرات", icon: Bell, group: "العلاقات المالية", component: lazy(() => import("../features/reminders/Page")), shortcut: undefined },
  reports: { label: "التقارير", icon: FileBarChart, group: "الإدارة", component: lazy(() => import("../features/reports/Page")), shortcut: undefined },
  settings: { label: "الإعدادات والنسخ", icon: Settings, group: "الإدارة", component: lazy(() => import("../features/settings/Page")), shortcut: undefined },
} as const;

export type Screen = keyof typeof screens;
export const screenKeys = Object.keys(screens) as Screen[];
export const screenGroups = [...new Set(screenKeys.map((key) => screens[key].group))];

export function visibleScreensFor(allowedScreens: readonly Screen[] | null | undefined) {
  if (!allowedScreens) return [];
  const allowed = new Set<Screen>(allowedScreens);
  return Object.entries(screens).filter(([key]) => allowed.has(key as Screen));
}

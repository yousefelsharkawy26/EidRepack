import { Bell, Boxes, FileBarChart, HandCoins, LayoutDashboard, PackageCheck, Settings, ShoppingBag, ShoppingCart, Users, Warehouse } from "lucide-react";

type Screen = 'dashboard' | 'purchases' | 'packing' | 'inventory' | 'sales' | 'customers' | 'suppliers' | 'collections' | 'reminders' | 'reports' | 'settings'

// Canonical display units the backend understands (label → base units per unit).
const UNIT_FACTORS: Record<string, number> = { 'كجم': 1000, 'جرام': 1, 'لتر': 1000, 'مل': 1, 'قطعة': 1, 'عبوة': 1 }

const nav: { key: Screen; label: string; icon: typeof LayoutDashboard; group?: string }[] = [
  { key: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard, group: 'نظرة عامة' },
  { key: 'purchases', label: 'المشتريات', icon: ShoppingCart, group: 'العمليات' },
  { key: 'packing', label: 'التعبئة والتجزئة', icon: PackageCheck, group: 'العمليات' },
  { key: 'inventory', label: 'المخزون والدفعات', icon: Warehouse, group: 'العمليات' },
  { key: 'sales', label: 'المبيعات', icon: ShoppingBag, group: 'العمليات' },
  { key: 'customers', label: 'العملاء', icon: Users, group: 'العلاقات المالية' },
  { key: 'suppliers', label: 'الموردون', icon: Boxes, group: 'العلاقات المالية' },
  { key: 'collections', label: 'التحصيل والمديونية', icon: HandCoins, group: 'العلاقات المالية' },
  { key: 'reminders', label: 'مركز التذكيرات', icon: Bell, group: 'العلاقات المالية' },
  { key: 'reports', label: 'التقارير', icon: FileBarChart, group: 'الإدارة' },
  { key: 'settings', label: 'الإعدادات والنسخ', icon: Settings, group: 'الإدارة' }
]

export { type Screen, UNIT_FACTORS, nav }
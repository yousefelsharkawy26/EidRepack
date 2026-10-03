export type CommandPayload = Record<string, unknown>

export interface ConfirmSaleInput extends CommandPayload {
  customerId: string
  number: string
  lines: Array<{
    itemId: string
    quantity: number
    unitPriceMinor?: number
    discountMinor?: number
    lineTotalMinor?: number
  }>
}

export interface CollectionInput extends CommandPayload {
  customerId: string
  amountMinor: number
  saleId?: string
  allocations?: Array<{ saleId: string; amountMinor: number }>
  method?: string
  date?: string
  reference?: string
  notes?: string
}

export interface CollectionResult {
  id: string
  allocatedMinor: number
  unappliedMinor: number
}

export interface CommandMap {
  'purchase:confirm': { input: CommandPayload; output: unknown }
  'purchase:return': { input: CommandPayload; output: unknown }
  'purchase-draft:save': { input: CommandPayload; output: unknown }
  'purchase-draft:delete': { input: CommandPayload; output: unknown }
  'supplier:pay': { input: CommandPayload; output: unknown }
  'supplier:save': { input: CommandPayload; output: unknown }
  'packing:confirm': { input: CommandPayload; output: unknown }
  'packing:cancel': { input: CommandPayload; output: unknown }
  'sale:confirm': { input: ConfirmSaleInput; output: { id: string; totalMinor: number; creditMinor: number } }
  'sale:return': { input: CommandPayload; output: unknown }
  'customer:collect': { input: CollectionInput; output: CollectionResult }
  'customer:promise': { input: CommandPayload; output: unknown }
  'customer:save': { input: CommandPayload; output: unknown }
  'customer:writeoff': { input: CommandPayload; output: unknown }
  'payment:reverse': { input: CommandPayload; output: unknown }
  'reminder:update': { input: CommandPayload; output: unknown }
  'reminder-rule:save': { input: CommandPayload; output: unknown }
  'reminder-template:save': { input: CommandPayload; output: unknown }
  'inventory:adjust': { input: CommandPayload; output: unknown }
  'inventory:opening': { input: CommandPayload; output: unknown }
  'item:save': { input: CommandPayload; output: unknown }
  'recipe:save': { input: CommandPayload; output: unknown }
  'user:save': { input: CommandPayload & { role: string }; output: unknown }
  'settings:save': { input: CommandPayload; output: unknown }
}

export type CommandName = keyof CommandMap

interface CommandBridge {
  command: (name: string, payload: CommandPayload) => Promise<{ ok: boolean; data: unknown }>
}

type WindowWithCommands = Window & { repack?: CommandBridge }

export async function run<K extends CommandName>(name: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']> {
  const repack = (window as WindowWithCommands).repack
  if (!repack) throw new Error('واجهة النظام غير متاحة؛ هذا الإصدار يعمل فقط داخل تطبيق سطح المكتب.')
  const response = await repack.command(name, { ...input, clientRequestId: crypto.randomUUID() })
  if (!response?.ok) throw new Error('رفض النظام العملية')
  return response.data as CommandMap[K]['output']
}

import type { AppState } from '../../lib/domain'

type ReportQuery = {
  from: string; to: string; today: string; companyName: string
  sales: Array<{ id: string; number: string; date: string; status: string; subtotal_minor: number; discount_minor: number; tax_minor: number; total_minor: number; gross_total_minor: number; paid_amount_minor: number; due_date: string | null; customer_name: string }>
  salesLines: Array<{ order_id: string; item_id: string; item_name: string; sku: string; type: string; qty_base: number; line_total_minor: number; cogs_total_minor: number }>
  salesReturns: Array<{ id: string; number: string; date: string; sales_order_id: string; item_id: string; qty_base: number; value_minor: number; cost_minor: number }>
  purchases: Array<{ supplier_id: string; supplier_name: string; invoice_count: number; total_minor: number; paid_minor: number; remaining_minor: number }>
  collections: Array<{ customer_id: string; customer_name: string; amount_minor: number; payment_count: number }>
  packings: Array<{ id: string; number: string; date: string; finished_item_id: string; item_name: string; produced_units: number; waste_qty_base: number; unit_cost_minor: number }>
  inventory: Array<{ id: string; name: string; sku: string; type: string; min_stock_base: number; unit: string; stock_base: number; stock_value_minor: number; unit_cost_minor: number }>
  customers: Array<{ id: string; name: string; balance_minor: number; overdue_minor: number; last_payment_date: string | null }>
}

const egp = (minor: number) => minor / 100

export function getReportData(query: ReportQuery, state: AppState) {
  const itemById = new Map(state.items.map(item => [item.id, item]))
  const grossSales = query.sales.reduce((sum, sale) => sum + sale.total_minor, 0)
  const returnsMinor = query.salesReturns.reduce((sum, line) => sum + line.value_minor, 0)
  const cogsMinor = query.salesLines.reduce((sum, line) => sum + line.cogs_total_minor, 0) - query.salesReturns.reduce((sum, line) => sum + line.cost_minor, 0)
  const netSalesMinor = grossSales - returnsMinor

  const productMap = new Map<string, { id: string; name: string; sku: string; quantityBase: number; revenueMinor: number; costMinor: number }>()
  const linesBySale = new Map<string, typeof query.salesLines>()
  for (const line of query.salesLines) {
    const bucket = linesBySale.get(line.order_id) || []
    bucket.push(line)
    linesBySale.set(line.order_id, bucket)
  }
  for (const sale of query.sales) {
    const lines = linesBySale.get(sale.id) || []
    const lineTotal = lines.reduce((sum, line) => sum + line.line_total_minor, 0)
    let allocatedRevenue = 0
    lines.forEach((line, index) => {
      const allocated = index === lines.length - 1 ? sale.total_minor - allocatedRevenue : lineTotal ? Math.round(sale.total_minor * line.line_total_minor / lineTotal) : 0
      allocatedRevenue += allocated
    const item = productMap.get(line.item_id) || { id: line.item_id, name: line.item_name, sku: line.sku, quantityBase: 0, revenueMinor: 0, costMinor: 0 }
    item.quantityBase += line.qty_base
    item.revenueMinor += allocated
    item.costMinor += line.cogs_total_minor
    productMap.set(line.item_id, item)
    })
  }
  for (const line of query.salesReturns) {
    const source = query.salesLines.find(saleLine => saleLine.item_id === line.item_id)
    const item = productMap.get(line.item_id) || { id: line.item_id, name: source?.item_name || itemById.get(line.item_id)?.name || 'صنف', sku: source?.sku || itemById.get(line.item_id)?.sku || '', quantityBase: 0, revenueMinor: 0, costMinor: 0 }
    item.quantityBase -= line.qty_base
    item.revenueMinor -= line.value_minor
    item.costMinor -= line.cost_minor
    productMap.set(line.item_id, item)
  }
  const products = [...productMap.values()].map(row => {
    const item = itemById.get(row.id)
    const quantity = row.quantityBase / (item?.unitFactor || 1)
    const revenue = egp(row.revenueMinor)
    const cost = egp(row.costMinor)
    return { ...row, quantity, revenue, cost, profit: revenue - cost, margin: revenue ? ((revenue - cost) / revenue) * 100 : 0, unit: item?.baseUnit || 'وحدة' }
  }).sort((a, b) => b.revenue - a.revenue)

  const dailyMap = new Map<string, { date: string; salesMinor: number; returnsMinor: number; invoices: number }>()
  for (const sale of query.sales) {
    const date = sale.date.slice(0, 10)
    const row = dailyMap.get(date) || { date, salesMinor: 0, returnsMinor: 0, invoices: 0 }
    row.salesMinor += sale.total_minor
    row.invoices += 1
    dailyMap.set(date, row)
  }
  for (const returned of query.salesReturns) {
    const date = returned.date.slice(0, 10)
    const row = dailyMap.get(date) || { date, salesMinor: 0, returnsMinor: 0, invoices: 0 }
    row.returnsMinor += returned.value_minor
    dailyMap.set(date, row)
  }
  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map(row => ({ ...row, sales: egp(row.salesMinor), returns: egp(row.returnsMinor), net: egp(row.salesMinor - row.returnsMinor) }))

  const stock = query.inventory.map(item => ({
    ...item,
    quantity: item.stock_base / (itemById.get(item.id)?.unitFactor || 1),
    unit: itemById.get(item.id)?.baseUnit || item.unit,
    value: egp(item.stock_value_minor),
    unitCost: egp(item.unit_cost_minor * (itemById.get(item.id)?.unitFactor || 1)),
    status: item.stock_base <= item.min_stock_base ? (item.stock_base === 0 ? 'نافد' : 'منخفض') : 'سليم'
  }))
  const wasteByUnit = new Map<string, number>()
  for (const packing of query.packings) {
    const finished = itemById.get(packing.finished_item_id)
    for (const raw of finished?.recipe?.filter(line => line.kind === 'raw') || []) {
      const rawItem = itemById.get(raw.itemId)
      const unit = rawItem?.baseUnit || 'وحدة'
      wasteByUnit.set(unit, (wasteByUnit.get(unit) || 0) + packing.waste_qty_base / (rawItem?.unitFactor || 1))
    }
  }
  const inventoryValue = query.inventory.reduce((sum, item) => sum + item.stock_value_minor, 0)
  const receivables = query.customers.reduce((sum, customer) => sum + customer.balance_minor, 0)
  const overdue = query.customers.reduce((sum, customer) => sum + customer.overdue_minor, 0)
  const purchaseMinor = query.purchases.reduce((sum, row) => sum + row.total_minor, 0)
  const collectionsMinor = query.collections.reduce((sum, row) => sum + row.amount_minor, 0)
  const packingRows = query.packings.map(row => {
    const finished = itemById.get(row.finished_item_id)
    const wasteDetails = (finished?.recipe?.filter(line => line.kind === 'raw') || []).map(line => {
      const rawItem = itemById.get(line.itemId)
      return `${rawItem?.name || 'خامة'}: ${row.waste_qty_base / (rawItem?.unitFactor || 1)} ${rawItem?.baseUnit || 'وحدة'}`
    }).join('، ') || '—'
    return { ...row, date: row.date.slice(0, 10), producedUnit: finished?.baseUnit || 'وحدة', wasteDetails }
  })
  return {
    from: query.from, to: query.to, today: query.today, companyName: query.companyName,
    sales: query.sales, returns: query.salesReturns, products, daily,
    purchases: query.purchases.map(row => ({ ...row, total: egp(row.total_minor), paid: egp(row.paid_minor), remaining: egp(row.remaining_minor) })),
    collections: query.collections.map(row => ({ ...row, amount: egp(row.amount_minor) })),
    packings: packingRows, inventory: stock,
    customers: query.customers.map(row => ({ ...row, balance: egp(row.balance_minor), overdue: egp(row.overdue_minor) })),
    summary: {
      grossSales: egp(grossSales), returns: egp(returnsMinor), netSales: egp(netSalesMinor), cogs: egp(cogsMinor),
      profit: egp(netSalesMinor - cogsMinor), margin: netSalesMinor ? ((netSalesMinor - cogsMinor) / netSalesMinor) * 100 : 0,
      purchases: egp(purchaseMinor), collections: egp(collectionsMinor), receivables: egp(receivables), overdue: egp(overdue), inventory: egp(inventoryValue)
    },
    operational: { packingCount: query.packings.length, producedUnits: query.packings.reduce((sum, row) => sum + row.produced_units, 0), wasteByUnit: [...wasteByUnit.entries()] }
  }
}

export type ReportData = ReturnType<typeof getReportData>

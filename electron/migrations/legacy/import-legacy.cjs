// One-time legacy import. Safe to delete after all installs migrated.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { applyMigrations, configureDatabase } = require('../runner.cjs')

const MIGRATION_KEY = 'legacy-app-state-v1'
const CANONICAL_UNITS = {
  weight: { id: 'unit-g', name: 'جرام', symbol: 'g' },
  volume: { id: 'unit-ml', name: 'ملليلتر', symbol: 'ml' },
  count: { id: 'unit-piece', name: 'قطعة', symbol: 'piece' }
}

class MigrationError extends Error {
  constructor(message, code = 'MIGRATION_FAILED', details = undefined) {
    super(message)
    this.name = 'MigrationError'
    this.code = code
    this.details = details
  }
}

function halfUp(numerator, denominator = 1n) {
  let n = BigInt(numerator)
  let d = BigInt(denominator)
  if (d <= 0n) throw new MigrationError('مقام التقريب يجب أن يكون موجبًا.', 'INVALID_ROUNDING')
  const sign = n < 0n ? -1n : 1n
  if (n < 0n) n = -n
  const rounded = (n + d / 2n) / d
  return sign * rounded
}

function decimalFraction(value, label) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new MigrationError(`${label}: قيمة رقمية غير صالحة.`, 'INVALID_NUMBER')
  const text = String(value).trim().toLowerCase()
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/)
  if (!match) throw new MigrationError(`${label}: تعذر قراءة العدد العشري (${text}).`, 'INVALID_NUMBER')
  const sign = match[1] === '-' ? -1n : 1n
  const fraction = match[3] || ''
  const exponent = Number(match[4] || 0)
  let numerator = BigInt((match[2] + fraction).replace(/^0+(?=\d)/, '')) * sign
  let denominator = 10n ** BigInt(fraction.length)
  if (exponent > 0) numerator *= 10n ** BigInt(exponent)
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent)
  return { numerator, denominator }
}

function safeInteger(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new MigrationError(`${label}: العدد خارج النطاق الصحيح الآمن (${value}).`, 'INTEGER_OVERFLOW')
  return number
}

function moneyMinor(value, label) {
  const { numerator, denominator } = decimalFraction(value, label)
  return safeInteger(halfUp(numerator * 100n, denominator), label)
}

function normalizedUnit(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '').replace(/[ـًٌٍَُِّْ]/g, '')
}

function unitInfo(value, label) {
  const original = String(value || '').trim()
  const normalized = normalizedUnit(original)
  const units = new Map([
    ['كجم', ['weight', 1000]], ['كيلو', ['weight', 1000]], ['كيلوجرام', ['weight', 1000]], ['كغ', ['weight', 1000]], ['kg', ['weight', 1000]], ['kgs', ['weight', 1000]],
    ['جم', ['weight', 1]], ['جرام', ['weight', 1]], ['غرام', ['weight', 1]], ['g', ['weight', 1]], ['gm', ['weight', 1]], ['gram', ['weight', 1]],
    ['مل', ['volume', 1]], ['ملليلتر', ['volume', 1]], ['مليلتر', ['volume', 1]], ['ml', ['volume', 1]],
    ['لتر', ['volume', 1000]], ['liter', ['volume', 1000]], ['litre', ['volume', 1000]], ['l', ['volume', 1000]],
    ['قطعة', ['count', 1]], ['عبوة', ['count', 1]], ['حبة', ['count', 1]], ['وحدة', ['count', 1]], ['علبة', ['count', 1]], ['pcs', ['count', 1]], ['piece', ['count', 1]], ['unit', ['count', 1]]
  ])
  const match = units.get(normalized)
  if (!match) throw new MigrationError(`${label}: وحدة غير معروفة «${original}»؛ حدّد تحويلها قبل الترحيل.`, 'UNKNOWN_UNIT')
  return { label: original, dimension: match[0], factor: match[1], canonical: CANONICAL_UNITS[match[0]] }
}

function baseQuantity(value, info, label) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new MigrationError(`${label}: الكمية يجب أن تكون رقمًا غير سالب.`, 'INVALID_QUANTITY')
  const { numerator, denominator } = decimalFraction(value, label)
  const baseNumerator = numerator * BigInt(info.factor)
  const nearestBig = halfUp(baseNumerator, denominator)
  const nearest = safeInteger(nearestBig, label)
  const differenceNumerator = baseNumerator - nearestBig * denominator
  const absoluteDifferenceNumerator = differenceNumerator < 0n ? -differenceNumerator : differenceNumerator
  const base = n * info.factor
  const difference = Math.abs(base - nearest)
  if (absoluteDifferenceNumerator * 1000n >= denominator) {
    throw new MigrationError(`${label}: ${value} ${info.label} = ${base} من الوحدة الأساسية؛ الباقي ${difference} يبلغ 0.001 أو أكثر.`, 'FRACTIONAL_BASE_QUANTITY', {
      label, sourceQuantity: value, sourceUnit: info.label, convertedBaseQuantity: base, nearestInteger: nearest, difference, tolerance: 0.001
    })
  }
  return safeInteger(nearest, label)
}

function dividedCost(totalMinor, remainingBase, initialBase) {
  if (remainingBase === 0) return 0
  if (remainingBase === initialBase) return totalMinor
  if (initialBase <= 0) return 0
  return safeInteger(halfUp(BigInt(totalMinor) * BigInt(remainingBase), BigInt(initialBase)), 'تكلفة المتبقي في الدفعة')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function nonArrayOrEmpty(state, key) {
  const value = state[key]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new MigrationError(`الحقل ${key} ليس مصفوفة في app_state.`, 'INVALID_LEGACY_STATE')
  return value
}

function dateValue(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback
  const text = String(value)
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text)) throw new MigrationError(`${label}: التاريخ ليس بصيغة ISO: ${text}`, 'INVALID_DATE')
  return text
}

function idValue(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') throw new MigrationError(`${label}: معرّف مطلوب.`, 'MISSING_ID')
  return String(value)
}

function insert(database, sql, values) {
  database.prepare(sql).run(...values)
}

function insertUnits(database, state, items, cache) {
  const canonicalInsert = database.prepare('INSERT OR IGNORE INTO units (id,name,symbol,dimension,is_canonical) VALUES (?,?,?,?,1)')
  for (const unit of Object.values(CANONICAL_UNITS)) canonicalInsert.run(unit.id, unit.name, unit.symbol, unit.id === 'unit-piece' ? 'count' : unit.id === 'unit-g' ? 'weight' : 'volume')
  const unitInsert = database.prepare('INSERT OR IGNORE INTO units (id,name,symbol,dimension,is_canonical) VALUES (?,?,?,?,0)')
  const conversionInsert = database.prepare('INSERT OR IGNORE INTO unit_conversions (id,from_unit_id,to_unit_id,factor_numerator,factor_denominator) VALUES (?,?,?,?,1)')
  for (const item of items) {
    const info = unitInfo(item.baseUnit, `الصنف ${item.id} (${item.name})`)
    const digest = sha256(`${info.dimension}:${normalizedUnit(info.label)}`).slice(0, 20)
    const legacyId = `legacy-unit-${digest}`
    if (!cache.has(info.label)) {
      unitInsert.run(legacyId, info.label, `legacy:${digest}`, info.dimension)
      if (info.factor !== 1 || info.canonical.id !== legacyId) {
        conversionInsert.run(`conversion-${digest}`, legacyId, info.canonical.id, info.factor)
      }
      cache.set(info.label, { ...info, legacyId })
    }
  }
}

function addCounts(state) {
  const keys = ['sales', 'purchases', 'packings', 'purchaseReturns', 'salesReturns', 'customerPayments', 'supplierPayments', 'purchaseDrafts', 'reminders', 'promises']
  return Object.fromEntries(keys.map(key => [key, nonArrayOrEmpty(state, key).length]))
}

function amountSum(rows, field, label) {
  return rows.reduce((sum, row, index) => sum + moneyMinor(row[field] ?? 0, `${label}[${index}].${field}`), 0)
}

function seededDemoState(state) {
  const demoSales = new Set(['sal-001','sal-002'])
  const demoPurchases = new Set(['pur-001'])
  const demoPackings = new Set(['pck-001'])
  return nonArrayOrEmpty(state, 'sales').some(row => demoSales.has(row.id) || ['INV-2026-0001','INV-2026-0002'].includes(row.number))
    || nonArrayOrEmpty(state, 'purchases').some(row => demoPurchases.has(row.id) || row.number === 'PUR-2026-0001')
    || nonArrayOrEmpty(state, 'packings').some(row => demoPackings.has(row.id) || row.number === 'PCK-2026-0001')
}

function sourceAppState(database) {
  const table = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('app_state','legacy_app_state') ORDER BY CASE name WHEN 'app_state' THEN 0 ELSE 1 END LIMIT 1").get()
  if (!table) throw new MigrationError('لم يُعثر على app_state؛ لن تُنشأ بيانات تجريبية أو تُدمج.', 'APP_STATE_NOT_FOUND')
  const row = database.prepare(`SELECT payload, updated_at FROM "${table.name}" WHERE id = 1`).get()
  if (!row || typeof row.payload !== 'string') throw new MigrationError('قاعدة المصدر لا تحتوي صف app_state للمستخدم.', 'APP_STATE_EMPTY')
  let state
  try { state = JSON.parse(row.payload) } catch (error) {
    throw new MigrationError(`تعذر تحليل JSON في app_state: ${error.message}`, 'INVALID_LEGACY_JSON')
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new MigrationError('app_state ليس كائن حالة صالحًا.', 'INVALID_LEGACY_STATE')
  return { tableName: table.name, payload: row.payload, updatedAt: row.updated_at, state }
}

function insertBaseLookups(database, state, migrationDate, maps) {
  const items = nonArrayOrEmpty(state, 'items')
  maps.units = new Map()
  insertUnits(database, state, items, maps.units)

  for (const user of nonArrayOrEmpty(state, 'users')) {
    insert(database, 'INSERT INTO users (id,username,display_name,role,password_hash,pin_hash,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [
      idValue(user.id, 'user.id'), String(user.username || user.id), String(user.displayName || user.username || user.id), user.role || 'owner',
      String(user.passwordHash || ''), user.pinHash || null, user.active === false ? 0 : 1, migrationDate, migrationDate
    ])
  }

  for (const [key, dimension] of [['suppliers','supplier'],['customers','customer']]) {
    for (const entry of nonArrayOrEmpty(state, key)) {
      if (dimension === 'supplier') {
        insert(database, 'INSERT INTO suppliers (id,name,phone,whatsapp,address,default_credit_days,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [
          idValue(entry.id, 'supplier.id'), String(entry.name || ''), String(entry.phone || ''), entry.whatsapp || null, entry.address || null,
          Math.max(0, safeInteger(entry.creditDays || 0, `supplier ${entry.id} creditDays`)), entry.notes || null, 1, migrationDate, migrationDate
        ])
      } else {
        insert(database, 'INSERT INTO customers (id,name,phone,whatsapp,credit_limit_minor,credit_days,is_blocked,block_reason,reminder_enabled,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
          idValue(entry.id, 'customer.id'), String(entry.name || ''), String(entry.phone || ''), String(entry.whatsapp || ''),
          Math.max(0, moneyMinor(entry.creditLimit || 0, `customer ${entry.id} creditLimit`)), Math.max(0, safeInteger(entry.creditDays || 0, `customer ${entry.id} creditDays`)),
          entry.blocked ? 1 : 0, null, 1, null, 1, migrationDate, migrationDate
        ])
      }
    }
  }

  for (const item of items) {
    const info = maps.units.get(item.baseUnit)
    const recipe = Array.isArray(item.recipe) ? item.recipe : []
    const rawLine = recipe.find(line => line.kind === 'raw')
    const rawComponent = rawLine && items.find(candidate => candidate.id === rawLine.itemId)
    const packSizeBase = rawLine && rawComponent
      ? baseQuantity(rawLine.qty, unitInfo(rawComponent.baseUnit, `الوصفة ${item.id}`), `recipe ${item.id} pack size`)
      : null
    insert(database, 'INSERT INTO items (id,sku,name,type,base_unit_id,legacy_unit_id,pack_size_base,min_stock_base,default_sale_price_minor,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      idValue(item.id, 'item.id'), String(item.sku || item.id), String(item.name || ''), item.type, info.canonical.id, info.legacyId, packSizeBase,
      baseQuantity(item.minStock || 0, info, `item ${item.id} minStock`), Math.max(0, moneyMinor(item.salePrice || 0, `item ${item.id} salePrice`)),
      item.active === false ? 0 : 1, migrationDate, migrationDate
    ])
  }

  const itemById = new Map(items.map(item => [item.id, item]))
  for (const item of items) {
    for (const [index, line] of (Array.isArray(item.recipe) ? item.recipe : []).entries()) {
      const component = itemById.get(line.itemId)
      if (!component) throw new MigrationError(`recipe ${item.id}[${index}] يشير إلى صنف غير موجود ${line.itemId}.`, 'BROKEN_REFERENCE')
      const componentUnit = unitInfo(component.baseUnit, `recipe ${item.id}[${index}]`)
      insert(database, 'INSERT INTO item_recipe_lines (id,finished_item_id,component_item_id,qty_per_unit_base,line_type,extra_cost_minor) VALUES (?,?,?,?,?,0)', [
        `${item.id}:recipe:${index}`, item.id, component.id, baseQuantity(line.qty, componentUnit, `recipe ${item.id}[${index}].qty`), line.kind
      ])
    }
  }
}

function insertDocuments(database, state, migrationDate, maps) {
  const customers = nonArrayOrEmpty(state, 'customers')
  const suppliers = nonArrayOrEmpty(state, 'suppliers')
  const items = nonArrayOrEmpty(state, 'items')
  maps.items = new Map(items.map(item => [item.id, item]))
  maps.sales = new Map(nonArrayOrEmpty(state, 'sales').map(sale => [sale.id, sale]))
  maps.purchases = new Map(nonArrayOrEmpty(state, 'purchases').map(purchase => [purchase.id, purchase]))
  maps.lots = new Map(nonArrayOrEmpty(state, 'lots').map(lot => [lot.id, lot]))
  maps.stockLotRows = new Map()
  maps.pendingPackingInputs = []

  for (const [index, purchase] of nonArrayOrEmpty(state, 'purchases').entries()) {
    const total = moneyMinor(purchase.total || 0, `purchase ${purchase.id} total`)
    const extra = moneyMinor(purchase.extraCosts || 0, `purchase ${purchase.id} extraCosts`)
    const paid = moneyMinor(purchase.paid || 0, `purchase ${purchase.id} paid`)
    const date = dateValue(purchase.date, migrationDate, `purchase ${purchase.id} date`)
    insert(database, 'INSERT INTO purchase_invoices (id,number,supplier_id,date,status,subtotal_minor,discount_minor,tax_minor,extra_costs_total_minor,total_minor,paid_amount_minor,initial_paid_amount_minor,due_date,supplier_invoice_number,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      idValue(purchase.id, `purchase[${index}].id`), String(purchase.number || purchase.id), idValue(purchase.supplierId, `purchase ${purchase.id} supplierId`), date,
      'confirmed', Math.max(0, total - extra), 0, 0, extra, total, paid, paid,
      purchase.dueDate ? dateValue(purchase.dueDate, migrationDate, `purchase ${purchase.id} dueDate`) : null,
      purchase.supplierInvoiceNumber || null, date, null
    ])
    if (paid > 0) {
      const paymentId = `purchase:${purchase.id}:initial-payment`
      insert(database, 'INSERT INTO payments (id,party_type,party_id,supplier_id,direction,amount_minor,method,date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [paymentId, 'supplier', purchase.supplierId, purchase.supplierId, 'out', paid, 'cash', date, 'دفعة عند اعتماد الفاتورة', date])
      insert(database, 'INSERT INTO payment_allocations (id,payment_id,doc_type,purchase_invoice_id,amount_minor,is_initial) VALUES (?,?,?,?,?,1)', [`allocation:${paymentId}`, paymentId, 'purchase', purchase.id, paid])
    }
    if (purchase.itemId && maps.items.has(purchase.itemId)) {
      const item = maps.items.get(purchase.itemId)
      const info = unitInfo(item.baseUnit, `purchase ${purchase.id} item`)
      const quantity = baseQuantity(purchase.quantity || 0, info, `purchase ${purchase.id} quantity`)
      const lineAmount = moneyMinor(Number(purchase.quantity || 0) * Number(purchase.unitCost || 0) - Number(purchase.extraCosts || 0), `purchase ${purchase.id} line total`)
      const safeLineAmount = Math.max(0, lineAmount)
      const lineId = `${purchase.id}:line:1`
      insert(database, 'INSERT INTO purchase_lines (id,invoice_id,item_id,qty_base,unit_input_id,line_total_minor,allocated_extra_cost_minor,landed_cost_total_minor) VALUES (?,?,?,?,?,?,?,?)', [
        lineId, purchase.id, purchase.itemId, quantity, maps.units.get(item.baseUnit).legacyId, safeLineAmount, extra, total
      ])
      if (extra > 0) insert(database, 'INSERT INTO purchase_extra_costs (id,invoice_id,label,amount_minor,allocation_method) VALUES (?,?,?,?,?)', [`${purchase.id}:extra:1`, purchase.id, 'مصاريف إضافية مرحّلة', extra, 'proportional'])
    }
  }

  for (const draft of nonArrayOrEmpty(state, 'purchaseDrafts')) {
    const item = maps.items.get(draft.itemId)
    if (!item) throw new MigrationError(`مسودة الشراء ${draft.id} تشير إلى صنف غير موجود.`, 'BROKEN_REFERENCE')
    const quantity = baseQuantity(draft.quantity, unitInfo(item.baseUnit, `draft ${draft.id}`), `draft ${draft.id} quantity`)
    insert(database, 'INSERT INTO purchase_drafts (id,number,supplier_id,item_id,date,quantity_base,unit_price_minor,extra_costs_minor,paid_amount_minor,supplier_invoice_number,due_date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      draft.id, draft.number || draft.id, draft.supplierId, draft.itemId, dateValue(draft.date, migrationDate, `draft ${draft.id} date`), quantity,
      moneyMinor(draft.unitPrice || 0, `draft ${draft.id} unitPrice`), moneyMinor(draft.extraCosts || 0, `draft ${draft.id} extraCosts`),
      moneyMinor(draft.paid || 0, `draft ${draft.id} paid`), draft.supplierInvoiceNumber || null, draft.dueDate || null, migrationDate
    ])
  }

  for (const packing of nonArrayOrEmpty(state, 'packings')) {
    const item = maps.items.get(packing.itemId)
    if (!item) throw new MigrationError(`أمر التعبئة ${packing.id} يشير إلى صنف غير موجود.`, 'BROKEN_REFERENCE')
    const units = baseQuantity(packing.units, unitInfo(item.baseUnit, `packing ${packing.id}`), `packing ${packing.id} units`)
    const totalCost = moneyMinor(Number(packing.unitCost || 0) * Number(packing.units || 0), `packing ${packing.id} cost`)
    const date = dateValue(packing.date, migrationDate, `packing ${packing.id} date`)
    insert(database, 'INSERT INTO packing_orders (id,number,date,finished_item_id,planned_units,produced_units,waste_qty_base,raw_cost_total_minor,packaging_cost_total_minor,unit_cost_minor,status,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      packing.id, packing.number || packing.id, date, packing.itemId, units, units,
      (() => { const raw = item.recipe?.find(line => line.kind === 'raw'); const rawItem = raw && maps.items.get(raw.itemId); return raw && rawItem ? baseQuantity(packing.waste || 0, unitInfo(rawItem.baseUnit, `packing ${packing.id} waste`), `packing ${packing.id} waste`) : 0 })(),
      0, 0, units > 0 ? moneyMinor(packing.unitCost || 0, `packing ${packing.id} unitCost`) : 0, 'confirmed', date, null
    ])
    const lot = nonArrayOrEmpty(state, 'lots').find(candidate => candidate.itemId === item.id && candidate.code === `LOT-${packing.number}`)
    if (lot) maps.stockLotRows.set(lot.id, { sourceType: 'packing', sourceId: packing.id, initialLegacyQty: packing.units, unitCost: lot.unitCost })
    for (const [index, allocation] of (packing.lotAllocations || []).entries()) maps.pendingPackingInputs.push({ packing, allocation, index })
  }

  for (const sale of nonArrayOrEmpty(state, 'sales')) {
    const saleReturns = nonArrayOrEmpty(state, 'salesReturns').filter(entry => entry.saleId === sale.id)
    const returnTotal = saleReturns.reduce((sum, entry) => sum + moneyMinor(entry.value || 0, `salesReturn ${entry.id} value`), 0)
    const currentTotal = moneyMinor(sale.total || 0, `sale ${sale.id} total`)
    const gross = currentTotal + returnTotal
    const lines = Array.isArray(sale.lines) ? sale.lines : []
    const date = dateValue(sale.date, migrationDate, `sale ${sale.id} date`)
    insert(database, 'INSERT INTO sales_orders (id,number,customer_id,date,status,subtotal_minor,discount_minor,tax_minor,gross_total_minor,total_minor,paid_amount_minor,initial_paid_amount_minor,credit_amount_minor,due_date,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      sale.id, sale.number || sale.id, sale.customerId, date, sale.status || 'confirmed', gross, 0, 0, gross, currentTotal,
      moneyMinor(sale.paid || 0, `sale ${sale.id} paid`), moneyMinor(sale.paid || 0, `sale ${sale.id} initial paid`), Math.max(0, currentTotal - moneyMinor(sale.paid || 0, `sale ${sale.id} paid`)),
      sale.dueDate ? dateValue(sale.dueDate, migrationDate, `sale ${sale.id} dueDate`) : null, date, null
    ])
    for (const [index, line] of lines.entries()) {
      const item = maps.items.get(line.itemId)
      if (!item) throw new MigrationError(`sale ${sale.id} line ${index} يشير إلى صنف غير موجود ${line.itemId}.`, 'BROKEN_REFERENCE')
      const qty = baseQuantity(line.qty, unitInfo(item.baseUnit, `sale ${sale.id} line ${index}`), `sale ${sale.id} line ${index} qty`)
      const price = moneyMinor(line.price || 0, `sale ${sale.id} line ${index} price`)
      const cost = moneyMinor(line.cost || 0, `sale ${sale.id} line ${index} cost`)
      insert(database, 'INSERT INTO sales_lines (id,order_id,item_id,lot_id,qty_base,unit_price_minor,discount_minor,line_total_minor,unit_cost_minor,cogs_total_minor) VALUES (?,?,?,?,?,?,?,?,?,?)', [
        `${sale.id}:line:${index + 1}`, sale.id, item.id, null, qty, price, 0, moneyMinor(Number(line.qty) * Number(line.price), `sale ${sale.id} line ${index} total`), cost,
        moneyMinor(Number(line.qty) * Number(line.cost || 0), `sale ${sale.id} line ${index} cogs`)
      ])
    }
  }
}

function sourceLotDetails(lot, state, maps) {
  const purchase = nonArrayOrEmpty(state, 'purchases').find(row => row.lotId === lot.id || (row.itemId === lot.itemId && lot.code === `LOT-${row.number}`))
  if (purchase) return { sourceType: 'purchase', sourceId: purchase.id, initialQuantity: purchase.quantity ?? lot.quantity }
  const packing = nonArrayOrEmpty(state, 'packings').find(row => lot.code === `LOT-${row.number}` && row.itemId === lot.itemId)
  if (packing) return { sourceType: 'packing', sourceId: packing.id, initialQuantity: packing.units }
  const type = ['purchase','packing','adjustment','opening','return'].includes(lot.source) ? lot.source : 'opening'
  return { sourceType: type, sourceId: null, initialQuantity: lot.quantity }
}

function insertLots(database, state, migrationDate, maps) {
  const sourceLots = nonArrayOrEmpty(state, 'lots')
  const lotInsert = database.prepare('INSERT INTO stock_lots (id,item_id,source_type,source_id,lot_code,qty_initial_base,qty_remaining_base,cost_total_minor,cost_remaining_minor,received_at,expiry_date,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)')
  const savedQuantityByItem = new Map()
  maps.openingLotsByItem = new Map()

  for (const lot of sourceLots) {
    const item = maps.items.get(lot.itemId)
    if (!item) throw new MigrationError(`دفعة ${lot.id} تشير إلى صنف غير موجود ${lot.itemId}.`, 'BROKEN_REFERENCE')
    const info = unitInfo(item.baseUnit, `lot ${lot.id}`)
    const remaining = baseQuantity(lot.quantity || 0, info, `lot ${lot.id} quantity`)
    const details = sourceLotDetails(lot, state, maps)
    const initial = baseQuantity(details.initialQuantity || 0, info, `lot ${lot.id} initial quantity`)
    if (initial < remaining) throw new MigrationError(`دفعة ${lot.id}: الكمية الابتدائية أقل من الكمية المتبقية.`, 'INVALID_LOT_BALANCE')
    const unitCost = Number(lot.unitCost ?? item.unitCost ?? 0)
    const totalMinor = moneyMinor(Number(details.initialQuantity || 0) * unitCost, `lot ${lot.id} total cost`)
    const remainingMinor = dividedCost(totalMinor, remaining, initial)
    lotInsert.run(idValue(lot.id, 'lot.id'), lot.itemId, details.sourceType, details.sourceId, String(lot.code || lot.id), initial, remaining,
      totalMinor, remainingMinor, dateValue(lot.receivedAt, migrationDate, `lot ${lot.id} receivedAt`), lot.expiryDate || null)
    savedQuantityByItem.set(item.id, (savedQuantityByItem.get(item.id) || 0) + remaining)
    maps.stockLotRows.set(lot.id, details)
  }
  maps.sourceLotQuantityByItem = savedQuantityByItem

  for (const packing of nonArrayOrEmpty(state, 'packings')) {
    const outputLot = sourceLots.find(lot => lot.itemId === packing.itemId && lot.code === `LOT-${packing.number}`)
    const quantity = baseQuantity(packing.units, unitInfo(maps.items.get(packing.itemId).baseUnit, `packing ${packing.id}`), `packing ${packing.id} units`)
    insert(database, 'INSERT INTO packing_outputs (id,order_id,item_id,qty_units,cost_total_minor,output_lot_id) VALUES (?,?,?,?,?,?)', [
      `${packing.id}:output:1`, packing.id, packing.itemId, quantity,
      moneyMinor(Number(packing.units) * Number(packing.unitCost || 0), `packing ${packing.id} output cost`), outputLot?.id || null
    ])
  }

  for (const { packing, allocation, index } of maps.pendingPackingInputs || []) {
    const inputItem = maps.items.get(allocation.itemId)
    if (!inputItem) throw new MigrationError(`packing ${packing.id} input ${index} يشير إلى صنف غير موجود.`, 'BROKEN_REFERENCE')
    const qty = baseQuantity(allocation.quantity, unitInfo(inputItem.baseUnit, `packing ${packing.id} input`), `packing ${packing.id} input ${index}`)
    const sourceLot = allocation.lotId ? maps.lots.get(allocation.lotId) : null
    const unitCost = sourceLot?.unitCost ?? inputItem.unitCost ?? 0
    insert(database, 'INSERT INTO packing_inputs (id,order_id,item_id,lot_id,qty_base,cost_minor) VALUES (?,?,?,?,?,?)', [
      `${packing.id}:input:${index}`, packing.id, inputItem.id, allocation.lotId || null, qty,
      moneyMinor(Number(allocation.quantity) * Number(unitCost), `packing ${packing.id} input cost`)
    ])
  }
}

function allocateLegacyFifo(database, state, migrationDate, maps) {
  const lotsInsert = database.prepare('INSERT INTO stock_lots (id,item_id,source_type,source_id,lot_code,qty_initial_base,qty_remaining_base,cost_total_minor,cost_remaining_minor,received_at,expiry_date,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,1)')
  const events = []
  const outflowByItem = new Map()
  const addEvent = event => {
    events.push(event)
    outflowByItem.set(event.itemId, (outflowByItem.get(event.itemId) || 0) + event.quantityBase)
  }
  for (const sale of nonArrayOrEmpty(state, 'sales')) {
    const date = dateValue(sale.date, migrationDate, `sale ${sale.id} date`)
    for (const [index, line] of (sale.lines || []).entries()) {
      const item = maps.items.get(line.itemId)
      if (!item) continue
      addEvent({ kind: 'sale', itemId: item.id, date, sale, line, lineIndex: index, quantityBase: baseQuantity(line.qty, unitInfo(item.baseUnit, `sale ${sale.id} line ${index}`), `sale ${sale.id} line ${index} qty`) })
    }
  }
  for (const movement of nonArrayOrEmpty(state, 'stockLedger')) {
    if (movement.type !== 'adjustment' || Number(movement.quantityChange) >= 0 || movement.lotId) continue
    const item = maps.items.get(movement.itemId)
    if (!item) continue
    addEvent({ kind: 'adjustment', itemId: item.id, date: dateValue(movement.at, migrationDate, `movement ${movement.id} at`), movement,
      quantityBase: baseQuantity(Math.abs(Number(movement.quantityChange)), unitInfo(item.baseUnit, `movement ${movement.id}`), `movement ${movement.id} quantity`) })
  }
  events.sort((first, second) => {
    const dateOrder = first.date.localeCompare(second.date)
    if (dateOrder) return dateOrder
    if (first.kind !== second.kind) return first.kind === 'sale' ? -1 : 1
    return String(first.sale?.id || first.movement?.id).localeCompare(String(second.sale?.id || second.movement?.id))
  })

  for (const item of nonArrayOrEmpty(state, 'items')) {
    const info = unitInfo(item.baseUnit, `item ${item.id}`)
    const currentStock = baseQuantity(item.stock || 0, info, `item ${item.id} stock`)
    const represented = maps.sourceLotQuantityByItem.get(item.id) || 0
    const outflow = outflowByItem.get(item.id) || 0
    const inferredOpening = currentStock + outflow - represented
    if (inferredOpening < 0) continue
    if (inferredOpening === 0) continue
    const earliestEvent = events.filter(event => event.itemId === item.id).map(event => event.date).sort()[0]
    const sourceOpening = nonArrayOrEmpty(state, 'stockLedger').find(movement => movement.itemId === item.id && movement.type === 'opening')
    const openedAt = sourceOpening ? dateValue(sourceOpening.at, migrationDate, `opening movement ${sourceOpening.id} at`) : earliestEvent || migrationDate
    const oldUnitQty = inferredOpening / info.factor
    const costMinor = moneyMinor(oldUnitQty * Number(item.unitCost || 0), `item ${item.id} inferred opening cost`)
    const lotId = `migration-opening-${sha256(item.id).slice(0, 16)}`
    const code = `MIG-OPEN-${String(item.sku || item.id).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32)}`
    lotsInsert.run(lotId, item.id, 'opening', null, code, inferredOpening, inferredOpening, costMinor, costMinor, openedAt)
    maps.openingLotsByItem.set(item.id, { lotId, initialQuantityBase: inferredOpening, balanceAfterBase: represented + inferredOpening, costMinor, openedAt })
    maps.generatedOpeningLots = (maps.generatedOpeningLots || 0) + 1
  }

  const readLots = database.prepare('SELECT id,lot_code,qty_remaining_base,cost_remaining_minor,received_at FROM stock_lots WHERE item_id=? AND qty_remaining_base>0 ORDER BY received_at,lot_code,id')
  const updateLot = database.prepare('UPDATE stock_lots SET qty_remaining_base=?,cost_remaining_minor=? WHERE id=?')
  maps.legacySalesLineAllocations = new Map()
  maps.salesMovementAllocations = new Map()
  maps.adjustmentLotAllocations = new Map()

  const consume = (event, requireSalesLine) => {
    let remaining = event.quantityBase
    const allocations = []
    for (const lot of readLots.all(event.itemId)) {
      if (String(lot.received_at).slice(0, 10) > String(event.date).slice(0, 10)) continue
      const used = Math.min(remaining, lot.qty_remaining_base)
      if (used <= 0) continue
      const cost = used === lot.qty_remaining_base ? lot.cost_remaining_minor : safeInteger(halfUp(BigInt(lot.cost_remaining_minor) * BigInt(used), BigInt(lot.qty_remaining_base)), `lot ${lot.id} consumed cost`)
      updateLot.run(lot.qty_remaining_base - used, lot.cost_remaining_minor - cost, lot.id)
      allocations.push({ lotId: lot.id, quantityBase: used, costMinor: cost })
      remaining -= used
      if (!remaining) break
    }
    if (remaining) {
      const description = event.kind === 'sale' ? `sale ${event.sale.number} line ${event.lineIndex + 1}` : `adjustment ${event.movement.id}`
      throw new MigrationError(`${description}: FIFO دفعات متاحة أقل من المطلوب بمقدار ${remaining} وحدة أساسية.`, 'FIFO_ALLOCATION_SHORTFALL', {
        itemId: event.itemId, document: description, requestedBase: event.quantityBase, unallocatedBase: remaining, date: event.date
      })
    }
    if (!requireSalesLine) return allocations

    const sale = event.sale
    const line = event.line
    const sourceLineId = `${sale.id}:line:${event.lineIndex + 1}`
    const fullQty = event.quantityBase
    const fullRevenue = moneyMinor(Number(line.qty) * Number(line.price), `sale ${sale.id} line ${event.lineIndex + 1} total`)
    let revenueRemaining = fullRevenue
    const prepared = allocations.map((allocation, index) => {
      const revenue = index === allocations.length - 1 ? revenueRemaining : safeInteger(halfUp(BigInt(fullRevenue) * BigInt(allocation.quantityBase), BigInt(fullQty)), `sale ${sale.id} line split`)
      revenueRemaining -= revenue
      return { ...allocation, revenueMinor: revenue, salesLineId: index === 0 ? sourceLineId : `${sourceLineId}:fifo:${index + 1}` }
    })
    const updateLine = database.prepare('UPDATE sales_lines SET lot_id=?,qty_base=?,line_total_minor=?,unit_cost_minor=?,cogs_total_minor=? WHERE id=?')
    const insertLine = database.prepare('INSERT INTO sales_lines (id,order_id,item_id,lot_id,qty_base,unit_price_minor,discount_minor,line_total_minor,unit_cost_minor,cogs_total_minor) VALUES (?,?,?,?,?, ?,0,?,?,?)')
    const sourceUnitPrice = moneyMinor(line.price || 0, `sale ${sale.id} line ${event.lineIndex + 1} price`)
    for (const [index, allocation] of prepared.entries()) {
      const unitCostMinor = safeInteger(halfUp(BigInt(allocation.costMinor), BigInt(allocation.quantityBase)), `sale ${sale.id} line unit cost`)
      if (index === 0) updateLine.run(allocation.lotId, allocation.quantityBase, allocation.revenueMinor, unitCostMinor, allocation.costMinor, allocation.salesLineId)
      else insertLine.run(allocation.salesLineId, sale.id, line.itemId, allocation.lotId, allocation.quantityBase, sourceUnitPrice, allocation.revenueMinor, unitCostMinor, allocation.costMinor)
    }
    const allocationKey = `${sale.id}:${event.lineIndex}`
    maps.legacySalesLineAllocations.set(allocationKey, prepared)
    const movementKey = `${sale.number}\u0000${event.itemId}`
    maps.salesMovementAllocations.set(movementKey, [...(maps.salesMovementAllocations.get(movementKey) || []), ...prepared])
    return prepared
  }

  for (const event of events) {
    const allocations = consume(event, event.kind === 'sale')
    if (event.kind === 'adjustment') maps.adjustmentLotAllocations.set(event.movement.id, allocations)
  }

  for (const item of nonArrayOrEmpty(state, 'items')) {
    const actual = database.prepare('SELECT COALESCE(SUM(qty_remaining_base),0) AS quantity FROM stock_lots WHERE item_id=? AND is_active=1').get(item.id).quantity
    const expected = baseQuantity(item.stock || 0, unitInfo(item.baseUnit, `item ${item.id}`), `item ${item.id} stock`)
    if (actual !== expected) throw new MigrationError(`الصنف ${item.id}: رصيد الدفعات بعد FIFO ${actual} لا يساوي الرصيد الحالي ${expected}.`, 'LOT_STOCK_MISMATCH', { itemId: item.id, expectedBase: expected, actualBase: actual })
  }
}

function insertReturns(database, state, migrationDate, maps) {
  for (const entry of nonArrayOrEmpty(state, 'purchaseReturns')) {
    const purchase = maps.purchases.get(entry.purchaseId)
    const item = maps.items.get(entry.itemId)
    if (!purchase || !item) throw new MigrationError(`مرتجع الشراء ${entry.id} لا يشير إلى فاتورة/صنف موجود.`, 'BROKEN_REFERENCE')
    const date = dateValue(entry.date, migrationDate, `purchase return ${entry.id} date`)
    insert(database, 'INSERT INTO returns (id,number,return_type,purchase_invoice_id,date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)', [
      entry.id, entry.number || entry.id, 'purchase', purchase.id, date, entry.reason || '', null, date
    ])
    insert(database, 'INSERT INTO return_lines (id,return_id,item_id,original_purchase_line_id,original_lot_id,qty_base,value_minor,cost_minor) VALUES (?,?,?,?,?,?,?,?)', [
      `${entry.id}:line:1`, entry.id, item.id, purchase.itemId ? `${purchase.id}:line:1` : null, maps.lots.has(purchase.lotId) ? purchase.lotId : null,
      baseQuantity(entry.quantity, unitInfo(item.baseUnit, `purchase return ${entry.id}`), `purchase return ${entry.id} quantity`),
      moneyMinor(entry.value || 0, `purchase return ${entry.id} value`), moneyMinor(entry.value || 0, `purchase return ${entry.id} cost`)
    ])
  }

  for (const entry of nonArrayOrEmpty(state, 'salesReturns')) {
    const sale = maps.sales.get(entry.saleId)
    const item = maps.items.get(entry.itemId)
    if (!sale || !item) throw new MigrationError(`مرتجع البيع ${entry.id} لا يشير إلى فاتورة/صنف موجود.`, 'BROKEN_REFERENCE')
    const date = dateValue(entry.date, migrationDate, `sales return ${entry.id} date`)
    insert(database, 'INSERT INTO returns (id,number,return_type,sales_order_id,date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)', [
      entry.id, entry.number || entry.id, 'sales', sale.id, date, entry.reason || '', null, date
    ])
    const saleLines = Array.isArray(sale.lines) ? sale.lines : []
    const matchingLine = saleLines.findIndex(line => line.itemId === entry.itemId)
    const allocations = matchingLine >= 0 ? maps.legacySalesLineAllocations.get(`${sale.id}:${matchingLine}`) || [] : []
    const originalSalesLineId = allocations.length === 1 ? allocations[0].salesLineId : null
    const originalLotId = allocations.length === 1 ? allocations[0].lotId : null
    const returnLot = nonArrayOrEmpty(state, 'lots').find(lot => lot.itemId === item.id && lot.source === 'return' && (lot.code === `RET-${entry.date}` || lot.code === `RET-${entry.number}`))
    insert(database, 'INSERT INTO return_lines (id,return_id,item_id,original_sales_line_id,original_lot_id,return_lot_id,qty_base,value_minor,cost_minor) VALUES (?,?,?,?,?,?,?,?,?)', [
      `${entry.id}:line:1`, entry.id, item.id, originalSalesLineId, originalLotId, returnLot?.id || null,
      baseQuantity(entry.quantity, unitInfo(item.baseUnit, `sales return ${entry.id}`), `sales return ${entry.id} quantity`),
      moneyMinor(entry.value || 0, `sales return ${entry.id} value`), moneyMinor(entry.cost || 0, `sales return ${entry.id} cost`)
    ])
  }
}

function insertPaymentsAndReminders(database, state, migrationDate, maps) {
  const userIds = new Set(nonArrayOrEmpty(state, 'users').map(user => String(user.id)))
  const validUser = id => id && userIds.has(String(id)) ? String(id) : null
  const customerIds = new Set(nonArrayOrEmpty(state, 'customers').map(customer => String(customer.id)))
  const supplierIds = new Set(nonArrayOrEmpty(state, 'suppliers').map(supplier => String(supplier.id)))

  for (const payment of nonArrayOrEmpty(state, 'customerPayments')) {
    const customerId = idValue(payment.customerId, `customer payment ${payment.id} customerId`)
    if (!customerIds.has(customerId)) throw new MigrationError(`تحصيل العميل ${payment.id} يشير إلى عميل غير موجود.`, 'BROKEN_REFERENCE')
    const date = dateValue(payment.date, migrationDate, `customer payment ${payment.id} date`)
    insert(database, 'INSERT INTO payments (id,party_type,party_id,customer_id,direction,amount_minor,method,date,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      `customer:${payment.id}`, 'customer', customerId, customerId, 'in', moneyMinor(payment.amount, `customer payment ${payment.id} amount`),
      payment.method || 'cash', date, null, payment.note || '', validUser(payment.createdBy), date
    ])
    if (payment.saleId && maps.sales.has(payment.saleId)) insert(database, 'INSERT INTO payment_allocations (id,payment_id,doc_type,sales_order_id,amount_minor,is_initial) VALUES (?,?,?,?,?,?)', [
      `allocation:customer:${payment.id}`, `customer:${payment.id}`, 'sales', payment.saleId, moneyMinor(payment.amount, `customer payment ${payment.id} amount`), ['دفعة أولى عند إصدار الفاتورة','سداد نقدي عند إصدار الفاتورة','دفعة مع الفاتورة'].includes(payment.note) ? 1 : 0
    ])
  }

  for (const payment of nonArrayOrEmpty(state, 'supplierPayments')) {
    const supplierId = idValue(payment.supplierId, `supplier payment ${payment.id} supplierId`)
    if (!supplierIds.has(supplierId)) throw new MigrationError(`سداد المورد ${payment.id} يشير إلى مورد غير موجود.`, 'BROKEN_REFERENCE')
    const date = dateValue(payment.date, migrationDate, `supplier payment ${payment.id} date`)
    insert(database, 'INSERT INTO payments (id,party_type,party_id,supplier_id,direction,amount_minor,method,date,reference,notes,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      `supplier:${payment.id}`, 'supplier', supplierId, supplierId, 'out', moneyMinor(payment.amount, `supplier payment ${payment.id} amount`),
      payment.method || 'cash', date, payment.reference || null, payment.note || '', validUser(payment.createdBy), date
    ])
  }

  for (const template of nonArrayOrEmpty(state, 'messageTemplates')) insert(database, 'INSERT INTO message_templates (id,name,channel,body,stage) VALUES (?,?,?,?,?)', [
    template.id, template.name || template.id, 'whatsapp', template.body || '', template.stage || ''
  ])
  const templateIds = new Set(nonArrayOrEmpty(state, 'messageTemplates').map(template => String(template.id)))
  for (const rule of nonArrayOrEmpty(state, 'reminderRules')) insert(database, 'INSERT INTO reminder_rules (id,name,offset_days,template_id,is_active,customer_id) VALUES (?,?,?,?,?,?)', [
    rule.id, rule.name || rule.id, safeInteger(rule.offsetDays || 0, `rule ${rule.id} offsetDays`), templateIds.has(String(rule.templateId)) ? rule.templateId : null, rule.active === false ? 0 : 1,
    customerIds.has(String(rule.customerId)) ? rule.customerId : null
  ])
  const ruleIds = new Set(nonArrayOrEmpty(state, 'reminderRules').map(rule => String(rule.id)))
  for (const reminder of nonArrayOrEmpty(state, 'reminders')) {
    if (!maps.sales.has(reminder.saleId) || !customerIds.has(String(reminder.customerId))) throw new MigrationError(`التذكير ${reminder.id} يشير إلى فاتورة/عميل غير موجود.`, 'BROKEN_REFERENCE')
    insert(database, 'INSERT INTO reminders (id,sales_order_id,customer_id,rule_id,template_id,scheduled_for,status,sent_at,stage) VALUES (?,?,?,?,?,?,?,?,?)', [
      reminder.id, reminder.saleId, reminder.customerId, ruleIds.has(String(reminder.ruleId)) ? reminder.ruleId : null,
      templateIds.has(String(reminder.templateId)) ? reminder.templateId : null, dateValue(reminder.scheduledFor, migrationDate, `reminder ${reminder.id} scheduledFor`),
      reminder.status === 'sent' ? 'sent' : reminder.status === 'skipped' ? 'skipped' : reminder.status === 'cancelled' ? 'cancelled' : reminder.status === 'failed' ? 'failed' : 'pending',
      reminder.sentAt ? dateValue(reminder.sentAt, migrationDate, `reminder ${reminder.id} sentAt`) : null, reminder.stage || ''
    ])
  }
  const reminderIds = new Set(nonArrayOrEmpty(state, 'reminders').map(row => String(row.id)))
  for (const entry of nonArrayOrEmpty(state, 'messageLog')) insert(database, 'INSERT INTO message_log (id,reminder_id,customer_id,to_phone,rendered_body,provider,status,error,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [
    entry.id, reminderIds.has(String(entry.reminderId)) ? entry.reminderId : null, customerIds.has(String(entry.customerId)) ? entry.customerId : null,
    null, entry.body || '', 'whatsapp-link', entry.status === 'failed' ? 'failed' : 'sent', null, dateValue(entry.createdAt, migrationDate, `message ${entry.id} createdAt`)
  ])

  for (const promise of nonArrayOrEmpty(state, 'promises')) {
    if (!maps.sales.has(promise.saleId) || !customerIds.has(String(promise.customerId))) throw new MigrationError(`وعد السداد ${promise.id} يشير إلى فاتورة/عميل غير موجود.`, 'BROKEN_REFERENCE')
    insert(database, 'INSERT INTO promises_to_pay (id,customer_id,sales_order_id,promised_date,amount_minor,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?)', [
      promise.id, promise.customerId, promise.saleId, dateValue(promise.promisedDate, migrationDate, `promise ${promise.id} date`),
      moneyMinor(promise.amount || 0, `promise ${promise.id} amount`), promise.status || 'open', promise.notes || '', migrationDate
    ])
  }
}

function insertOpeningBalances(database, state, migrationDate) {
  for (const customer of nonArrayOrEmpty(state, 'customers')) {
    const transactionBalance = nonArrayOrEmpty(state, 'sales')
      .filter(sale => sale.customerId === customer.id && sale.status !== 'cancelled')
      .reduce((sum, sale) => sum + moneyMinor(sale.total || 0, `sale ${sale.id} total`) - moneyMinor(sale.paid || 0, `sale ${sale.id} paid`), 0)
    const opening = moneyMinor(customer.balance || 0, `customer ${customer.id} balance`) - transactionBalance
    if (opening !== 0) insert(database, 'INSERT INTO customer_opening_balances (id,customer_id,balance_delta_minor,effective_date,due_date,is_opening,notes) VALUES (?,?,?,?,NULL,1,?)', [
      `opening:customer:${customer.id}`, customer.id, opening, migrationDate, 'رصيد افتتاحي مرحّل؛ لا يُنشأ تذكير تلقائيًا.'
    ])
  }

  for (const supplier of nonArrayOrEmpty(state, 'suppliers')) {
    const invoiceBalance = nonArrayOrEmpty(state, 'purchases')
      .filter(purchase => purchase.supplierId === supplier.id)
      .reduce((sum, purchase) => sum + moneyMinor(purchase.total || 0, `purchase ${purchase.id} total`)
        - moneyMinor(purchase.paid || 0, `purchase ${purchase.id} paid`)
        - nonArrayOrEmpty(state, 'purchaseReturns').filter(entry => entry.purchaseId === purchase.id).reduce((returns, entry) => returns + moneyMinor(entry.value || 0, `purchase return ${entry.id} value`), 0), 0)
    const otherPayments = nonArrayOrEmpty(state, 'supplierPayments').filter(payment => payment.supplierId === supplier.id)
      .reduce((sum, payment) => sum + moneyMinor(payment.amount || 0, `supplier payment ${payment.id} amount`), 0)
    const opening = moneyMinor(supplier.balance || 0, `supplier ${supplier.id} balance`) - invoiceBalance + otherPayments
    if (opening !== 0) insert(database, 'INSERT INTO supplier_opening_balances (id,supplier_id,balance_delta_minor,effective_date,due_date,is_opening,notes) VALUES (?,?,?,?,NULL,1,?)', [
      `opening:supplier:${supplier.id}`, supplier.id, opening, migrationDate, 'رصيد افتتاحي مرحّل؛ لا يُنشأ تذكير تلقائيًا.'
    ])
  }
}

function insertStockMovements(database, state, migrationDate, maps) {
  const validUsers = new Set(nonArrayOrEmpty(state, 'users').map(user => String(user.id)))
  const typeToRef = {
    opening: 'opening', purchase: 'purchase', 'purchase-return': 'return',
    'packing-consumption': 'packing', 'packing-production': 'packing', sale: 'sales', 'sales-return': 'return', adjustment: 'adjustment'
  }
  const openingMovementsCovered = new Set()
  for (const movement of nonArrayOrEmpty(state, 'stockLedger')) {
    const item = maps.items.get(movement.itemId)
    if (!item) throw new MigrationError(`حركة المخزون ${movement.id} تشير إلى صنف غير موجود.`, 'BROKEN_REFERENCE')
    const info = unitInfo(item.baseUnit, `movement ${movement.id}`)
    const quantity = baseQuantity(Math.abs(Number(movement.quantityChange)), info, `movement ${movement.id} quantity`) * Math.sign(Number(movement.quantityChange))
    const refType = typeToRef[movement.type] || 'legacy'
    const reference = String(movement.reference || movement.id)
    const refId = refType === 'purchase'
      ? (nonArrayOrEmpty(state, 'purchases').find(row => row.number === reference)?.id || reference)
      : refType === 'sales'
        ? (nonArrayOrEmpty(state, 'sales').find(row => row.number === reference)?.id || reference)
        : refType === 'packing'
          ? (nonArrayOrEmpty(state, 'packings').find(row => row.number === reference)?.id || reference)
          : refType === 'return'
            ? ([...nonArrayOrEmpty(state, 'salesReturns'), ...nonArrayOrEmpty(state, 'purchaseReturns')].find(row => row.number === reference)?.id || reference)
            : reference
    const qtyLegacy = Math.abs(Number(movement.quantityChange))
    const balance = baseQuantity(movement.balanceAfter || 0, info, `movement ${movement.id} balanceAfter`)
    let lotId = maps.lots.has(movement.lotId) ? movement.lotId : null
    const generatedOpening = maps.openingLotsByItem?.get(item.id)
    if (!lotId && movement.type === 'opening' && generatedOpening && quantity === generatedOpening.initialQuantityBase && !openingMovementsCovered.has(item.id)) {
      lotId = generatedOpening.lotId
      openingMovementsCovered.add(item.id)
    }
    let costMinor = moneyMinor(qtyLegacy * Number(movement.unitCost || 0), `movement ${movement.id} cost`)
    if (!lotId && movement.type === 'sale') {
      const sale = nonArrayOrEmpty(state, 'sales').find(row => row.number === reference)
      const allocations = sale ? maps.salesMovementAllocations.get(`${sale.number}\u0000${item.id}`) || [] : []
      const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantityBase, 0)
      const uniqueLots = [...new Set(allocations.map(allocation => allocation.lotId))]
      if (allocatedQuantity === Math.abs(quantity) && uniqueLots.length === 1) {
        lotId = uniqueLots[0]
        costMinor = allocations.reduce((sum, allocation) => sum + allocation.costMinor, 0)
      }
    }
    if (!lotId && movement.type === 'adjustment' && maps.adjustmentLotAllocations?.has(movement.id)) {
      const allocations = maps.adjustmentLotAllocations.get(movement.id)
      if (allocations.length === 1) lotId = allocations[0].lotId
      if (allocations.length) costMinor = allocations.reduce((sum, allocation) => sum + allocation.costMinor, 0)
    }
    insert(database, 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      idValue(movement.id, 'stock movement.id'), item.id, lotId, movement.type, quantity, balance,
      costMinor, refType, refId, dateValue(movement.at, migrationDate, `movement ${movement.id} at`),
      validUsers.has(String(movement.userId)) ? movement.userId : null, movement.note || null
    ])
  }
  for (const [itemId, opening] of maps.openingLotsByItem || []) {
    if (openingMovementsCovered.has(itemId)) continue
    insert(database, 'INSERT INTO stock_movements (id,item_id,lot_id,movement_type,qty_base,balance_after_base,cost_minor,ref_type,ref_id,created_at,created_by,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [
      `migration-opening-movement-${sha256(itemId).slice(0, 16)}`, itemId, opening.lotId, 'opening', opening.initialQuantityBase, opening.balanceAfterBase,
      opening.costMinor, 'opening', opening.lotId, opening.openedAt, null, 'دفعة افتتاحية أُنشئت لمطابقة الرصيد غير المغطى في بيانات المصدر.'
    ])
    maps.generatedOpeningMovements = (maps.generatedOpeningMovements || 0) + 1
  }
}

function insertActivityAndAudit(database, state, migrationDate) {
  const userIds = new Set(nonArrayOrEmpty(state, 'users').map(user => String(user.id)))
  for (const entry of nonArrayOrEmpty(state, 'auditLog')) insert(database, 'INSERT INTO audit_log (id,user_id,action,entity,entity_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)', [
    entry.id, userIds.has(String(entry.userId)) ? entry.userId : null, entry.action || 'ترحيل', entry.entity || 'legacy', String(entry.entityId || entry.id),
    null, JSON.stringify({ detail: entry.detail || '' }), dateValue(entry.at, migrationDate, `audit ${entry.id} at`)
  ])
  for (const entry of nonArrayOrEmpty(state, 'activity')) {
    const parsedDate = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(entry.at || '')) ? entry.at : migrationDate
    const detail = /^\d{4}-\d{2}-\d{2}/.test(String(entry.at || '')) ? String(entry.detail || '') : `${entry.detail || ''} · الوقت الأصلي: ${entry.at || 'غير محدد'}`
    insert(database, 'INSERT INTO activity_log (id,title,detail,created_at,activity_type) VALUES (?,?,?,?,?)', [entry.id, entry.title || '', detail, parsedDate, entry.type || 'payment'])
  }
}

function reconcile(database, state, migrationDate, payloadHash, sourceUpdatedAt, generatedOpeningMovements = 0) {
  const itemRows = database.prepare('SELECT item_id, quantity_base, cost_remaining_minor FROM v_stock_balance ORDER BY item_id').all()
  const actualItems = new Map(itemRows.map(row => [row.item_id, row]))
  const stock = nonArrayOrEmpty(state, 'items').map(item => {
    const info = unitInfo(item.baseUnit, `item ${item.id}`)
    const expected = baseQuantity(item.stock || 0, info, `item ${item.id} stock`)
    const actual = actualItems.get(item.id)?.quantity_base || 0
    return { id: item.id, name: item.name, expectedBase: expected, actualBase: actual, expectedCostMinor: null, actualCostRemainingMinor: actualItems.get(item.id)?.cost_remaining_minor || 0, matched: expected === actual }
  })
  const customerRows = new Map(database.prepare('SELECT customer_id,balance_minor FROM v_customer_balance').all().map(row => [row.customer_id, row.balance_minor]))
  const customers = nonArrayOrEmpty(state, 'customers').map(entry => {
    const expected = moneyMinor(entry.balance || 0, `customer ${entry.id} balance`)
    const actual = customerRows.get(entry.id) || 0
    return { id: entry.id, expectedMinor: expected, actualMinor: actual, matched: expected === actual }
  })
  const supplierRows = new Map(database.prepare('SELECT supplier_id,balance_minor FROM v_supplier_balance').all().map(row => [row.supplier_id, row.balance_minor]))
  const suppliers = nonArrayOrEmpty(state, 'suppliers').map(entry => {
    const expected = moneyMinor(entry.balance || 0, `supplier ${entry.id} balance`)
    const actual = supplierRows.get(entry.id) || 0
    return { id: entry.id, expectedMinor: expected, actualMinor: actual, matched: expected === actual }
  })

  const expectedSalesTotal = amountSum(nonArrayOrEmpty(state, 'sales'), 'total', 'sales')
  const actualSalesTotal = database.prepare('SELECT COALESCE(SUM(total_minor),0) AS total FROM sales_orders').get().total
  const expectedPurchaseTotal = amountSum(nonArrayOrEmpty(state, 'purchases'), 'total', 'purchases')
  const actualPurchaseTotal = database.prepare('SELECT COALESCE(SUM(total_minor),0) AS total FROM purchase_invoices').get().total
  const docCounts = {
    sales: [nonArrayOrEmpty(state, 'sales').length, database.prepare('SELECT COUNT(*) AS n FROM sales_orders').get().n],
    purchases: [nonArrayOrEmpty(state, 'purchases').length, database.prepare('SELECT COUNT(*) AS n FROM purchase_invoices').get().n],
    packings: [nonArrayOrEmpty(state, 'packings').length, database.prepare('SELECT COUNT(*) AS n FROM packing_orders').get().n],
    returns: [nonArrayOrEmpty(state, 'salesReturns').length + nonArrayOrEmpty(state, 'purchaseReturns').length, database.prepare('SELECT COUNT(*) AS n FROM returns').get().n],
    drafts: [nonArrayOrEmpty(state, 'purchaseDrafts').length, database.prepare('SELECT COUNT(*) AS n FROM purchase_drafts').get().n],
    customerPayments: [nonArrayOrEmpty(state, 'customerPayments').length, database.prepare("SELECT COUNT(*) AS n FROM payments WHERE party_type='customer'").get().n],
    supplierPayments: [nonArrayOrEmpty(state, 'supplierPayments').length, database.prepare("SELECT COUNT(*) AS n FROM payments WHERE party_type='supplier' AND COALESCE(notes,'')<>'دفعة عند اعتماد الفاتورة'").get().n],
    reminders: [nonArrayOrEmpty(state, 'reminders').length, database.prepare('SELECT COUNT(*) AS n FROM reminders').get().n],
    promises: [nonArrayOrEmpty(state, 'promises').length, database.prepare('SELECT COUNT(*) AS n FROM promises_to_pay').get().n]
  }
  const movementSourceCount = nonArrayOrEmpty(state, 'stockLedger').length
  const movementActualCount = database.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n
  const unlinkedSalesLineCount = database.prepare('SELECT COUNT(*) AS n FROM sales_lines WHERE lot_id IS NULL').get().n
  const unlinkedSalesReturnLotCount = database.prepare("SELECT COUNT(*) AS n FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' AND rl.original_lot_id IS NULL").get().n
  const movementExpectedTargetCount = movementSourceCount + generatedOpeningMovements
  // Quantity and party/document reconciliation is a hard gate. Historical
  // cost figures are diagnostic only: legacy unitCost is not always lot cost.
  const costByItem = new Map()
  const addCost = (itemId, key, amount) => {
    const row = costByItem.get(itemId) || { id: itemId, oldCogsMinor: 0, newCogsMinor: 0, oldInventoryMinor: 0, newInventoryMinor: 0 }
    row[key] += amount
    costByItem.set(itemId, row)
  }
  for (const item of nonArrayOrEmpty(state, 'items')) {
    addCost(item.id, 'oldInventoryMinor', moneyMinor(Number(item.stock || 0) * Number(item.unitCost || 0), `item ${item.id} legacy inventory value`))
    const actual = actualItems.get(item.id)?.cost_remaining_minor || 0
    addCost(item.id, 'newInventoryMinor', actual)
  }
  for (const sale of nonArrayOrEmpty(state, 'sales')) {
    for (const line of nonArrayOrEmpty(sale, 'lines')) {
      addCost(line.itemId, 'oldCogsMinor', moneyMinor(Number(line.qty || 0) * Number(line.cost || 0), `sale ${sale.id} legacy COGS`))
    }
  }
  for (const entry of nonArrayOrEmpty(state, 'salesReturns')) addCost(entry.itemId, 'oldCogsMinor', -moneyMinor(entry.cost || 0, `sales return ${entry.id} cost`))
  for (const row of database.prepare('SELECT item_id,COALESCE(SUM(cogs_total_minor),0) AS cogs FROM sales_lines GROUP BY item_id').all()) {
    addCost(row.item_id, 'newCogsMinor', row.cogs)
  }
  for (const row of database.prepare("SELECT rl.item_id,COALESCE(SUM(rl.cost_minor),0) AS cost FROM return_lines rl JOIN returns r ON r.id=rl.return_id WHERE r.return_type='sales' GROUP BY rl.item_id").all()) {
    addCost(row.item_id, 'newCogsMinor', -row.cost)
  }
  const costDiagnostics = [...costByItem.values()].sort((a, b) => a.id.localeCompare(b.id)).map(row => ({
    ...row,
    cogsDifferenceMinor: row.newCogsMinor - row.oldCogsMinor,
    inventoryDifferenceMinor: row.newInventoryMinor - row.oldInventoryMinor
  }))
  const returnIssues = []
  for (const sale of nonArrayOrEmpty(state, 'sales')) {
    const soldByItem = new Map()
    const returnedByItem = new Map()
    for (const line of nonArrayOrEmpty(sale, 'lines')) soldByItem.set(line.itemId, (soldByItem.get(line.itemId) || 0) + Number(line.qty || 0))
    for (const entry of nonArrayOrEmpty(state, 'salesReturns').filter(row => row.saleId === sale.id)) {
      returnedByItem.set(entry.itemId, (returnedByItem.get(entry.itemId) || 0) + Number(entry.quantity || 0))
    }
    for (const [itemId, returned] of returnedByItem) {
      const sold = soldByItem.get(itemId) || 0
      if (returned > sold) returnIssues.push({ type: 'sales_return_exceeds_sold', saleId: sale.id, itemId, soldQuantity: sold, returnedQuantity: returned, excessQuantity: returned - sold })
    }
  }
  const mismatches = [
    ...stock.filter(row => !row.matched).map(row => ({ area: 'stock', id: row.id, expected: row.expectedBase, actual: row.actualBase })),
    ...customers.filter(row => !row.matched).map(row => ({ area: 'customer_balance', id: row.id, expected: row.expectedMinor, actual: row.actualMinor })),
    ...suppliers.filter(row => !row.matched).map(row => ({ area: 'supplier_balance', id: row.id, expected: row.expectedMinor, actual: row.actualMinor })),
    ...(expectedSalesTotal !== actualSalesTotal ? [{ area: 'sales_total_minor', expected: expectedSalesTotal, actual: actualSalesTotal }] : []),
    ...(expectedPurchaseTotal !== actualPurchaseTotal ? [{ area: 'purchase_total_minor', expected: expectedPurchaseTotal, actual: actualPurchaseTotal }] : []),
    ...Object.entries(docCounts).filter(([, pair]) => pair[0] !== pair[1]).map(([name, pair]) => ({ area: `document_count:${name}`, expected: pair[0], actual: pair[1] })),
    ...(movementExpectedTargetCount !== movementActualCount ? [{ area: 'stock_movement_count', expected: movementExpectedTargetCount, actual: movementActualCount }] : [])
  ]
  return {
    migrationKey: MIGRATION_KEY,
    status: mismatches.length ? 'mismatch' : 'matched',
    sourceSha256: payloadHash,
    sourceUpdatedAt: sourceUpdatedAt || null,
    migrationDate,
    stock,
    customerBalances: customers,
    supplierBalances: suppliers,
    invoiceTotalsMinor: {
      sales: { expected: expectedSalesTotal, actual: actualSalesTotal, matched: expectedSalesTotal === actualSalesTotal },
      purchases: { expected: expectedPurchaseTotal, actual: actualPurchaseTotal, matched: expectedPurchaseTotal === actualPurchaseTotal }
    },
    documentCounts: Object.fromEntries(Object.entries(docCounts).map(([key, pair]) => [key, { expected: pair[0], actual: pair[1], matched: pair[0] === pair[1] }])),
    stockMovementCount: { sourceCount: movementSourceCount, generatedOpeningCount: generatedOpeningMovements, expectedTargetCount: movementExpectedTargetCount, actualTargetCount: movementActualCount, matched: movementExpectedTargetCount === movementActualCount },
    costDiagnostics,
    returnIssues,
    generatedOpeningLots: 0,
    historicalLotLinks: { salesLinesWithoutLot: unlinkedSalesLineCount, salesReturnsWithoutOriginalLot: unlinkedSalesReturnLotCount },
    warnings: [
      ...(unlinkedSalesLineCount ? [`تعذر تخصيص ${unlinkedSalesLineCount} بند بيع تاريخي إلى دفعة.`] : []),
      ...(unlinkedSalesReturnLotCount ? [`تعذر تحديد دفعة أصلية لـ ${unlinkedSalesReturnLotCount} مرتجع بيع تاريخي؛ يترك الربط فارغًا للمراجعة.`] : []),
      ...returnIssues.map(issue => `مرتجع تاريخي يتجاوز المباع: فاتورة ${issue.saleId}، صنف ${issue.itemId}، المباع ${issue.soldQuantity}، المرتجع ${issue.returnedQuantity}، الزيادة ${issue.excessQuantity}.`)
    ],
    mismatches
  }
}

function makeLegacyReadonly(database) {
  database.exec('ALTER TABLE app_state RENAME TO legacy_app_state')
  database.exec(`
    CREATE TRIGGER legacy_app_state_readonly_insert BEFORE INSERT ON legacy_app_state
    BEGIN SELECT RAISE(ABORT, 'legacy_app_state is read-only'); END;
    CREATE TRIGGER legacy_app_state_readonly_update BEFORE UPDATE ON legacy_app_state
    BEGIN SELECT RAISE(ABORT, 'legacy_app_state is read-only'); END;
    CREATE TRIGGER legacy_app_state_readonly_delete BEFORE DELETE ON legacy_app_state
    BEGIN SELECT RAISE(ABORT, 'legacy_app_state is read-only'); END;
  `)
}

function copyReceipt(database) {
  const hasGuard = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='phase0_copy_guard'").get())
  if (!hasGuard) return null
  return database.prepare('SELECT source_path,created_at FROM phase0_copy_guard WHERE id = 1').get() || null
}

function migrateDatabase(database, options = {}) {
  if (!copyReceipt(database)) throw new MigrationError('الترحيل المباشر ممنوع: قاعدة البيانات لا تحمل إيصال النسخ الآمن.', 'COPY_REQUIRED')
  configureDatabase(database)
  const hasMigrationTable = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='data_migrations'").get())
  const prior = hasMigrationTable ? database.prepare("SELECT reconciliation_json FROM data_migrations WHERE migration_key = ?").get(MIGRATION_KEY) : null
  if (prior) return { ...JSON.parse(prior.reconciliation_json), status: 'already_migrated', idempotent: true }

  const source = sourceAppState(database)
  if (source.tableName !== 'app_state') throw new MigrationError('وجد legacy_app_state بلا سجل اكتمال؛ أوقف الترحيل للمراجعة.', 'INCOMPLETE_PRIOR_MIGRATION')
  if (seededDemoState(source.state)) throw new MigrationError('المصدر يطابق مجموعة بيانات seed التجريبية المعروفة؛ لن تُرحّل أو تُدمج.', 'DEMO_SEED_REFUSED')

  const migrationDate = options.migrationDate || new Date().toISOString().slice(0, 10)
  const payloadHash = sha256(source.payload)
  const maps = {}
  let report
  const migrate = database.transaction(() => {
    applyMigrations(database)
    insertBaseLookups(database, source.state, migrationDate, maps)
    insertDocuments(database, source.state, migrationDate, maps)
    insertLots(database, source.state, migrationDate, maps)
    allocateLegacyFifo(database, source.state, migrationDate, maps)
    insertReturns(database, source.state, migrationDate, maps)
    insertPaymentsAndReminders(database, source.state, migrationDate, maps)
    insertOpeningBalances(database, source.state, migrationDate)
    insertStockMovements(database, source.state, migrationDate, maps)
    insertActivityAndAudit(database, source.state, migrationDate)
    const foreignKeyErrors = database.pragma('foreign_key_check')
    if (foreignKeyErrors.length) throw new MigrationError(`فشل فحص المفاتيح الأجنبية: ${foreignKeyErrors.length} مخالفة.`, 'FOREIGN_KEY_CHECK_FAILED')
    report = reconcile(database, source.state, migrationDate, payloadHash, source.updatedAt, maps.generatedOpeningMovements || 0)
    report.generatedOpeningLots = maps.generatedOpeningLots || 0
    if (report.mismatches.length) throw new MigrationError(`فشل تقرير المطابقة: ${report.mismatches.length} اختلاف(ات).`, 'RECONCILIATION_FAILED')
    makeLegacyReadonly(database)
    report.status = 'matched'
    report.idempotent = false
    insert(database, 'INSERT INTO data_migrations (migration_key,source_sha256,source_updated_at,imported_at,reconciliation_json) VALUES (?,?,?,?,?)', [
      MIGRATION_KEY, payloadHash, source.updatedAt || '', new Date().toISOString(), JSON.stringify(report)
    ])
  })

  try {
    migrate.immediate()
  } catch (error) {
    if (report) error.report = { ...report, status: 'mismatch' }
    throw error
  }
  return report
}

async function copyDatabase(sourcePath, destinationPath) {
  const source = fs.realpathSync(path.resolve(sourcePath))
  const destination = path.resolve(destinationPath)
  if (source === destination) throw new MigrationError('المصدر والنسخة متطابقان؛ يمنع تعديل قاعدة المصدر.', 'SOURCE_EQUALS_COPY')
  if (!fs.existsSync(source)) throw new MigrationError(`ملف المصدر غير موجود: ${source}`, 'SOURCE_NOT_FOUND')
  if (fs.existsSync(destination)) throw new MigrationError(`ملف النسخة موجود مسبقًا؛ لن يُستبدل: ${destination}`, 'COPY_ALREADY_EXISTS')
  if (!fs.statSync(source).isFile()) throw new MigrationError('مسار المصدر ليس ملف SQLite.', 'INVALID_SOURCE_PATH')
  if (!fs.existsSync(path.dirname(destination))) throw new MigrationError('مجلد النسخة غير موجود؛ أنشئه صراحة قبل التشغيل.', 'COPY_DIRECTORY_NOT_FOUND')
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true })
  try {
    const result = sourceDb.pragma('integrity_check', { simple: true })
    if (result !== 'ok') throw new MigrationError(`قاعدة المصدر غير سليمة: integrity_check=${result}`, 'SOURCE_INTEGRITY_FAILED')
    await sourceDb.backup(destination)
  } finally {
    sourceDb.close()
  }
  const copyDb = new Database(destination)
  try {
    copyDb.exec('CREATE TABLE IF NOT EXISTS phase0_copy_guard (id INTEGER PRIMARY KEY CHECK (id = 1), source_path TEXT NOT NULL, created_at TEXT NOT NULL)')
    copyDb.prepare('INSERT INTO phase0_copy_guard (id,source_path,created_at) VALUES (1,?,?)').run(source, new Date().toISOString())
  } finally {
    copyDb.close()
  }
  return destination
}

async function migrateUserDatabaseCopy(sourcePath, destinationPath, options = {}) {
  const source = fs.realpathSync(path.resolve(sourcePath))
  const copyPath = path.resolve(destinationPath)
  if (source === copyPath) throw new MigrationError('المصدر والنسخة متطابقان؛ يمنع تعديل قاعدة المصدر.', 'SOURCE_EQUALS_COPY')
  if (fs.existsSync(copyPath)) {
    if (fs.realpathSync(copyPath) === source) throw new MigrationError('مسار النسخة يحل إلى قاعدة المصدر؛ يمنع الترحيل.', 'SOURCE_EQUALS_COPY')
    const existingCopy = new Database(copyPath, { readonly: true, fileMustExist: true })
    try {
      const receipt = copyReceipt(existingCopy)
      if (!receipt || receipt.source_path !== source) throw new MigrationError('ملف النسخة موجود لكنه لا يحمل إيصالًا لهذا المصدر؛ لن يُستبدل أو يُعدّل.', 'COPY_ALREADY_EXISTS')
    } finally {
      existingCopy.close()
    }
  } else {
    await copyDatabase(source, copyPath)
  }
  const database = new Database(copyPath, { fileMustExist: true })
  try {
    const report = migrateDatabase(database, options)
    return { ...report, sourcePath: source, copyPath }
  } catch (error) {
    error.report = {
      ...(error.report || { status: 'blocked', code: error.code || 'MIGRATION_FAILED', message: error.message, issues: error.details ? [error.details] : [] }),
      sourcePath: source, copyPath
    }
    throw error
  } finally {
    database.close()
  }
}

function writeReport(reportPath, report) {
  if (!reportPath) return
  const target = path.resolve(reportPath)
  if (fs.existsSync(target)) throw new MigrationError(`ملف التقرير موجود ولن يُستبدل: ${target}`, 'REPORT_ALREADY_EXISTS')
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
}

async function main(argv) {
  if (argv.length < 2 || argv.length > 3) {
    throw new MigrationError('الاستخدام: node electron/migrations/legacy/import-legacy.cjs <user-db.sqlite> <new-copy.sqlite> [reconciliation.json]', 'USAGE')
  }
  const [sourcePath, copyPath, reportPath] = argv
  try {
    const report = await migrateUserDatabaseCopy(sourcePath, copyPath)
    writeReport(reportPath, report)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.status === 'matched' || report.status === 'already_migrated' ? 0 : 1
  } catch (error) {
    const report = error.report || { status: 'failed', code: error.code || 'MIGRATION_FAILED', message: error.message, sourcePath: path.resolve(sourcePath), copyPath: path.resolve(copyPath) }
    if (reportPath) writeReport(reportPath, report)
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`)
    return 1
  }
}

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code }).catch(error => {
  process.stderr.write(`${error.code || 'MIGRATION_FAILED'}: ${error.message}\n`)
  process.exitCode = 1
})

module.exports = {
  MigrationError,
  baseQuantity,
  copyDatabase,
  halfUp,
  moneyMinor,
  migrateDatabase,
  migrateUserDatabaseCopy,
  reconcile,
  unitInfo
}

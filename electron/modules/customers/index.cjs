const contributeSnapshot = require('./snapshot.cjs')
const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')

function saveCustomer(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.name?.trim()) throw new Error('Customer name is required')
    if (['balance', 'balanceMinor'].some(key => Object.hasOwn(input, key))) throw new Error('Customer balance must use an opening entry or audited correction')
    const ctx = contextOf(options)
    const existing = input.id ? one(db, 'SELECT * FROM customers WHERE id=?', [input.id]) : null
    const elevated = Boolean(elevationFor(options, 'customer-credit'))
    if (ctx.role !== 'owner' && !elevated && ['creditLimitMinor', 'creditDays', 'isBlocked', 'blockReason'].some(key => Object.hasOwn(input, key))) throw new Error('Customer credit fields require owner permission')
    for (const [key, value] of Object.entries({ creditLimitMinor: input.creditLimitMinor ?? existing?.credit_limit_minor ?? 0, creditDays: input.creditDays ?? existing?.credit_days ?? 0 })) assertNonnegativeInt(value, key)
    const customerId = input.id || id('customer'), date = nowDate(input.date)
    const exists = one(db, 'SELECT id FROM customers WHERE id=?', [customerId])
    const opening = input.openingBalanceMinor
    if (opening !== undefined) assertNonnegativeInt(opening, 'openingBalanceMinor')
    if (opening !== undefined && ctx.role !== 'owner') throw new Error('Only an owner can write an opening customer balance')
    if (exists) write(db, control, 'customer.update', 'UPDATE customers SET name=?,phone=?,whatsapp=?,credit_limit_minor=?,credit_days=?,is_blocked=?,block_reason=?,reminder_enabled=?,notes=?,is_active=?,updated_at=? WHERE id=?', [input.name.trim(), input.phone || '', input.whatsapp || '', input.creditLimitMinor ?? existing.credit_limit_minor, input.creditDays ?? existing.credit_days, input.isBlocked === undefined ? existing.is_blocked : input.isBlocked ? 1 : 0, input.blockReason === undefined ? existing.block_reason : input.blockReason || null, input.reminderEnabled === false ? 0 : 1, input.notes || null, input.isActive === false ? 0 : 1, date, customerId])
    else write(db, control, 'customer.create', 'INSERT INTO customers (id,name,phone,whatsapp,credit_limit_minor,credit_days,is_blocked,block_reason,reminder_enabled,notes,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [customerId, input.name.trim(), input.phone || '', input.whatsapp || '', input.creditLimitMinor || 0, input.creditDays || 0, input.isBlocked ? 1 : 0, input.blockReason || null, input.reminderEnabled === false ? 0 : 1, input.notes || null, input.isActive === false ? 0 : 1, date, date])
    if (!exists && opening > 0) write(db, control, 'customer.opening-balance', 'INSERT INTO customer_opening_balances (id,customer_id,balance_delta_minor,effective_date,due_date,is_opening,notes) VALUES (?,?,?,?,?,1,?)', [id('opening'), customerId, opening, date, input.openingDueDate || null, input.openingNotes || 'رصيد افتتاحي'])
    if (exists && opening !== undefined) {
      if (ctx.role !== 'owner') throw new Error('Only an owner can correct an opening balance')
      const previousOpening = one(db, 'SELECT COALESCE(SUM(balance_delta_minor),0) AS value FROM customer_opening_balances WHERE customer_id=?', [customerId]).value
      const delta = opening - previousOpening
      if (delta) {
        if (!input.openingCorrectionReason?.trim()) throw new Error('An audited correction reason is required')
        write(db, control, 'customer.balance-correction', 'INSERT INTO customer_balance_adjustments (id,customer_id,balance_delta_minor,effective_date,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?)', [id('balance-correction'), customerId, delta, date, input.openingCorrectionReason.trim(), ctx.userId, new Date().toISOString()])
        audit(db, control, options, 'customer.balance-correction', 'customer', customerId, { deltaMinor: delta, reason: input.openingCorrectionReason.trim() })
      }
    }
    audit(db, control, options, exists ? 'customer.update' : 'customer.create', 'customer', customerId, { name: input.name.trim(), isActive: input.isActive !== false })
    return { id: customerId }
  })
  return { ...result.result, steps: result.steps }
}

function register(registry) {
  registry.defineCommand({ name: 'customer:save', roles: ["owner","sales"], handler: saveCustomer })
}

module.exports = { saveCustomer, register, snapshot: contributeSnapshot }

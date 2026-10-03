const contributeSnapshot = require('./snapshot.cjs')
const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')
const { pageSchema } = require('../../core/query.cjs')
const { paginateQuery } = require('../../core/dispatcher.cjs')

function saveSetting(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (contextOf(options).role !== 'owner') throw new Error('Only an owner can change settings')
    if (!input.key?.trim()) throw new Error('Setting key is required')
    if (input.value === undefined) throw new Error('Setting value is required')
    const key = input.key.trim(), value = JSON.stringify(input.value)
    const { z } = require('zod')
    const settingSchemas = {
      company_name: z.string().min(1).max(160),
      company_phone: z.string().max(40),
      currency: z.literal('EGP'),
      costing_method: z.enum(['FIFO', 'WAVG']),
      default_credit_days: z.number().int().min(0).max(3650)
    }
    if (!settingSchemas[key] || !settingSchemas[key].safeParse(input.value).success) throw new Error('Setting key or value is not allowed')
    write(db, control, 'setting.upsert', 'INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at', [key, value, new Date().toISOString()])
    audit(db, control, options, 'settings.update', 'setting', key, { sensitive: /password|pin|secret|token/i.test(key) })
    return { key }
  })
  return { ...result.result, steps: result.steps }
}

function register(registry) {
  registry.defineCommand({ name: 'settings:save', roles: ["owner"], handler: saveSetting })
  registry.defineQuery({ name: 'audit:list', roles: ['owner'], schema: pageSchema, handler: (db, _ctx, page) =>
    paginateQuery(db, 'SELECT id,user_id,action,entity,entity_id,before_json,after_json,created_at FROM audit_log ORDER BY created_at DESC,rowid DESC', [], page)
  })
}

module.exports = { saveSetting, register, snapshot: contributeSnapshot }

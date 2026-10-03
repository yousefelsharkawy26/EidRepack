const { z } = require('zod')
const operations = require('../services/operations.cjs')
const { buildSnapshot } = require('../services/queries.cjs')

function createRegistry() {
  const commands = new Map()
  const queries = new Map()
  const defaultSchema = z.object({}).passthrough()

  function define(store, definition) {
    if (!definition || typeof definition.name !== 'string' || !definition.name) throw new Error('Registry definition requires a name')
    if (!Array.isArray(definition.roles) || definition.roles.length === 0) throw new Error(`Registry definition ${definition.name} requires at least one role`)
    if (typeof definition.handler !== 'function') throw new Error(`Registry definition ${definition.name} requires a handler`)
    if (store.has(definition.name)) throw new Error(`Duplicate registry definition: ${definition.name}`)
    const entry = { ...definition, roles: [...definition.roles], schema: definition.schema || defaultSchema }
    store.set(entry.name, entry)
    return entry
  }

  return {
    defineCommand: definition => define(commands, definition),
    defineQuery: definition => define(queries, definition),
    get: name => commands.get(name),
    getQuery: name => queries.get(name),
    list: () => [...commands.values()],
    listQueries: () => [...queries.values()],
    rolesFor: name => commands.get(name)?.roles || []
  }
}

const registry = createRegistry()
const defineCommand = registry.defineCommand
const defineQuery = registry.defineQuery
const allRoles = ['owner', 'sales', 'warehouse', 'purchasing']
const pageSchema = z.object({ limit: z.number().int().min(1).max(200).default(50), cursor: z.string().regex(/^\d+$/).optional() }).strict()

const commands = [
  ['purchase:confirm', ['owner', 'purchasing'], 'confirmPurchase'],
  ['purchase:return', ['owner', 'purchasing'], 'returnPurchase'],
  ['purchase-draft:save', ['owner', 'purchasing'], 'savePurchaseDraft'],
  ['purchase-draft:delete', ['owner', 'purchasing'], 'deletePurchaseDraft'],
  ['supplier:pay', ['owner', 'purchasing'], 'recordSupplierPayment'],
  ['supplier:save', ['owner', 'purchasing'], 'saveSupplier'],
  ['packing:confirm', ['owner', 'warehouse'], 'confirmPacking'],
  ['packing:cancel', ['owner'], 'cancelPacking'],
  ['sale:confirm', ['owner', 'sales'], 'confirmSale'],
  ['sale:return', ['owner', 'sales'], 'returnSale'],
  ['customer:collect', ['owner', 'sales'], 'recordCollection'],
  ['customer:promise', ['owner', 'sales'], 'recordPromise'],
  ['customer:save', ['owner', 'sales'], 'saveCustomer'],
  ['customer:writeoff', ['owner'], 'writeOffSale'],
  ['payment:reverse', ['owner'], 'reversePayment'],
  ['reminder:update', ['owner', 'sales'], 'updateReminder'],
  ['reminder-rule:save', ['owner'], 'saveReminderRule'],
  ['reminder-template:save', ['owner'], 'saveReminderTemplate'],
  ['inventory:adjust', ['owner', 'warehouse'], 'adjustStock'],
  ['inventory:opening', ['owner'], 'createOpeningStock'],
  ['item:save', ['owner', 'warehouse', 'purchasing'], 'saveItem'],
  ['recipe:save', ['owner', 'warehouse'], 'saveRecipe'],
  ['user:save', ['owner'], 'saveUser'],
  ['settings:save', ['owner'], 'saveSetting']
]
for (const [name, roles, method] of commands) defineCommand({ name, roles, handler: operations[method] })

defineQuery({ name: 'query:snapshot', roles: allRoles, handler: (db, ctx) => ({ snapshot: buildSnapshot(db, ctx) }) })
defineQuery({
  name: 'inventory:movements', roles: ['owner', 'warehouse', 'purchasing'], schema: pageSchema,
  handler: (db, ctx, page) => {
    const { paginateQuery } = require('./dispatcher.cjs')
    const cost = ctx.role === 'owner' ? ', m.cost_minor' : ''
    const where = ctx.role === 'purchasing' ? " WHERE m.movement_type='purchase'" : ''
    return paginateQuery(db, `SELECT m.id,m.item_id,i.name AS item_name,m.lot_id,m.movement_type,m.qty_base,m.balance_after_base,m.ref_type,m.ref_id,m.created_at${cost} FROM stock_movements m JOIN items i ON i.id=m.item_id${where} ORDER BY m.created_at DESC,m.rowid DESC`, [], page)
  }
})
defineQuery({ name: 'audit:list', roles: ['owner'], schema: pageSchema, handler: (db, _ctx, page) => {
  const { paginateQuery } = require('./dispatcher.cjs')
  return paginateQuery(db, 'SELECT id,user_id,action,entity,entity_id,before_json,after_json,created_at FROM audit_log ORDER BY created_at DESC,rowid DESC', [], page)
} })
defineQuery({ name: 'messages:list', roles: ['owner', 'sales'], schema: pageSchema, handler: (db, _ctx, page) => {
  const { paginateQuery } = require('./dispatcher.cjs')
  return paginateQuery(db, 'SELECT id,reminder_id,customer_id,to_phone,rendered_body,provider,status,error,created_at FROM message_log ORDER BY created_at DESC,rowid DESC', [], page)
} })
defineQuery({ name: 'invoices:list', roles: ['owner', 'sales', 'purchasing'], schema: pageSchema.extend({ kind: z.enum(['sales', 'purchase']) }).strict(), handler: (db, ctx, input) => {
  const { paginateQuery } = require('./dispatcher.cjs')
  if (input.kind === 'sales') {
    if (!['owner', 'sales'].includes(ctx.role)) throw new Error('Permission denied')
    return paginateQuery(db, 'SELECT id,number,customer_id,date,status,total_minor,paid_amount_minor,due_date FROM sales_orders ORDER BY date DESC,rowid DESC', [], input)
  }
  if (!['owner', 'purchasing'].includes(ctx.role)) throw new Error('Permission denied')
  return paginateQuery(db, 'SELECT id,number,supplier_id,date,status,subtotal_minor,extra_costs_total_minor,total_minor,paid_amount_minor,due_date FROM purchase_invoices ORDER BY date DESC,rowid DESC', [], input)
} })

module.exports = { createRegistry, defineCommand, defineQuery, pageSchema, registry }

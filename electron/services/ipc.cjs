const { z } = require('zod')
const operations = require('./operations.cjs')

const channels = {
  'purchase:confirm': 'confirmPurchase', 'purchase:return': 'returnPurchase', 'packing:confirm': 'confirmPacking',
  'sale:confirm': 'confirmSale', 'customer:collect': 'recordCollection', 'customer:promise': 'recordPromise',
  'supplier:pay': 'recordSupplierPayment', 'purchase-draft:save': 'savePurchaseDraft', 'purchase-draft:delete': 'deletePurchaseDraft',
  'reminder:update': 'updateReminder', 'reminder-rule:save': 'saveReminderRule', 'reminder-template:save': 'saveReminderTemplate',
  'customer:save': 'saveCustomer', 'supplier:save': 'saveSupplier', 'item:save': 'saveItem', 'recipe:save': 'saveRecipe',
  'user:save': 'saveUser', 'settings:save': 'saveSetting', 'sale:return': 'returnSale', 'inventory:adjust': 'adjustStock',
  'inventory:opening': 'createOpeningStock', 'payment:reverse': 'reversePayment', 'packing:cancel': 'cancelPacking',
  'customer:writeoff': 'writeOffSale'
}

const rolePermissions = {
  owner: new Set(Object.keys(channels)),
  sales: new Set(['sale:confirm', 'sale:return', 'customer:collect', 'customer:promise', 'customer:save', 'reminder:update']),
  warehouse: new Set(['packing:confirm', 'inventory:adjust', 'item:save', 'recipe:save']),
  purchasing: new Set(['purchase:confirm', 'purchase:return', 'purchase-draft:save', 'purchase-draft:delete', 'supplier:pay', 'supplier:save', 'item:save'])
}

const payloadSchema = z.object({ clientRequestId: z.string().trim().min(8).max(128) }).passthrough().superRefine((payload, ctx) => {
  for (const forbidden of ['userId', 'currentUserId', 'currentUserRole', 'ctx']) {
    if (Object.hasOwn(payload, forbidden)) ctx.addIssue({ code: 'custom', path: [forbidden], message: 'Identity is derived from main-process session' })
  }
  try {
    if (JSON.stringify(payload).length > 64000) ctx.addIssue({ code: 'custom', message: 'Payload is too large' })
  } catch { ctx.addIssue({ code: 'custom', message: 'Payload must be JSON serializable' }) }
})

function redactCosts(value, role) {
  if (role === 'owner' || value == null) return value
  if (Array.isArray(value)) return value.map(row => redactCosts(row, role))
  if (typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(^|_)(cost|cogs|profit|margin|valuation)|unitCost|costMinor/i.test(key)).map(([key, child]) => [key, redactCosts(child, role)]))
}

function registerOperationHandlers(ipcMain, getDatabase, getContext, options = {}) {
  for (const [channel, method] of Object.entries(channels)) {
    ipcMain.handle(`operation:${channel}`, (event, rawPayload) => {
      const payload = payloadSchema.parse(rawPayload)
      if (channel !== 'user:save' && Object.hasOwn(payload, 'role')) throw new Error('Role identity is derived from main-process session')
      const { clientRequestId, ...input } = payload
      const ctx = getContext(event)
      if (!rolePermissions[ctx.role]?.has(channel)) throw new Error('Permission denied')
      const database = getDatabase()
      const replay = database.prepare('SELECT command,result_json FROM command_log WHERE user_id=? AND client_request_id=?').get(ctx.userId, clientRequestId)
      if (replay) {
        if (replay.command !== channel) throw new Error('Request id was already used for a different command')
        return { ok: true, data: JSON.parse(replay.result_json) }
      }
      const priorUser = channel === 'user:save' && input.id ? database.prepare('SELECT role,is_active FROM users WHERE id=?').get(input.id) : null
      const invoke = database.transaction(() => {
        const result = redactCosts(operations[method](database, input, { ctx, elevation: ctx.elevation }), ctx.role)
        database.prepare('INSERT INTO command_log (id,user_id,client_request_id,command,result_json,created_at) VALUES (?,?,?,?,?,?)')
          .run(require('node:crypto').randomUUID(), ctx.userId, clientRequestId, channel, JSON.stringify(result), new Date().toISOString())
        return result
      })
      const result = invoke.immediate()
      if (priorUser && (priorUser.role !== input.role || (input.isActive === false && priorUser.is_active))) options.invalidateUser?.(input.id)
      return { ok: true, data: result }
    })
  }
}

function paginateQuery(database, sql, params = [], options = {}) {
  const limit = options.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('limit must be between 1 and 200')
  const cursor = options.cursor == null ? 0 : Number(options.cursor)
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid pagination cursor')
  const rows = database.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, limit + 1, cursor)
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()
  return { rows, nextCursor: hasMore ? String(cursor + limit) : null }
}

const pageSchema = z.object({ limit: z.number().int().min(1).max(200).default(50), cursor: z.string().regex(/^\d+$/).optional() }).strict()
function registerQueryHandlers(ipcMain, getDatabase, getContext) {
  ipcMain.handle('query:snapshot', (event) => {
    const ctx = getContext(event)
    const { buildSnapshot } = require('./queries.cjs')
    return { ok: true, snapshot: redactCosts(buildSnapshot(getDatabase(), ctx), ctx.role) }
  })
  const register = (channel, allowedRoles, query, schema = pageSchema) => ipcMain.handle(`query:${channel}`, (event, raw = {}) => {
    const ctx = getContext(event)
    if (!allowedRoles.includes(ctx.role)) throw new Error('Permission denied')
    const page = schema.parse(raw)
    return { ok: true, ...query(getDatabase(), ctx, page) }
  })
  register('inventory:movements', ['owner', 'warehouse', 'purchasing'], (db, ctx, page) => {
    const cost = ctx.role === 'owner' ? ', m.cost_minor' : ''
    const where = ctx.role === 'purchasing' ? " WHERE m.movement_type='purchase'" : ''
    return paginateQuery(db, `SELECT m.id,m.item_id,i.name AS item_name,m.lot_id,m.movement_type,m.qty_base,m.balance_after_base,m.ref_type,m.ref_id,m.created_at${cost} FROM stock_movements m JOIN items i ON i.id=m.item_id${where} ORDER BY m.created_at DESC,m.rowid DESC`, [], page)
  })
  register('audit:list', ['owner'], (db, _ctx, page) => paginateQuery(db, 'SELECT id,user_id,action,entity,entity_id,before_json,after_json,created_at FROM audit_log ORDER BY created_at DESC,rowid DESC', [], page))
  register('messages:list', ['owner', 'sales'], (db, _ctx, page) => paginateQuery(db, 'SELECT id,reminder_id,customer_id,to_phone,rendered_body,provider,status,error,created_at FROM message_log ORDER BY created_at DESC,rowid DESC', [], page))
  register('invoices:list', ['owner', 'sales', 'purchasing'], (db, ctx, kind) => {
    if (kind.kind === 'sales') {
      if (!['owner', 'sales'].includes(ctx.role)) throw new Error('Permission denied')
      return paginateQuery(db, 'SELECT id,number,customer_id,date,status,total_minor,paid_amount_minor,due_date FROM sales_orders ORDER BY date DESC,rowid DESC', [], kind)
    }
    if (!['owner', 'purchasing'].includes(ctx.role)) throw new Error('Permission denied')
    return paginateQuery(db, 'SELECT id,number,supplier_id,date,status,subtotal_minor,extra_costs_total_minor,total_minor,paid_amount_minor,due_date FROM purchase_invoices ORDER BY date DESC,rowid DESC', [], kind)
  }, pageSchema.extend({ kind: z.enum(['sales', 'purchase']) }).strict())
}

module.exports = { channels, paginateQuery, redactCosts, registerOperationHandlers, registerQueryHandlers, rolePermissions }

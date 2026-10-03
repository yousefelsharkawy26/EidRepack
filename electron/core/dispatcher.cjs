const { randomUUID } = require('node:crypto')
const { z } = require('zod')

const payloadSchema = z.object({ clientRequestId: z.string().trim().min(8).max(128) }).passthrough().superRefine((payload, ctx) => {
  for (const forbidden of ['userId', 'currentUserId', 'currentUserRole', 'ctx']) {
    if (Object.hasOwn(payload, forbidden)) ctx.addIssue({ code: 'custom', path: [forbidden], message: 'Identity is derived from main-process session' })
  }
  try {
    if (JSON.stringify(payload).length > 64000) ctx.addIssue({ code: 'custom', message: 'Payload is too large' })
  } catch { ctx.addIssue({ code: 'custom', message: 'Payload must be JSON serializable' }) }
})

const invocationSchema = z.object({ name: z.string().trim().min(1).max(120), payload: z.unknown().optional() }).strict()

function redactCosts(value, role) {
  if (role === 'owner' || value == null) return value
  if (Array.isArray(value)) return value.map(row => redactCosts(row, role))
  if (typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(^|_)(cost|cogs|profit|margin|valuation)|unitCost|costMinor/i.test(key))
    .map(([key, child]) => [key, redactCosts(child, role)]))
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

function dispatchCommand({ registry, getDatabase, getContext, raw, invalidateUser }) {
  const { name, payload: rawPayload } = invocationSchema.parse(raw)
  const definition = registry.get(name)
  if (!definition) throw new Error('Unknown command')
  const payload = payloadSchema.parse(rawPayload)
  if (name !== 'user:save' && Object.hasOwn(payload, 'role')) throw new Error('Role identity is derived from main-process session')
  const { clientRequestId, ...commandInput } = payload
  const input = definition.schema.parse(commandInput)
  const ctx = getContext()
  if (!definition.roles.includes(ctx.role)) throw new Error('Permission denied')
  const database = getDatabase()
  const replay = database.prepare('SELECT command,result_json FROM command_log WHERE user_id=? AND client_request_id=?').get(ctx.userId, clientRequestId)
  if (replay) {
    if (replay.command !== name) throw new Error('Request id was already used for a different command')
    return { ok: true, data: JSON.parse(replay.result_json) }
  }
  const priorUser = name === 'user:save' && input.id ? database.prepare('SELECT role,is_active FROM users WHERE id=?').get(input.id) : null
  const invoke = database.transaction(() => {
    const result = redactCosts(definition.handler(database, input, { ctx, elevation: ctx.elevation }), ctx.role)
    database.prepare('INSERT INTO command_log (id,user_id,client_request_id,command,result_json,created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), ctx.userId, clientRequestId, name, JSON.stringify(result), new Date().toISOString())
    return result
  })
  const result = invoke.immediate()
  if (priorUser && (priorUser.role !== input.role || (input.isActive === false && priorUser.is_active))) invalidateUser?.(input.id)
  return { ok: true, data: result }
}

function dispatchQuery({ registry, getDatabase, getContext, raw }) {
  const { name, payload: rawPayload } = invocationSchema.parse(raw)
  const definition = registry.getQuery(name)
  if (!definition) throw new Error('Unknown query')
  const ctx = getContext()
  if (!definition.roles.includes(ctx.role)) throw new Error('Permission denied')
  const input = definition.schema.parse(rawPayload ?? {})
  return { ok: true, ...redactCosts(definition.handler(getDatabase(), ctx, input), ctx.role) }
}

module.exports = { dispatchCommand, dispatchQuery, paginateQuery, payloadSchema, redactCosts }

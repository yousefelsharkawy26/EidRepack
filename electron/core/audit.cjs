const { id } = require('./ids.cjs')
const { contextOf } = require('./context.cjs')
const { write } = require('./tx.cjs')

function audit(db, control, options, action, entity, entityId, after) {
  const ctx = contextOf(options)
  write(db, control, `audit:${action}:${entityId}`, 'INSERT INTO audit_log (id,user_id,action,entity,entity_id,after_json,created_at) VALUES (?,?,?,?,?,?,?)', [id('audit'), ctx?.userId || null, `${action}${ctx?.role ? ` [${ctx.role}]` : ''}`, entity, entityId, JSON.stringify(after ?? null), new Date().toISOString()])
}

module.exports = { audit }

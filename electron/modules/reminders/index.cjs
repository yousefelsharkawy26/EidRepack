const contributeSnapshot = require('./snapshot.cjs')
const shared = require('../../core/shared.cjs')
const { actorId, assertNonnegativeInt, assertPositiveInt, atomic, audit, availableLots, consumeFifo, consumeSpecificLots, contextOf, elevationFor, id, localDateString, nowDate, one, requiredRow, roundHalfUp, settingValue, write } = shared
const { unitInfo } = require('../../units.cjs')
const { pageSchema } = require('../../core/query.cjs')
const { paginateQuery } = require('../../core/dispatcher.cjs')

function recordReminderRows(db, control, sale, date) {
  if (!sale.due_date || sale.total_minor <= sale.paid_amount_minor) return
  const rules = db.prepare('SELECT * FROM reminder_rules WHERE is_active=1 AND (customer_id IS NULL OR customer_id=?)').all(sale.customer_id)
  for (const rule of rules) {
    if (one(db, "SELECT id FROM reminders WHERE sales_order_id=? AND stage=?", [sale.id, rule.name])) throw new Error(`Duplicate reminder stage ${rule.name} for sale ${sale.id}`)
    const due = new Date(`${sale.due_date}T12:00:00Z`)
    due.setUTCDate(due.getUTCDate() + rule.offset_days)
    write(db, control, `reminder.create:${rule.id}`, 'INSERT INTO reminders (id,sales_order_id,customer_id,rule_id,template_id,scheduled_for,status,stage) VALUES (?,?,?,?,?,?,?,?)', [id('reminder'), sale.id, sale.customer_id, rule.id, rule.template_id, due.toISOString().slice(0, 10), 'pending', rule.name])
  }
}

function updateReminder(db, input, options = {}) {
  const result = atomic(db, options, control => {
    const reminder = requiredRow(one(db, 'SELECT * FROM reminders WHERE id=?', [input.id]), 'Reminder not found')
    if (!['sent', 'skipped', 'postponed'].includes(input.action)) throw new Error('Unsupported reminder action')
    const sale = requiredRow(one(db, 'SELECT * FROM sales_orders WHERE id=?', [reminder.sales_order_id]), 'Reminder sale not found')
    const outstanding = sale.total_minor - sale.paid_amount_minor - one(db, "SELECT COALESCE(SUM(rl.value_minor),0) AS amount FROM return_lines rl JOIN returns x ON x.id=rl.return_id WHERE x.return_type='sales' AND x.sales_order_id=?", [sale.id]).amount
    if (input.action !== 'skipped' && outstanding <= 0) throw new Error('Settled invoices cannot have active reminders')
    if (input.action === 'postponed') {
      if (!input.scheduledFor) throw new Error('scheduledFor is required')
      if (one(db, "SELECT id FROM reminders WHERE sales_order_id=? AND stage=? AND status='pending' AND id<>?", [sale.id, reminder.stage, reminder.id])) throw new Error('Another pending reminder already exists for this invoice stage')
      write(db, control, 'reminder.postpone', "UPDATE reminders SET scheduled_for=?,status='pending' WHERE id=?", [input.scheduledFor, reminder.id])
    } else if (input.action === 'skipped') {
      write(db, control, 'reminder.skip', "UPDATE reminders SET status='skipped' WHERE id=?", [reminder.id])
    } else {
      if (!input.renderedBody) throw new Error('renderedBody is required when sending a reminder')
      write(db, control, 'reminder.sent', "UPDATE reminders SET status='sent',sent_at=? WHERE id=?", [nowDate(input.date), reminder.id])
      write(db, control, 'reminder.message-log', 'INSERT INTO message_log (id,reminder_id,customer_id,to_phone,rendered_body,provider,status,created_at) VALUES (?,?,?,?,?,?,?,?)', [input.messageLogId || id('message'), reminder.id, reminder.customer_id, input.toPhone || null, input.renderedBody, input.provider || 'whatsapp-link', 'sent', nowDate(input.date)])
    }
    audit(db, control, options, `reminder.${input.action}`, 'reminder', reminder.id, { scheduledFor: input.scheduledFor || null })
    return { id: reminder.id, action: input.action }
  })
  return { ...result.result, steps: result.steps }
}

function saveReminderRule(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.name?.trim() || !Number.isSafeInteger(input.offsetDays)) throw new Error('Rule name and integer offset are required')
    if (input.templateId) requiredRow(one(db, 'SELECT id FROM message_templates WHERE id=?', [input.templateId]), 'Reminder template not found')
    if (input.customerId) requiredRow(one(db, 'SELECT id FROM customers WHERE id=?', [input.customerId]), 'Reminder customer not found')
    const ruleId = input.id || id('reminder-rule')
    write(db, control, 'reminder-rule.upsert', 'INSERT INTO reminder_rules (id,name,offset_days,template_id,is_active,customer_id) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,offset_days=excluded.offset_days,template_id=excluded.template_id,is_active=excluded.is_active,customer_id=excluded.customer_id', [ruleId, input.name.trim(), input.offsetDays, input.templateId || null, input.isActive === false ? 0 : 1, input.customerId || null])
    audit(db, control, options, 'reminder-rule.save', 'reminder-rule', ruleId, { name: input.name.trim(), offsetDays: input.offsetDays, isActive: input.isActive !== false })
    return { id: ruleId }
  })
  return { ...result.result, steps: result.steps }
}

function saveReminderTemplate(db, input, options = {}) {
  const result = atomic(db, options, control => {
    if (!input.name?.trim() || !input.body?.trim() || !input.stage?.trim()) throw new Error('Template name, body and stage are required')
    const templateId = input.id || id('template')
    write(db, control, 'template.upsert', 'INSERT INTO message_templates (id,name,channel,body,stage) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,channel=excluded.channel,body=excluded.body,stage=excluded.stage', [templateId, input.name.trim(), input.channel || 'whatsapp', input.body, input.stage.trim()])
    audit(db, control, options, 'reminder-template.save', 'message-template', templateId, { name: input.name.trim(), stage: input.stage.trim() })
    return { id: templateId }
  })
  return { ...result.result, steps: result.steps }
}

function register(registry) {
  registry.defineCommand({ name: 'reminder:update', roles: ["owner","sales"], handler: updateReminder })
  registry.defineCommand({ name: 'reminder-rule:save', roles: ["owner"], handler: saveReminderRule })
  registry.defineCommand({ name: 'reminder-template:save', roles: ["owner"], handler: saveReminderTemplate })
  registry.defineQuery({ name: 'messages:list', roles: ['owner', 'sales'], schema: pageSchema, handler: (db, _ctx, page) =>
    paginateQuery(db, 'SELECT id,reminder_id,customer_id,to_phone,rendered_body,provider,status,error,created_at FROM message_log ORDER BY created_at DESC,rowid DESC', [], page)
  })
}

module.exports = { recordReminderRows, updateReminder, saveReminderRule, saveReminderTemplate, register, snapshot: contributeSnapshot }

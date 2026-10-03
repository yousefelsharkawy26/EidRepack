function contributeSnapshot({ db, ctx, localDateString, readSettings, unitFor, nextNumber, all, get, items, recipeLines, customers, customerOpenings, customerAdjustments, suppliers, supplierOpenings, sales, salesLines, linesBySale, purchases, purchaseLines, lineByPurchase, purchaseLots, lotByPurchase, returns, returnLines, linesByReturn, payments, allocations, allocationsByPayment, auditRows, users, userNames }) {
  return {
      reminders: all(db, 'SELECT * FROM reminders ORDER BY scheduled_for, rowid').map(row => ({
      id: row.id, saleId: row.sales_order_id, customerId: row.customer_id,
      ruleId: row.rule_id, templateId: row.template_id, scheduledFor: row.scheduled_for,
      status: row.status, sentAt: row.sent_at, stage: row.stage
    })),
      reminderRules: all(db, 'SELECT * FROM reminder_rules ORDER BY offset_days').map(row => ({
      id: row.id, name: row.name, offsetDays: row.offset_days, stage: row.name,
      templateId: row.template_id, isActive: Boolean(row.is_active), customerId: row.customer_id
    })),
      messageTemplates: all(db, 'SELECT * FROM message_templates').map(row => ({
      id: row.id, name: row.name, stage: row.stage, body: row.body, channel: row.channel
    })),
      messageLog: all(db, 'SELECT * FROM message_log ORDER BY created_at DESC, rowid DESC LIMIT 100').map(row => ({
      id: row.id, reminderId: row.reminder_id, customerId: row.customer_id,
      toPhone: row.to_phone, body: row.rendered_body, status: row.status, createdAt: row.created_at
    })),
  }
}

module.exports = contributeSnapshot

// Phase B integration: drives the exact renderer path (window.repack bridge ->
// IPC handlers -> operations -> SQLite -> snapshot) with a mocked ipcMain and
// the real security layer, so regressions in the wiring are caught here.
const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const Database = require('better-sqlite3')
const { applyMigrations, configureDatabase } = require('../electron/migrations/runner.cjs')
const { registerOperationHandlers, registerQueryHandlers } = require('../electron/services/ipc.cjs')
const { createSecurity } = require('../electron/security.cjs')
const operations = require('../electron/services/operations.cjs')

const NOW = '2026-01-05'

function makeHarness() {
  const db = new Database(':memory:')
  configureDatabase(db)
  applyMigrations(db)
  const security = createSecurity(db)
  const handlers = new Map()
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }
  registerOperationHandlers(ipcMain, () => db, event => security.context(event), { invalidateUser: userId => security.invalidate(userId) })
  registerQueryHandlers(ipcMain, () => db, event => security.context(event))
  const event = { sender: { id: 1 } }
  const invokeWith = (ev, channel, payload = {}) => handlers.get(channel)(ev, payload)
  const invoke = (channel, payload = {}) => invokeWith(event, channel, payload)
  const call = (name, payload = {}) => {
    const response = invoke(`operation:${name}`, { ...payload, clientRequestId: randomUUID() })
    assert.equal(response.ok, true, `${name} should succeed`)
    return response.data
  }
  const snapshot = () => invoke('query:snapshot').snapshot
  return { db, security, event, invoke, invokeWith, call, snapshot }
}

function seedCatalog(harness) {
  const { call } = harness
  const raw = call('item:save', { name: 'سكر خام', sku: 'RAW-1', type: 'raw', unitLabel: 'كجم', minStockBase: 0 })
  const pack = call('item:save', { name: 'كيس تعبئة', sku: 'PKG-1', type: 'packaging', unitLabel: 'قطعة', minStockBase: 0 })
  const fin = call('item:save', { name: 'سكر 500 جم', sku: 'FIN-1', type: 'finished', unitLabel: 'عبوة', minStockBase: 10, defaultSalePriceMinor: 3000 })
  call('recipe:save', {
    finishedItemId: fin.id,
    lines: [
      { componentItemId: raw.id, quantityPerUnitBase: 500 },
      { componentItemId: pack.id, quantityPerUnitBase: 1 }
    ]
  })
  const supplier = call('supplier:save', { name: 'الشركة الأولى', creditDays: 15 })
  const customer = call('customer:save', { name: 'محل النور', creditLimitMinor: 500000, creditDays: 15, whatsapp: '201001234567' })
  return { raw: raw.id, pack: pack.id, fin: fin.id, supplier: supplier.id, customer: customer.id }
}

test('renderer full cycle over IPC keeps books balanced', () => {
  const harness = makeHarness()
  const { security, event, call, snapshot } = harness
  security.bootstrap({ username: 'owner', displayName: 'المالك', password: 'owner-secret-1', pin: '1234' })
  const user = security.login(event.sender, { username: 'owner', password: 'owner-secret-1' })
  assert.equal(user.role, 'owner')

  const ids = seedCatalog(harness)

  // Purchase 100 kg of raw sugar for 4200 EGP (420000 piasters) on credit.
  call('purchase:confirm', {
    supplierId: ids.supplier, itemId: ids.raw, quantity: 100000,
    subtotalMinor: 400000, extraCostsMinor: 20000, totalMinor: 420000, paidMinor: 0,
    number: 'PUR-2026-0001', date: NOW, dueDate: '2026-01-20'
  })
  call('purchase:confirm', {
    supplierId: ids.supplier, itemId: ids.pack, quantity: 500,
    subtotalMinor: 250000, totalMinor: 250000, paidMinor: 250000,
    number: 'PUR-2026-0002', date: NOW
  })

  // Pack 100 units: 50 kg raw + 100 bags per the recipe.
  call('packing:confirm', {
    number: 'PCK-2026-0001', finishedItemId: ids.fin, date: NOW,
    plannedUnits: 100, producedUnits: 100, wasteQty: 0,
    inputs: [{ itemId: ids.raw, quantity: 50000 }, { itemId: ids.pack, quantity: 100 }]
  })

  let snap = snapshot()
  assert.equal(snap.items.find(item => item.id === ids.fin).stockBase, 100)
  assert.equal(snap.items.find(item => item.id === ids.raw).stockBase, 50000)
  assert.equal(snap.nextNumbers.INV, 'INV-' + new Date().getFullYear() + '-0001')

  // A credit sale above the customer's limit is rejected without elevation...
  const salePayload = {
    customerId: ids.customer, number: 'INV-2026-0001', date: NOW, dueDate: '2026-01-20',
    lines: [{ itemId: ids.fin, quantity: 100, lineTotalMinor: 600000 }]
  }
  assert.throws(() => call('sale:confirm', salePayload), /Credit limit exceeded/)
  // ...and succeeds after the owner elevates with a PIN and a recorded reason.
  security.elevate(event, { pin: '1234', scope: 'customer-credit' })
  const sale = call('sale:confirm', { ...salePayload, overrideReason: 'عميل قديم بسجل سداد منتظم' })
  assert.equal(sale.creditMinor, 600000)

  snap = snapshot()
  const snapSale = snap.sales.find(row => row.id === sale.id)
  assert.equal(snapSale.totalMinor, 600000)
  assert.equal(snapSale.creditOverrideReason, 'عميل قديم بسجل سداد منتظم')
  assert.ok(snap.reminders.some(reminder => reminder.saleId === sale.id && reminder.status === 'pending'))
  assert.equal(snap.customers.find(row => row.id === ids.customer).balanceMinor, 600000)

  // Partial collection reduces the outstanding amount.
  const collection = call('customer:collect', { customerId: ids.customer, saleId: sale.id, amountMinor: 200000, method: 'cash', date: NOW })
  assert.equal(collection.allocatedMinor, 200000)
  snap = snapshot()
  assert.equal(snap.sales.find(row => row.id === sale.id).paidMinor, 200000)

  // A promise reschedules the invoice's pending reminders atomically.
  const reminder = snap.reminders.find(row => row.saleId === sale.id && row.status === 'pending')
  call('reminder:update', { id: reminder.id, action: 'postponed', scheduledFor: '2026-01-12' })
  call('customer:promise', { saleId: sale.id, customerId: ids.customer, amountMinor: 400000, promisedDate: '2026-01-18' })
  snap = snapshot()
  assert.ok(snap.reminders.filter(row => row.saleId === sale.id && row.status === 'pending').every(row => row.scheduledFor === '2026-01-18'))

  // Returning 10 units restocks the original lot and lowers the balance.
  const lineId = snap.sales.find(row => row.id === sale.id).lines[0].id
  const returned = call('sale:return', { saleId: sale.id, number: 'RET-2026-0001', date: NOW, reason: 'بضاعة مرتجعة صالحة', lines: [{ originalSalesLineId: lineId, quantity: 10 }] })
  assert.equal(returned.refundMinor, 0)
  snap = snapshot()
  assert.equal(snap.items.find(item => item.id === ids.fin).stockBase, 10)
  // 600000 - 200000 paid - 60000 returned value
  assert.equal(snap.customers.find(row => row.id === ids.customer).balanceMinor, 340000)

  // Reversing the collection re-opens the invoice for the reversed amount.
  const payment = snap.payments.find(row => row.partyType === 'customer' && !row.isReversed)
  call('payment:reverse', { paymentId: payment.id, reason: 'دفعة سُجلت بالخطأ' })
  snap = snapshot()
  assert.equal(snap.sales.find(row => row.id === sale.id).paidMinor, 0)
  assert.equal(snap.customers.find(row => row.id === ids.customer).balanceMinor, 540000)

  // Writing the invoice off cancels the remaining debt with an audit trail.
  const writtenOff = call('customer:writeoff', { saleId: sale.id, reason: 'مديونية متعثرة' })
  assert.equal(writtenOff.writtenOffMinor, 540000)
  snap = snapshot()
  assert.equal(snap.customers.find(row => row.id === ids.customer).balanceMinor, 0)
  assert.ok(snap.reminders.filter(row => row.saleId === sale.id).every(row => row.status !== 'pending'))

  operations.checkInvariants(harness.db)
})

test('IPC layer enforces authentication and role permissions', () => {
  const harness = makeHarness()
  const { security, event, invoke } = harness
  // No session: everything is rejected.
  assert.throws(() => invoke('query:snapshot'), /Authentication required/)
  assert.throws(() => invoke('operation:settings:save', { key: 'company_name', value: 'x', clientRequestId: randomUUID() }), /Authentication required/)

  security.bootstrap({ username: 'owner', displayName: 'المالك', password: 'owner-secret-1', pin: '1234' })
  const ownerEvent = { sender: { id: 1 } }
  security.login(ownerEvent.sender, { username: 'owner', password: 'owner-secret-1' })

  // A sales user cannot manage settings, users, or reverse payments.
  const salesEvent = { sender: { id: 2 } }
  invoke('operation:user:save', { username: 'seller', displayName: 'بائع', role: 'sales', password: 'seller-secret-1', clientRequestId: randomUUID() })
    ? null : assert.fail('owner should create users')
  security.login(salesEvent.sender, { username: 'seller', password: 'seller-secret-1' })
  assert.throws(() => harness.invokeWith(salesEvent, 'operation:settings:save', { key: 'company_name', value: 'y', clientRequestId: randomUUID() }), /Permission denied/)
  assert.throws(() => harness.invokeWith(salesEvent, 'operation:payment:reverse', { paymentId: 'p-1', reason: 'x', clientRequestId: randomUUID() }), /Permission denied/)
  // ...but passes the ACL for sale-facing operations (fails later on data).
  assert.throws(() => harness.invokeWith(salesEvent, 'operation:customer:collect', { customerId: 'missing', amountMinor: 1, clientRequestId: randomUUID() }), /Customer not found/)
})

test('operation calls are idempotent per clientRequestId', () => {
  const harness = makeHarness()
  const { security, event, call, invoke } = harness
  security.bootstrap({ username: 'owner', displayName: 'المالك', password: 'owner-secret-1', pin: '1234' })
  security.login(event.sender, { username: 'owner', password: 'owner-secret-1' })
  const requestId = randomUUID()
  const first = invoke('operation:customer:save', { name: 'عميل التكرار', clientRequestId: requestId })
  const second = invoke('operation:customer:save', { name: 'عميل التكرار', clientRequestId: requestId })
  assert.deepEqual(second, first)
  assert.equal(harness.db.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 1)
  // The same request id bound to a different command is rejected.
  assert.throws(() => invoke('operation:supplier:save', { name: 'مورد', clientRequestId: requestId }), /different command/)
})

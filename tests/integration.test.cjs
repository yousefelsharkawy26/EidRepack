// Phase B integration: drives the exact renderer path (window.repack bridge ->
// IPC handlers -> operations -> SQLite -> snapshot) with a mocked ipcMain and
// the real security layer, so regressions in the wiring are caught here.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const Database = require('better-sqlite3')
const { applyMigrations, configureDatabase } = require('../electron/migrations/runner.cjs')
const { registerIpcHandlers } = require('../electron/services/ipc.cjs')
const { createSecurity } = require('../electron/security.cjs')
const operations = require('../electron/services/operations.cjs')

const baselineQueriesPath = path.resolve(__dirname, '../electron/services/queries.cjs')
const baselineQueriesModule = new Module(baselineQueriesPath, module)
baselineQueriesModule.filename = baselineQueriesPath
baselineQueriesModule.paths = Module._nodeModulePaths(path.dirname(baselineQueriesPath))
const baselineQueriesSource = fs.readFileSync(path.resolve(__dirname, 'fixtures/phase-0-queries.cjs'), 'utf8')
baselineQueriesModule._compile(baselineQueriesSource, baselineQueriesPath)
const { buildSnapshot: buildPhase0Snapshot } = baselineQueriesModule.exports

const NOW = '2026-01-05'

function makeHarness() {
  const db = new Database(':memory:')
  configureDatabase(db)
  applyMigrations(db)
  const security = createSecurity(db)
  const handlers = new Map()
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }
  registerIpcHandlers(ipcMain, () => db, event => security.context(event), { invalidateUser: userId => security.invalidate(userId) })
  const event = { sender: { id: 1 } }
  const invokeWith = (ev, channel, payload = {}) => handlers.get(channel)(ev, payload)
  const invoke = (channel, payload = {}) => invokeWith(event, channel, payload)
  const call = (name, payload = {}) => {
    const response = invoke('command:run', { name, payload: { ...payload, clientRequestId: randomUUID() } })
    assert.equal(response.ok, true, `${name} should succeed`)
    return response.data
  }
  const snapshot = () => invoke('query:run', { name: 'query:snapshot' }).snapshot
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
  const phase0Snap = buildPhase0Snapshot(harness.db, { role: 'owner' })
  const compatibleSnapshot = { ...snap, items: snap.items.map(({ hasStockMovements, ...item }) => item), generatedAt: '<time>' }
  assert.deepEqual(compatibleSnapshot, { ...phase0Snap, generatedAt: '<time>' }, 'snapshot business shape and values stay identical to Phase 0')
  assert.ok(snap.items.every(item => item.hasStockMovements), 'items with recorded movements expose the editor guard')
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
  assert.equal(security.session(event), null)
  assert.throws(() => invoke('query:run', { name: 'query:snapshot' }), /Authentication required/)
  assert.throws(() => invoke('command:run', { name: 'settings:save', payload: { key: 'company_name', value: 'x', clientRequestId: randomUUID() } }), /Authentication required/)

  const bootstrapped = security.bootstrap({ username: 'owner', displayName: 'المالك', password: 'owner-secret-1', pin: '1234' })
  assert.ok(bootstrapped.permissions.commands.includes('settings:save'))
  assert.ok(bootstrapped.permissions.screens.includes('settings'))
  const ownerEvent = { sender: { id: 1 } }
  const owner = security.login(ownerEvent.sender, { username: 'owner', password: 'owner-secret-1' })
  assert.deepEqual(owner.permissions, bootstrapped.permissions)

  // A sales user cannot manage settings, users, or reverse payments.
  const salesEvent = { sender: { id: 2 } }
  invoke('command:run', { name: 'user:save', payload: { username: 'seller', displayName: 'بائع', role: 'sales', password: 'seller-secret-1', clientRequestId: randomUUID() } })
    ? null : assert.fail('owner should create users')
  security.login(salesEvent.sender, { username: 'seller', password: 'seller-secret-1' })
  assert.throws(() => harness.invokeWith(salesEvent, 'command:run', { name: 'settings:save', payload: { key: 'company_name', value: 'y', clientRequestId: randomUUID() } }), /Permission denied/)
  assert.throws(() => harness.invokeWith(salesEvent, 'command:run', { name: 'payment:reverse', payload: { paymentId: 'p-1', reason: 'x', clientRequestId: randomUUID() } }), /Permission denied/)
  assert.ok(security.session(salesEvent).permissions.commands.includes('customer:collect'))
  assert.ok(!security.session(salesEvent).permissions.commands.includes('payment:reverse'))
  // ...but passes the ACL for sale-facing operations (fails later on data).
  assert.throws(() => harness.invokeWith(salesEvent, 'command:run', { name: 'customer:collect', payload: { customerId: 'missing', amountMinor: 1, clientRequestId: randomUUID() } }), /Customer not found/)
})

test('operation calls are idempotent per clientRequestId', () => {
  const harness = makeHarness()
  const { security, event, call, invoke } = harness
  security.bootstrap({ username: 'owner', displayName: 'المالك', password: 'owner-secret-1', pin: '1234' })
  security.login(event.sender, { username: 'owner', password: 'owner-secret-1' })
  const requestId = randomUUID()
  const first = invoke('command:run', { name: 'customer:save', payload: { name: 'عميل التكرار', clientRequestId: requestId } })
  const second = invoke('command:run', { name: 'customer:save', payload: { name: 'عميل التكرار', clientRequestId: requestId } })
  assert.deepEqual(second, first)
  assert.equal(harness.db.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 1)
  // The same request id bound to a different command is rejected.
  assert.throws(() => invoke('command:run', { name: 'supplier:save', payload: { name: 'مورد', clientRequestId: requestId } }), /different command/)
})


test('generic queries preserve role filtering, pagination, and cost visibility', () => {
  const harness = makeHarness()
  const { security, event, call, invoke, invokeWith } = harness
  security.bootstrap({ username: 'owner', displayName: 'المالك', password: 'owner-secret-1', pin: '1234' })
  security.login(event.sender, { username: 'owner', password: 'owner-secret-1' })
  const ids = seedCatalog(harness)
  call('inventory:opening', { itemId: ids.raw, quantity: 200, costMinor: 1000, date: NOW })
  call('purchase:confirm', { supplierId: ids.supplier, itemId: ids.raw, quantity: 1000, subtotalMinor: 5000, totalMinor: 5000, paidMinor: 0, number: 'PUR-Q-1', date: NOW })
  for (const [username, role] of [['seller', 'sales'], ['warehouse', 'warehouse'], ['buyer', 'purchasing']]) {
    call('user:save', { username, displayName: username, role, password: `${username}-secret-1` })
  }
  const sessions = {}
  for (const [id, username] of [[2, 'seller'], [3, 'warehouse'], [4, 'buyer']]) {
    const sender = { id }
    security.login(sender, { username, password: `${username}-secret-1` })
    sessions[username] = { sender }
  }

  const query = (sender, name, payload) => invokeWith(sender, 'query:run', { name, payload })
  const ownerRows = query(event, 'inventory:movements', { limit: 20 }).rows
  const movementPage = query(event, 'inventory:movements', { limit: 1 })
  assert.equal(movementPage.total, ownerRows.length)
  assert.equal(movementPage.rows.length, 1)
  assert.equal(movementPage.nextCursor, '1')
  assert.notEqual(movementPage.rows[0].id, query(event, 'inventory:movements', { limit: 1, cursor: '1' }).rows[0].id)
  const warehouseRows = query(sessions.warehouse, 'inventory:movements', { limit: 20 }).rows
  const purchasingRows = query(sessions.buyer, 'inventory:movements', { limit: 20 }).rows
  assert.ok(ownerRows.some(row => Object.hasOwn(row, 'cost_minor')))
  assert.ok(warehouseRows.length >= 2)
  assert.ok(warehouseRows.every(row => !Object.hasOwn(row, 'cost_minor')))
  assert.ok(purchasingRows.length > 0)
  assert.ok(purchasingRows.every(row => row.movement_type === 'purchase' && !Object.hasOwn(row, 'cost_minor')))
  assert.throws(() => query(sessions.seller, 'invoices:list', { kind: 'purchase' }), /Permission denied/)
  assert.throws(() => query(sessions.buyer, 'invoices:list', { kind: 'sales' }), /Permission denied/)
  assert.throws(() => query(event, 'inventory:movements', { cursor: '1x' }), /must match pattern/)
  assert.throws(() => query(event, 'inventory:movements', { limit: 201 }), /Too big/)
  assert.throws(() => invoke('command:run', { name: 'customer:save', payload: { name: 'محاولة هوية', userId: 'user-owner', clientRequestId: randomUUID() } }), /Identity is derived from main-process session/)
  assert.throws(() => invoke('command:run', { name: 'customer:save', payload: { name: 'محاولة دور', role: 'owner', clientRequestId: randomUUID() } }), /Role identity is derived from main-process session/)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { registry, createRegistry } = require('../electron/core/registry.cjs')
const { commandsForRole, permissionsForRole, screensForRole } = require('../electron/core/policy.cjs')

const expectedCommands = {
  'purchase:confirm': ['owner', 'purchasing'],
  'purchase:return': ['owner', 'purchasing'],
  'purchase-draft:save': ['owner', 'purchasing'],
  'purchase-draft:delete': ['owner', 'purchasing'],
  'supplier:pay': ['owner', 'purchasing'],
  'supplier:save': ['owner', 'purchasing'],
  'packing:confirm': ['owner', 'warehouse'],
  'packing:cancel': ['owner'],
  'sale:confirm': ['owner', 'sales'],
  'sale:return': ['owner', 'sales'],
  'customer:collect': ['owner', 'sales'],
  'customer:promise': ['owner', 'sales'],
  'customer:save': ['owner', 'sales'],
  'customer:writeoff': ['owner'],
  'payment:reverse': ['owner'],
  'reminder:update': ['owner', 'sales'],
  'reminder-rule:save': ['owner'],
  'reminder-template:save': ['owner'],
  'inventory:adjust': ['owner', 'warehouse'],
  'inventory:opening': ['owner'],
  'item:save': ['owner', 'warehouse', 'purchasing'],
  'recipe:save': ['owner', 'warehouse'],
  'user:save': ['owner'],
  'settings:save': ['owner']
}

const expectedScreens = {
  owner: ['dashboard', 'purchases', 'packing', 'inventory', 'sales', 'customers', 'suppliers', 'collections', 'reminders', 'reports', 'settings'],
  sales: ['dashboard', 'sales', 'customers', 'collections', 'reminders'],
  warehouse: ['dashboard', 'packing', 'inventory'],
  purchasing: ['dashboard', 'purchases', 'suppliers']
}

test('every registered command has a handler, roles, and the exact role matrix', () => {
  const entries = registry.list()
  assert.equal(entries.length, 24)
  assert.deepEqual(Object.fromEntries(entries.map(({ name, roles }) => [name, roles])), expectedCommands)
  for (const entry of entries) {
    assert.equal(typeof entry.handler, 'function', `${entry.name} handler`)
    assert.ok(entry.roles.length > 0, `${entry.name} roles`)
    assert.deepEqual(registry.rolesFor(entry.name), expectedCommands[entry.name])
    assert.ok(entry.schema, `${entry.name} schema`)
  }
  for (const role of Object.keys(expectedScreens)) {
    assert.deepEqual(commandsForRole(role), entries.filter(entry => entry.roles.includes(role)).map(entry => entry.name))
    assert.deepEqual(screensForRole(role), expectedScreens[role])
    assert.deepEqual(permissionsForRole(role), { commands: commandsForRole(role), screens: expectedScreens[role] })
  }
})

test('registered query permissions preserve the role and query-kind matrix', () => {
  assert.deepEqual(Object.fromEntries(registry.listQueries().map(({ name, roles }) => [name, roles])), {
    'query:snapshot': ['owner', 'sales', 'warehouse', 'purchasing'],
    'inventory:movements': ['owner', 'warehouse', 'purchasing'],
    'audit:list': ['owner'],
    'messages:list': ['owner', 'sales'],
    'invoices:list': ['owner', 'sales', 'purchasing']
  })
  assert.equal(typeof registry.getQuery('invoices:list').handler, 'function')
})

test('every registered command appears in generated docs', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'docs-commands.cjs'), '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('registry rejects incomplete and duplicate definitions', () => {
  const isolated = createRegistry()
  const handler = () => ({})
  assert.throws(() => isolated.defineCommand({ name: 'missing:roles', handler }), /at least one role/)
  assert.throws(() => isolated.defineQuery({ name: 'missing:handler', roles: ['owner'] }), /requires a handler/)
  isolated.defineCommand({ name: 'test:command', roles: ['owner'], handler })
  assert.throws(() => isolated.defineCommand({ name: 'test:command', roles: ['owner'], handler }), /Duplicate registry definition/)
})

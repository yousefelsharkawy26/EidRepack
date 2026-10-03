const test = require('node:test')
const assert = require('node:assert/strict')
const { redactCosts } = require('../electron/core/dispatcher.cjs')

test('redactCosts removes sensitive cost and profit fields recursively for non-owners', () => {
  const source = {
    id: 'item-1', name: 'منتج', unit_cost_minor: 1200, cogsTotalMinor: 800,
    salePriceMinor: 2000, nested: [{ unitCost: 12, margin: 0.4, quantity: 2 }],
  }
  const redacted = redactCosts(source, 'sales')

  assert.deepEqual(redacted, {
    id: 'item-1', name: 'منتج', salePriceMinor: 2000,
    nested: [{ quantity: 2 }],
  })
  assert.equal(redactCosts(source, 'owner'), source)
})

test('redactCosts preserves null, primitives, and arrays without mutating input', () => {
  const source = [{ item_id: 'item-1', costMinor: 100 }, null, 7]
  assert.deepEqual(redactCosts(source, 'warehouse'), [{ item_id: 'item-1' }, null, 7])
  assert.deepEqual(source[0], { item_id: 'item-1', costMinor: 100 })
})

import { describe, expect, it } from 'vitest'
import { screens, visibleScreensFor, type Screen } from '../../src/app/screens'

const roleScreens: Record<string, Screen[]> = {
  owner: ['dashboard', 'purchases', 'packing', 'inventory', 'sales', 'customers', 'suppliers', 'collections', 'reminders', 'reports', 'settings'],
  sales: ['dashboard', 'sales', 'customers', 'collections', 'reminders'],
  warehouse: ['dashboard', 'packing', 'inventory'],
  purchasing: ['dashboard', 'purchases', 'suppliers'],
}

describe('screen visibility', () => {
  it.each(Object.entries(roleScreens))('shows only permission-backed screens for %s', (_role, allowed) => {
    expect(visibleScreensFor(allowed).map(([key]) => key)).toEqual(allowed)
  })

  it('hides every screen until permissions are available', () => {
    expect(visibleScreensFor(null)).toEqual([])
    expect(visibleScreensFor(undefined)).toEqual([])
  })

  it('does not include screens outside the registered screen catalog', () => {
    const visible = visibleScreensFor(['dashboard', 'reports'] as Screen[])
    expect(visible.map(([key]) => key)).toEqual(['dashboard', 'reports'])
    expect(visible.every(([, item]) => typeof item.label === 'string')).toBe(true)
    expect(Object.keys(screens)).toContain('dashboard')
  })
})

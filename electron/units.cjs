// Canonical unit registry shared by operations, queries and the renderer.
// All stored quantities are integers in the item's canonical base unit
// (gram / millilitre / piece); display units are only a presentation layer
// with a fixed conversion factor (base units per one display unit).

const CANONICAL_UNITS = {
  weight: { id: 'unit-g', name: 'جرام', symbol: 'g', dimension: 'weight' },
  volume: { id: 'unit-ml', name: 'ملليلتر', symbol: 'ml', dimension: 'volume' },
  count: { id: 'unit-piece', name: 'قطعة', symbol: 'piece', dimension: 'count' }
}

// Display units selectable in the UI. `legacyId` is the row id in `units`
// stored on items.legacy_unit_id; `factor` = base units per display unit.
const DISPLAY_UNITS = [
  { legacyId: 'unit-kg', label: 'كجم', dimension: 'weight', factor: 1000 },
  { legacyId: 'unit-g', label: 'جرام', dimension: 'weight', factor: 1 },
  { legacyId: 'unit-l', label: 'لتر', dimension: 'volume', factor: 1000 },
  { legacyId: 'unit-ml', label: 'مل', dimension: 'volume', factor: 1 },
  { legacyId: 'unit-piece', label: 'قطعة', dimension: 'count', factor: 1 },
  { legacyId: 'unit-pack', label: 'عبوة', dimension: 'count', factor: 1 }
]

const byLabel = new Map(DISPLAY_UNITS.map(unit => [unit.label, unit]))
const byLegacyId = new Map(DISPLAY_UNITS.map(unit => [unit.legacyId, unit]))

function unitInfo(label) {
  const match = byLabel.get(String(label || '').trim())
  if (!match) throw new Error(`وحدة قياس غير مدعومة: «${label}»`)
  return { ...match, baseUnitId: CANONICAL_UNITS[match.dimension].id }
}

function unitByLegacyId(legacyId) {
  const known = byLegacyId.get(legacyId)
  if (known) return { ...known, baseUnitId: CANONICAL_UNITS[known.dimension].id }
  return null
}

// Rows inserted (idempotently) by migration 007 so the units referenced by
// items always exist even on databases created before this phase.
const UNIT_SEED_ROWS = [
  { id: 'unit-g', name: 'جرام', symbol: 'g', dimension: 'weight', isCanonical: 1 },
  { id: 'unit-ml', name: 'ملليلتر', symbol: 'ml', dimension: 'volume', isCanonical: 1 },
  { id: 'unit-piece', name: 'قطعة', symbol: 'piece', dimension: 'count', isCanonical: 1 },
  { id: 'unit-kg', name: 'كجم', symbol: 'kg', dimension: 'weight', isCanonical: 0 },
  { id: 'unit-l', name: 'لتر', symbol: 'l', dimension: 'volume', isCanonical: 0 },
  { id: 'unit-pack', name: 'عبوة', symbol: 'pack', dimension: 'count', isCanonical: 0 }
]

const UNIT_CONVERSION_SEED_ROWS = [
  { id: 'conversion-kg-g', from: 'unit-kg', to: 'unit-g', numerator: 1000, denominator: 1 },
  { id: 'conversion-l-ml', from: 'unit-l', to: 'unit-ml', numerator: 1000, denominator: 1 },
  { id: 'conversion-pack-piece', from: 'unit-pack', to: 'unit-piece', numerator: 1, denominator: 1 }
]

module.exports = { CANONICAL_UNITS, DISPLAY_UNITS, UNIT_CONVERSION_SEED_ROWS, UNIT_SEED_ROWS, unitByLegacyId, unitInfo }

const { one } = require('./db.cjs')

function settingValue(db, key, fallback = null) {
  const row = one(db, 'SELECT value FROM settings WHERE key=?', [key])
  if (!row) return fallback
  try { return JSON.parse(row.value) } catch { return fallback }
}

module.exports = { settingValue }

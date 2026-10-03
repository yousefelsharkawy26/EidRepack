const MAX_ENTRIES = 500

function createSystemLogs() {
  const entries = []
  const originals = {}
  const redact = value => String(value).replace(/(password|pin|token|secret)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[redacted]')
  const serialize = value => {
    try { return value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value) }
    catch { return '[unserializable log value]' }
  }
  const store = {
    record(level, values) {
      entries.push({ at: new Date().toISOString(), level, message: redact(values.map(serialize).join(' ')).slice(0, 4000) })
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
    },
    list() { return entries.slice(-MAX_ENTRIES).reverse() },
    install() {
      for (const level of ['error', 'warn', 'info', 'log']) {
        originals[level] = console[level].bind(console)
        console[level] = (...values) => { store.record(level, values); originals[level](...values) }
      }
    },
    restore() { for (const [level, original] of Object.entries(originals)) console[level] = original },
  }
  return store
}

module.exports = { createSystemLogs, MAX_ENTRIES }

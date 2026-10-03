const { contextOf } = require('./context.cjs')

function failController(options = {}) {
  let step = 0
  const trace = []
  return {
    trace,
    after(label) {
      trace.push(label)
      step += 1
      if (options.failAfterStep === step) throw new Error(`Injected failure after ${label}`)
    }
  }
}
function atomic(db, options, body) {
  contextOf(options)
  const control = failController(options)
  const run = db.transaction(() => body(control))
  return { result: run.immediate(), steps: control.trace }
}
function write(db, control, label, sql, params) {
  const result = db.prepare(sql).run(...params)
  control.after(label)
  return result
}

module.exports = { atomic, failController, write }

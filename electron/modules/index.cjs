const snapshotContributors = [require('./inventory/index.cjs').snapshot, require('./customers/index.cjs').snapshot, require('./sales/index.cjs').snapshot, require('./suppliers/index.cjs').snapshot, require('./packing/index.cjs').snapshot, require('./reminders/index.cjs').snapshot, require('./users/index.cjs').snapshot, require('./settings/index.cjs').snapshot]

const modules = [
  require('./sales/index.cjs'),
  require('./purchases/index.cjs'),
  require('./packing/index.cjs'),
  require('./inventory/index.cjs'),
  require('./customers/index.cjs'),
  require('./suppliers/index.cjs'),
  require('./collections/index.cjs'),
  require('./reminders/index.cjs'),
  require('./settings/index.cjs'),
  require('./users/index.cjs'),
  require('./snapshot/index.cjs')
]

function registerAll(registry) {
  for (const module of modules) module.register(registry)
}

module.exports = { modules, registerAll, snapshotContributors }

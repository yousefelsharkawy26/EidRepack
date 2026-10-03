function register(registry) {
  registry.defineQuery({
    name: 'query:snapshot',
    roles: ['owner', 'sales', 'warehouse', 'purchasing'],
    handler: (db, ctx) => {
      const { buildSnapshot } = require('../../services/queries.cjs')
      return { snapshot: buildSnapshot(db, ctx) }
    }
  })
}

module.exports = { register }

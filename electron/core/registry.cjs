const { z } = require('zod')
const { registerAll } = require('../modules/index.cjs')
const { pageSchema } = require('./query.cjs')

function createRegistry() {
  const commands = new Map()
  const queries = new Map()
  const defaultSchema = z.object({}).passthrough()

  function define(store, definition) {
    if (!definition || typeof definition.name !== 'string' || !definition.name) throw new Error('Registry definition requires a name')
    if (!Array.isArray(definition.roles) || definition.roles.length === 0) throw new Error(`Registry definition ${definition.name} requires at least one role`)
    if (typeof definition.handler !== 'function') throw new Error(`Registry definition ${definition.name} requires a handler`)
    if (store.has(definition.name)) throw new Error(`Duplicate registry definition: ${definition.name}`)
    const entry = { ...definition, roles: [...definition.roles], schema: definition.schema || defaultSchema }
    store.set(entry.name, entry)
    return entry
  }

  return {
    defineCommand: definition => define(commands, definition),
    defineQuery: definition => define(queries, definition),
    get: name => commands.get(name),
    getQuery: name => queries.get(name),
    list: () => [...commands.values()],
    listQueries: () => [...queries.values()],
    rolesFor: name => commands.get(name)?.roles || []
  }
}

const registry = createRegistry()
const defineCommand = registry.defineCommand
const defineQuery = registry.defineQuery
registerAll(registry)

module.exports = { createRegistry, defineCommand, defineQuery, pageSchema, registry }

function contextOf(options = {}) {
  const ctx = options.ctx
  if (!ctx?.userId || !['owner', 'sales', 'warehouse', 'purchasing'].includes(ctx.role)) throw new Error('Authenticated user context is required')
  return ctx
}
function actorId(options = {}) { return contextOf(options).userId }
function elevationFor(options, scope) {
  const elevation = options.elevation
  if (!elevation || elevation.scope !== scope || !(elevation.expiresAt > Date.now())) return null
  return elevation
}

module.exports = { actorId, contextOf, elevationFor }

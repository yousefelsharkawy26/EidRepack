const { registry } = require('./registry.cjs')

const screensByRole = {
  owner: ['dashboard', 'purchases', 'packing', 'inventory', 'sales', 'customers', 'suppliers', 'collections', 'reminders', 'reports', 'settings'],
  sales: ['dashboard', 'sales', 'customers', 'collections', 'reminders'],
  warehouse: ['dashboard', 'packing', 'inventory'],
  purchasing: ['dashboard', 'purchases', 'suppliers']
}

function commandsForRole(role) {
  return registry.list().filter(command => command.roles.includes(role)).map(command => command.name)
}

function screensForRole(role) {
  return [...(screensByRole[role] || [])]
}

function permissionsForRole(role) {
  return { commands: commandsForRole(role), screens: screensForRole(role) }
}

module.exports = { commandsForRole, permissionsForRole, screensForRole }

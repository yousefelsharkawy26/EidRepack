const { randomUUID } = require('node:crypto')

function id(prefix) { return `${prefix}-${randomUUID()}` }

module.exports = { id }

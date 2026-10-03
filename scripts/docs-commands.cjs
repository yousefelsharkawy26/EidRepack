const fs = require('node:fs')
const path = require('node:path')
const { registry } = require('../electron/core/registry.cjs')

const target = path.join(__dirname, '..', 'docs', 'COMMANDS.md')
const rows = registry.list().map(command => `| \`${command.name}\` | ${command.roles.join(', ')} |`)
const queryRows = registry.listQueries().map(query => `| \`${query.name}\` | ${query.roles.join(', ')} |`)
const content = [
  '# Registered commands and queries',
  '',
  'Generated from `electron/core/registry.cjs` by `npm run docs:commands`; do not edit by hand.',
  '',
  '## Commands',
  '',
  '| Command | Roles |',
  '| --- | --- |',
  ...rows,
  '',
  '## Queries',
  '',
  '| Query | Roles |',
  '| --- | --- |',
  ...queryRows,
  ''
].join('\n')

if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
    console.error('docs/COMMANDS.md is out of date; run npm run docs:commands')
    process.exitCode = 1
  }
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

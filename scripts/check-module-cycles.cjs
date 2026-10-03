const fs = require('node:fs')
const path = require('node:path')

const modulesRoot = path.resolve(__dirname, '../electron/modules')
const files = []
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(target)
    else if (entry.name.endsWith('.cjs')) files.push(target)
  }
}
walk(modulesRoot)

const graph = new Map(files.map(file => [file, []]))
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  for (const [, request] of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    if (!request.startsWith('.')) continue
    let target = path.resolve(path.dirname(file), request)
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.cjs')
    else if (!path.extname(target)) target += '.cjs'
    if (graph.has(target)) graph.get(file).push(target)
  }
}

const visiting = new Set()
const visited = new Set()
function visit(file, route = []) {
  if (visiting.has(file)) throw new Error(`Circular module import: ${[...route, file].map(item => path.relative(modulesRoot, item)).join(' -> ')}`)
  if (visited.has(file)) return
  visiting.add(file)
  for (const dependency of graph.get(file) || []) visit(dependency, [...route, file])
  visiting.delete(file)
  visited.add(file)
}
for (const file of graph.keys()) visit(file)
console.log(`No module import cycles (${files.length} files checked).`)

const path = require('node:path')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function resolveAppResource(distDirectory, requestUrl) {
  try {
    if (typeof requestUrl !== 'string' || requestUrl.includes('\\')) return null
    const rawPath = requestUrl.slice(requestUrl.indexOf('://') + 3).replace(/^[^/]+/, '')
    const decodedRawPath = decodeURIComponent(rawPath)
    if (decodedRawPath.includes('\\') || decodedRawPath.split('/').some(segment => segment === '..')) return null
    const url = new URL(requestUrl)
    if (url.protocol !== 'app:' || url.hostname !== 'renderer') return null
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const filePath = path.resolve(distDirectory, relativePath)
    if (filePath !== distDirectory && !filePath.startsWith(distDirectory + path.sep)) return null
    if (!fs.statSync(filePath).isFile()) return null
    return filePath
  } catch {
    return null
  }
}

function registerAppProtocol(protocol, distDirectory) {
  protocol.handle('app', async request => {
    const filePath = resolveAppResource(distDirectory, request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    try {
      const root = await fsPromises.realpath(distDirectory)
      const realPath = await fsPromises.realpath(filePath)
      if (realPath !== root && !realPath.startsWith(root + path.sep)) return new Response('Not found', { status: 404 })
      const body = await fsPromises.readFile(realPath)
      const contentType = mimeTypes[path.extname(realPath).toLowerCase()]
      if (!contentType) return new Response('Not found', { status: 404 })
      return new Response(body, { headers: { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

module.exports = { mimeTypes, registerAppProtocol, resolveAppResource }

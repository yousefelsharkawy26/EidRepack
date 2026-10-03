const DEV_PORT = '5171'

const productionCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"

function getViteOrigin(devServerUrl) {
  if (!devServerUrl) return null
  try {
    const parsed = new URL(devServerUrl)
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== DEV_PORT) return null
    return parsed.origin
  } catch {
    return null
  }
}

function isViteDevelopmentDocument({ isPackaged, documentUrl, devServerUrl }) {
  if (isPackaged) return false
  const configuredOrigin = getViteOrigin(devServerUrl)
  if (!configuredOrigin) return false
  try {
    const document = new URL(documentUrl)
    return document.protocol === 'http:' && document.origin === configuredOrigin
  } catch {
    return false
  }
}

function contentSecurityPolicy(context) {
  if (isViteDevelopmentDocument(context)) {
    const origin = new URL(context.devServerUrl).origin
    const wsOrigin = origin.replace(/^http:/, 'ws:')
    return `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${origin} ${wsOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`
  }
  return productionCsp
}

module.exports = { contentSecurityPolicy, getViteOrigin, isViteDevelopmentDocument, productionCsp }

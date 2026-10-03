function createTrustedFrameGuard({ app, getViteOrigin, isViteDevelopmentDocument }) {
  return function assertTrustedFrame(event) {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new Error('IPC is allowed only from the application main frame')
    const target = event.senderFrame.url
    const devUrl = !app.isPackaged ? getViteOrigin(process.env.VITE_DEV_SERVER_URL) : null
    if (isViteDevelopmentDocument({ isPackaged: app.isPackaged, documentUrl: target, devServerUrl: devUrl })) return
    if ((app.isPackaged || !devUrl) && target === 'app://renderer/index.html') return
    throw new Error('Untrusted IPC sender')
  }
}

module.exports = { createTrustedFrameGuard }
